import { ApplicationFailure } from "@temporalio/activity";
import { createAsset, relate } from "@videoai/assets";
import type {
  GenerateRequest,
  GenerationProvenance,
  RoutingDecision,
  WorkerRequirement,
} from "@videoai/contracts";
import { GPU_PROFILE_VRAM_GIB } from "@videoai/contracts";
import { query, queryOne, transaction } from "@videoai/database";
import { NoCapacityError, release, reserve } from "@videoai/gpu-manager";
import { sha256, storage } from "@videoai/storage";

import { callWorker, type WorkerCallResult } from "./worker-client.js";

/**
 * Dispatching one unit of work to a GPU worker (spec sections 52, 55, 64, 77).
 *
 * Every piece below this was written and none of it was called: `callWorker`
 * signed envelopes nobody sent, `reserve` held VRAM nobody asked for, and
 * `generation_attempts` -- the table the whole reproducibility story rests on
 * -- was never inserted into once. The activities above simply threw. This is
 * the function that joins them, and it is the same shape for a shot, a
 * reference image, a line of speech and a repair.
 *
 * The order matters and is the order the schema was designed for: replay guard,
 * reserve, record the attempt, call, store, release. A reservation is released
 * on every path out, because a worker that errors must not strand its VRAM.
 */

export interface DispatchInput {
  job_id: string;
  organization_id: string;
  project_id: string;
  /** The shot's slug, where the work belongs to one. */
  shot_slug?: string | null;
  attempt: number;
  idempotency_key: string;
  decision: RoutingDecision;
  request: Omit<GenerateRequest, "job_id" | "project_id" | "organization_id" | "attempt">;
  asset: {
    kind: "image" | "video" | "audio" | "caption" | "document" | "render";
    role: string;
    mime: string;
    extension: string;
  };
  provenance: Pick<GenerationProvenance, "skill_versions">;
  /** The asset this one was derived from, if any. Recorded as a graph edge. */
  derived_from?: { asset_id: string; relationship: Parameters<typeof relate>[3] } | null;
}

export interface DispatchOutput {
  asset_id: string;
  storage_key: string;
  sha256: string;
  gpu_seconds: number;
  cost_units: number;
}

/** VRAM a profile can offer, used as the reservation size for its model. */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requirementFor(decision: RoutingDecision): WorkerRequirement {
  return {
    required_profile: decision.required_profile,
    // Reserving the profile's full VRAM is deliberately coarse. Until
    // benchmarks give a per-model residency, over-reserving costs throughput
    // and under-reserving costs a crashed generation halfway through a film.
    required_vram_bytes: GPU_PROFILE_VRAM_GIB[decision.required_profile] * 1024 ** 3,
    required_capabilities: [],
    required_precision: decision.precision,
    required_runtime: decision.runtime,
  };
}

export async function dispatch(input: DispatchInput): Promise<DispatchOutput> {
  const replayed = await previousSuccess(input.organization_id, input.idempotency_key);
  if (replayed) return replayed;

  let reservation: Awaited<ReturnType<typeof reserve>>;
  try {
    reservation = await reserve(
      requirementFor(input.decision),
      input.decision.model_id,
      input.job_id,
      input.organization_id,
    );
  } catch (error) {
    if (error instanceof NoCapacityError) {
      // Non-retryable: the fleet cannot serve this, and trying again in five
      // seconds will not change that. The workflow surfaces it rather than
      // burning its attempt budget against an empty fleet.
      throw ApplicationFailure.nonRetryable(error.message, "NoCapacityError");
    }
    throw error;
  }

  const shotId = input.shot_slug ? await shotIdFor(input.project_id, input.shot_slug) : null;

  const attemptId = await recordAttemptStarted(input, reservation.worker_id, shotId);
  // Which machine produced this, for the provenance record. Read once here so
  // a frame can still be traced to its GPU after the worker is long gone.
  const hardware = await hardwareOf(reservation.worker_id);
  const startedAt = Date.now();

  try {
    const result = await callWorker(reservation.endpoint, input.decision.runtime, {
      ...input.request,
      job_id: input.job_id,
      project_id: input.project_id,
      organization_id: input.organization_id,
      attempt: input.attempt,
    });

    const output = await storeResult(input, attemptId, result, startedAt, hardware);
    await finishAttempt(attemptId, "succeeded", result, output.gpu_seconds);
    return output;
  } catch (error) {
    await finishAttempt(attemptId, "failed", null, (Date.now() - startedAt) / 1000, error);
    throw error;
  } finally {
    // Whatever happened, the worker gets its VRAM back. The maintenance loop
    // expires stranded reservations, but only for the cases this cannot reach.
    await release(reservation.reservation_id);
  }
}

/**
 * The result of the same work, if it already succeeded.
 *
 * `generation_attempts` is unique on `(organization_id, idempotency_key)`, and
 * the key covers the job, shot, attempt, model and prompt. A Temporal replay
 * after a crash therefore returns the first generation instead of paying for a
 * second one -- which is the guarantee the key was computed for and nothing
 * ever used.
 */
async function previousSuccess(
  organizationId: string,
  idempotencyKey: string,
): Promise<DispatchOutput | null> {
  const row = await queryOne<{
    asset_id: string;
    storage_key: string;
    sha256: string;
    gpu_seconds: string | null;
  }>(
    `select o.asset_id, v.storage_key, v.sha256, a.gpu_seconds
     from public.generation_attempts a
     join public.generation_outputs o on o.attempt_id = a.id
     join public.asset_versions v on v.asset_id = o.asset_id
     where a.organization_id = $1 and a.idempotency_key = $2 and a.status = 'succeeded'
     order by v.version desc
     limit 1`,
    [organizationId, idempotencyKey],
  );
  if (!row) return null;

  return {
    asset_id: row.asset_id,
    storage_key: row.storage_key,
    sha256: row.sha256,
    // Already paid for and already recorded; charging the replay again would
    // bill a customer twice for one generation.
    gpu_seconds: 0,
    cost_units: 0,
  };
}

interface Hardware {
  gpu_name: string | null;
  cuda_version: string | null;
}

async function hardwareOf(workerId: string): Promise<Hardware> {
  const row = await queryOne<{ compute_capability: string | null; cuda_version: string | null }>(
    "select compute_capability, cuda_version from public.gpu_workers where worker_id = $1",
    [workerId],
  );
  return { gpu_name: row?.compute_capability ?? null, cuda_version: row?.cuda_version ?? null };
}

async function shotIdFor(projectId: string, slug: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    "select id from public.shots where project_id = $1 and slug = $2",
    [projectId, slug],
  );
  return row?.id ?? null;
}

async function recordAttemptStarted(
  input: DispatchInput,
  workerId: string,
  shotId: string | null,
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `insert into public.generation_attempts
       (job_id, organization_id, shot_id, attempt, idempotency_key, model_id, model_version,
        adapter, worker_id, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'running')
     on conflict (organization_id, idempotency_key) do update
       set worker_id = excluded.worker_id, status = 'running', error_message = null
     returning id`,
    [
      input.job_id,
      input.organization_id,
      shotId,
      input.attempt,
      input.idempotency_key,
      input.decision.model_id,
      input.decision.model_version,
      input.decision.adapter,
      workerId,
    ],
  );
  if (!row) throw ApplicationFailure.nonRetryable("Could not record the generation attempt");
  return row.id;
}

/**
 * Take what the worker wrote and make it an asset of ours.
 *
 * The worker puts bytes in storage under its own key and tells us where. We
 * read them back through the storage adapter so the asset is content-addressed
 * by our own hash rather than by a name a worker chose, and so the same bytes
 * from two generations deduplicate.
 */
async function storeResult(
  input: DispatchInput,
  attemptId: string,
  result: WorkerCallResult,
  startedAt: number,
  hardware: Hardware,
): Promise<DispatchOutput> {
  const body = await storage().get(result.storage_key);

  const provenance: GenerationProvenance = {
    model_id: input.decision.model_id,
    model_version: result.model_version || input.decision.model_version,
    model_hash: null,
    adapter_version: input.decision.adapter,
    skill_versions: input.provenance.skill_versions,
    prompt: input.request.prompt,
    negative_prompt: input.request.negative_prompt,
    reference_hashes: input.request.references.flatMap((r) => (r.asset.sha256 ? [r.asset.sha256] : [])),
    seed: result.seed,
    // Steps and guidance are sampler settings the adapter owns; a runtime that
    // reports them puts them in metadata, and a null here is honest about not
    // knowing rather than inventing a number nobody could reproduce from.
    steps: numberOrNull(result.metadata["steps"]),
    guidance: numberOrNull(result.metadata["guidance"]),
    resolution: input.request.resolution,
    fps_num: input.request.fps_num ?? null,
    fps_den: input.request.fps_den ?? null,
    frames: input.request.duration_frames ?? null,
    precision: input.decision.precision,
    gpu_name: hardware.gpu_name,
    cuda_version: hardware.cuda_version,
    runtime_ms: result.runtime_ms,
    peak_vram_bytes: result.peak_vram_bytes,
    // Our own hash of the bytes, not the worker's claim about them.
    output_hash: sha256(body),
  };

  const created = await createAsset({
    organization_id: input.organization_id,
    project_id: input.project_id,
    kind: input.asset.kind,
    role: input.asset.role,
    label: input.shot_slug ?? input.asset.role,
    mime: input.asset.mime,
    extension: input.asset.extension,
    body,
    generation_attempt_id: attemptId,
    provenance,
  });

  if (input.derived_from) {
    // The graph edge is what makes "what was this repaired from" answerable
    // later, and it is the only record that survives a version being restored.
    await relate(
      input.organization_id,
      input.derived_from.asset_id,
      created.asset_id,
      input.derived_from.relationship,
    );
  }

  const gpuSeconds = Math.max(result.runtime_ms / 1000, (Date.now() - startedAt) / 1000);
  return {
    asset_id: created.asset_id,
    storage_key: created.storage_key,
    sha256: created.sha256,
    gpu_seconds: gpuSeconds,
    // Coarse until benchmarks give a real per-model rate; the preflight report
    // already labels its numbers estimates for the same reason.
    cost_units: Math.ceil(gpuSeconds / 6),
  };
}

async function finishAttempt(
  attemptId: string,
  status: "succeeded" | "failed",
  result: WorkerCallResult | null,
  gpuSeconds: number,
  error?: unknown,
): Promise<void> {
  await transaction(async (client) => {
    await client.query(
      `update public.generation_attempts
       set status = $2, runtime_ms = $3, peak_vram_bytes = $4, gpu_seconds = $5,
           error_message = $6, finished_at = now()
       where id = $1`,
      [
        attemptId,
        status,
        result?.runtime_ms ?? null,
        result?.peak_vram_bytes ?? null,
        gpuSeconds,
        error ? String((error as Error).message ?? error).slice(0, 2000) : null,
      ],
    );
  });
}

/** Attempts still marked running for a job, so a cancel can reach the worker. */
export async function runningAttempts(
  jobId: string,
): Promise<Array<{ id: string; worker_id: string | null }>> {
  return query<{ id: string; worker_id: string | null }>(
    "select id, worker_id from public.generation_attempts where job_id = $1 and status = 'running'",
    [jobId],
  );
}
