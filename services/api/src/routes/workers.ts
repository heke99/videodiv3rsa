import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "@videoai/config";
import { query, queryOne, transaction } from "@videoai/database";
import { HttpError } from "../auth.js";

/**
 * The control plane a GPU host talks to (spec sections 51, 53).
 *
 * `workers/gpu-supervisor/supervisor/agent.py` has posted to these two paths
 * since Batch 3. Nothing served them, so no worker could register and nothing
 * ever wrote `last_seen_at` -- which both `selectWorkers` and
 * `availableProfiles` filter on, so the scheduler saw an empty fleet no matter
 * what hardware existed. The supervisor's payloads are the contract here; this
 * is the half that was missing, not a new interface.
 *
 * Deliberately not under /api: these are machine-to-machine, authenticated by a
 * shared worker token rather than a user session, and no browser has any reason
 * to reach them.
 */

const Register = z.object({
  worker_id: z.string().min(1),
  provider: z.string().min(1),
  endpoint: z.string().min(1),
  // A host whose capability scan failed still registers, reporting itself
  // unhealthy. Refusing the registration would leave an operator with a silent
  // machine and no way to see why.
  profile: z.string().nullable().default(null),
  gpu_count: z.number().int().nonnegative().default(0),
  vram_total_bytes: z.number().nonnegative().default(0),
  vram_free_bytes: z.number().nonnegative().default(0),
  cuda_version: z.string().nullable().default(null),
  driver_version: z.string().nullable().default(null),
  compute_capability: z.string().nullable().default(null),
  supported_precisions: z.array(z.string()).default([]),
  runtimes: z.array(z.string()).default([]),
  healthy: z.boolean(),
  detail: z.string().default(""),
});

const Heartbeat = z.object({
  worker_id: z.string().min(1),
  healthy: z.boolean(),
  detail: z.string().default(""),
  vram_free_bytes: z.number().nonnegative().default(0),
  temperature_c: z.number().nullable().default(null),
  utilization_pct: z.number().nullable().default(null),
  uptime_seconds: z.number().int().nonnegative().default(0),
});

/** Profiles the schema accepts. An unrecognised scan result registers as unusable. */
const PROFILES = new Set([
  "GPU_PROFILE_ECONOMY",
  "GPU_PROFILE_STANDARD",
  "GPU_PROFILE_HIGH",
  "GPU_PROFILE_ULTRA",
]);

export async function workerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/internal/workers/register", async (request) => {
    authenticateWorker(request);
    const body = Register.parse(request.body);

    // An unhealthy host, or one whose profile we do not recognise, is recorded
    // as UNHEALTHY rather than rejected: the fleet view is more useful with a
    // broken machine visible in it than absent from it.
    const profile = body.profile && PROFILES.has(body.profile) ? body.profile : null;
    const usable = body.healthy && profile !== null;

    await transaction(async (client) => {
      await client.query(
        `insert into public.gpu_workers
           (worker_id, provider, provider_ref, endpoint, lifecycle, profile, vram_total_bytes,
            vram_free_bytes, cuda_version, driver_version, compute_capability, gpu_count,
            supported_precisions, healthy, last_seen_at, started_at)
         values ($1, $2, $1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())
         on conflict (worker_id) do update set
           provider = excluded.provider,
           endpoint = excluded.endpoint,
           lifecycle = excluded.lifecycle,
           profile = excluded.profile,
           vram_total_bytes = excluded.vram_total_bytes,
           vram_free_bytes = excluded.vram_free_bytes,
           cuda_version = excluded.cuda_version,
           driver_version = excluded.driver_version,
           compute_capability = excluded.compute_capability,
           gpu_count = excluded.gpu_count,
           supported_precisions = excluded.supported_precisions,
           healthy = excluded.healthy,
           last_seen_at = now(),
           started_at = now(),
           updated_at = now()`,
        [
          body.worker_id,
          body.provider,
          body.endpoint,
          usable ? "READY" : "UNHEALTHY",
          // The column is NOT NULL with a check constraint, so an unknown
          // profile has to become something valid; ECONOMY is the least
          // capable, and the worker is UNHEALTHY anyway so nothing routes to it.
          profile ?? "GPU_PROFILE_ECONOMY",
          body.vram_total_bytes,
          body.vram_free_bytes,
          body.cuda_version,
          body.driver_version,
          body.compute_capability,
          body.gpu_count,
          body.supported_precisions,
          usable,
        ],
      );

      // Capabilities are replaced wholesale: a runtime removed from a host must
      // not linger and keep attracting work it can no longer serve.
      await client.query("delete from public.gpu_worker_capabilities where worker_id = $1", [body.worker_id]);
      for (const runtime of body.runtimes) {
        await client.query(
          `insert into public.gpu_worker_capabilities (worker_id, capability, detail)
           values ($1, $2, $3)
           on conflict (worker_id, capability) do update set detail = excluded.detail`,
          [body.worker_id, `runtime:${runtime}`, { runtime }],
        );
      }
      for (const precision of body.supported_precisions) {
        await client.query(
          `insert into public.gpu_worker_capabilities (worker_id, capability, detail)
           values ($1, $2, '{}'::jsonb)
           on conflict (worker_id, capability) do nothing`,
          [body.worker_id, `precision:${precision}`],
        );
      }
    });

    return { registered: true, worker_id: body.worker_id, accepted_profile: profile };
  });

  app.post("/internal/workers/heartbeat", async (request) => {
    authenticateWorker(request);
    const body = Heartbeat.parse(request.body);

    const row = await queryOne<{ drain_requested: boolean }>(
      `update public.gpu_workers
       set healthy = $2,
           vram_free_bytes = $3,
           temperature_c = $4,
           utilization_pct = $5,
           last_seen_at = now(),
           updated_at = now(),
           -- A worker that reports itself unhealthy stops being schedulable
           -- immediately. Recovery is not automatic: it re-registers, which is
           -- when the capability scan is trusted again.
           lifecycle = case
             when not $2 then 'UNHEALTHY'
             when lifecycle = 'UNHEALTHY' then 'UNHEALTHY'
             else lifecycle
           end
       where worker_id = $1
       returning drain_requested`,
      [body.worker_id, body.healthy, body.vram_free_bytes, body.temperature_c, body.utilization_pct],
    );

    if (!row) {
      // Telling the supervisor to drain would make it stop and stay stopped.
      // A 404 makes it retry, and its next registration repairs the gap.
      throw new HttpError(`Worker ${body.worker_id} is not registered`, 404);
    }

    return { drain_requested: row.drain_requested };
  });

  /** What the fleet holds, reported by the supervisor after a model scan. */
  app.post("/internal/workers/models", async (request) => {
    authenticateWorker(request);
    const body = z
      .object({
        worker_id: z.string().min(1),
        models: z
          .array(
            z.object({
              model_id: z.string().min(1),
              model_version: z.string().min(1),
              present: z.boolean().default(false),
              verified: z.boolean().default(false),
              loaded: z.boolean().default(false),
            }),
          )
          .default([]),
      })
      .parse(request.body);

    const known = await query<{ model_id: string }>("select model_id from public.model_registry");
    const registered = new Set(known.map((m) => m.model_id));

    for (const model of body.models) {
      // A model the registry does not know cannot be recorded -- the column is
      // a foreign key - and silently dropping it would hide a host serving
      // something nobody approved. Skipped and counted, not inserted.
      if (!registered.has(model.model_id)) continue;
      await queryOne(
        `insert into public.gpu_worker_models
           (worker_id, model_id, model_version, present, verified, loaded, verified_at)
         values ($1, $2, $3, $4, $5, $6, case when $5 then now() else null end)
         on conflict (worker_id, model_id, model_version) do update set
           present = excluded.present,
           verified = excluded.verified,
           loaded = excluded.loaded,
           verified_at = excluded.verified_at
         returning id`,
        [body.worker_id, model.model_id, model.model_version, model.present, model.verified, model.loaded],
      );
    }

    const unknown = body.models.filter((m) => !registered.has(m.model_id)).map((m) => m.model_id);
    return { recorded: body.models.length - unknown.length, unknown };
  });
}

/**
 * A worker proves itself with a shared token, compared in constant time.
 *
 * Not a user session: there is no person behind a heartbeat, and giving workers
 * accounts would put a credential that can read tenant data on every GPU host.
 */
function authenticateWorker(request: FastifyRequest): void {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError("Missing worker token", 401);
  }
  const presented = Buffer.from(header.slice(7));
  const expected = Buffer.from(config().GPU_WORKER_TOKEN);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    throw new HttpError("Invalid worker token", 401);
  }
}
