import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Generation dispatch, end to end, against a worker that is not a GPU.
 *
 * `callWorker` signed envelopes nobody sent, `reserve` held VRAM nobody asked
 * for, and `generation_attempts` was never inserted into once, because
 * `generateShot` threw instead of dispatching. Everything in this file except
 * the inference itself is now exercised: routing decision to reservation to
 * signed call to asset to released reservation.
 *
 * The stub worker verifies the envelope with the gateway's own `verifyEnvelope`
 * and refuses anything unsigned, so what is being tested is the real signing
 * path and not a hole in it. What is left unproven is a model producing frames,
 * which is the honest boundary.
 */

const DATABASE_URL = process.env["DATABASE_URL"];
const SIGNING_KEY = "d".repeat(64);
const STORAGE_ROOT = `/tmp/videoai-dispatch-${randomUUID().slice(0, 8)}`;

const ENV: Record<string, string> = {
  PUBLIC_APP_URL: "https://example.test",
  APP_NAME: "test",
  APP_DOMAIN: "example.test",
  AUTH_CALLBACK_URL: "https://example.test/auth/callback",
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
  STORAGE_PROVIDER: "local",
  STORAGE_BUCKET: "test",
  STORAGE_LOCAL_ROOT: STORAGE_ROOT,
  GPU_PROVIDER: "manual",
  GPU_GATEWAY_SIGNING_KEY: SIGNING_KEY,
  GPU_WORKER_TOKEN: "1".repeat(64),
  MODEL_ROOT: "/tmp/videoai-models",
  SKILLS_ROOT: "skills",
  TEMPORAL_ADDRESS: "127.0.0.1:7233",
  DIRECTOR_MODEL: "local/director",
  DIRECTOR_ENDPOINT: "http://127.0.0.1:1/v1",
  QC_MODEL: "local/qc",
};
for (const [key, value] of Object.entries(ENV)) process.env[key] ??= value;

const ids = {
  user: randomUUID(),
  org: randomUUID(),
  project: randomUUID(),
  job: randomUUID(),
  scene: randomUUID(),
  shot: randomUUID(),
};
const workerId = `dispatch-worker-${randomUUID().slice(0, 8)}`;

/** What the worker "produced". Written to the local store the way a worker would. */
const OUTPUT = Buffer.from("not really an mp4, but it is bytes and it hashes");
const OUTPUT_KEY = `workers/${workerId}/output.mp4`;

let worker: FastifyInstance;
let workerCalls = 0;
let lastEnvelopeValid: boolean | null = null;
let client: Client;

const decision = {
  model_id: "wan2.2-t2v-a14b",
  model_version: "2.2.0",
  adapter: "wan",
  runtime: "wan-runtime",
  precision: "fp8" as const,
  generation_profile: "standard",
  required_profile: "GPU_PROFILE_ULTRA" as const,
  skills: [],
  qc_profile: "STANDARD",
  rule_id: "test",
  reason: "test",
};

const shot = {
  id: "shot_01",
  scene_id: "scene_01",
  index: 0,
  description: "A creator holds the bottle up to the window light",
  action: "she turns it to read the label",
  shot_type: "medium",
  duration_frames: 48,
  camera: { framing: "medium", lens: "35mm", movement: "static", height: "eye_level", focus_behavior: "" },
  character_ids: [],
  product_ids: [],
  location_id: null,
  dialogue_line_ids: [],
  motion_complexity: 0.5,
  continuity_requirement: 0.5,
  requires_identity_lock: false,
  requires_product_fidelity: false,
  preferred_generation_kind: "text_to_video",
  start_frame_asset: null,
  end_frame_asset: null,
  notes: "",
} as never;

async function registerWorker(port: number, vramBytes = 103_079_215_104) {
  await client.query(
    `insert into public.gpu_workers
       (worker_id, provider, provider_ref, endpoint, lifecycle, profile, vram_total_bytes,
        vram_free_bytes, supported_precisions, healthy, last_seen_at, cuda_version, compute_capability)
     values ($1, 'manual', $1, $2, 'READY', 'GPU_PROFILE_ULTRA', $3, $3,
             '{fp8,fp16}', true, now(), '12.4', '9.0')
     on conflict (worker_id) do update
       set endpoint = excluded.endpoint, lifecycle = 'READY', healthy = true,
           vram_free_bytes = excluded.vram_free_bytes, last_seen_at = now()`,
    [workerId, `http://127.0.0.1:${port}`, vramBytes],
  );
}

describe.skipIf(!DATABASE_URL)("dispatching a generation", () => {
  beforeAll(async () => {
    mkdirSync(`${STORAGE_ROOT}/workers/${workerId}`, { recursive: true });
    writeFileSync(`${STORAGE_ROOT}/${OUTPUT_KEY}`, OUTPUT);

    const { verifyEnvelope } = await import("../../services/gpu-manager/src/gateway.js");

    worker = Fastify();
    worker.post("/generate", async (request, reply) => {
      workerCalls += 1;
      const raw = request.headers["x-videoai-envelope"];
      const body = JSON.stringify(request.body);
      const check = verifyEnvelope(
        SIGNING_KEY,
        JSON.parse(String(raw)) as never,
        createHash("sha256").update(body).digest("hex"),
        () => false,
      );
      lastEnvelopeValid = check.valid;
      if (!check.valid) return reply.status(401).send({ error: check.reason });

      return {
        storage_key: OUTPUT_KEY,
        sha256: createHash("sha256").update(OUTPUT).digest("hex"),
        runtime_ms: 4200,
        peak_vram_bytes: 70_000_000_000,
        model_version: "2.2.0",
        seed: (request.body as { seed: number }).seed,
        metadata: { steps: 30, guidance: 5 },
      };
    });
    await worker.listen({ port: 0, host: "127.0.0.1" });

    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    await client.query("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
      ids.user,
      `${ids.user}@test.invalid`,
    ]);
    await client.query(
      "insert into public.organizations (id, name, slug, created_by) values ($1, 'D', $2, $3)",
      [ids.org, `d-${ids.org.slice(0, 8)}`, ids.user],
    );
    await client.query(
      `insert into public.projects (id, organization_id, title, aspect_ratio, quality_mode,
                                    frame_rate_num, frame_rate_den, audio_sample_rate)
       values ($1, $2, 'D', '9:16', 'STANDARD', 24, 1, 48000)`,
      [ids.project, ids.org],
    );
    await client.query(
      `insert into public.generation_jobs (id, organization_id, project_id, quality_mode)
       values ($1, $2, $3, 'STANDARD')`,
      [ids.job, ids.org, ids.project],
    );
    await client.query(
      `insert into public.scenes (id, project_id, organization_id, slug, index, summary)
       values ($1, $2, $3, 'scene_01', 0, 's')`,
      [ids.scene, ids.project, ids.org],
    );
    await client.query(
      `insert into public.shots (id, project_id, scene_id, organization_id, slug, index,
                                 duration_frames, shot_type, preferred_generation_kind)
       values ($1, $2, $3, $4, 'shot_01', 0, 48, 'medium', 'text_to_video')`,
      [ids.shot, ids.project, ids.scene, ids.org],
    );
    // generateShot reads the Scene Bible to compile its prompt.
    const bible = await client.query<{ id: string }>(
      `insert into public.scene_bibles (project_id, organization_id, current_version)
       values ($1, $2, 1) returning id`,
      [ids.project, ids.org],
    );
    await client.query(
      `insert into public.scene_bible_versions
         (scene_bible_id, organization_id, version, document, schema_version)
       values ($1, $2, 1, $3, '1.0')`,
      [
        bible.rows[0]!.id,
        ids.org,
        {
          schema_version: "1.0",
          characters: [],
          products: [],
          locations: [],
          voices: [],
          style: { camera_style: "handheld", lighting: "window light", realism_profile: "documentary" },
        },
      ],
    );
  });

  afterAll(async () => {
    await client?.query("delete from public.gpu_workers where worker_id = $1", [workerId]);
    await client?.query("delete from public.organizations where id = $1", [ids.org]);
    await client?.query("delete from auth.users where id = $1", [ids.user]);
    await client?.end();
    await worker?.close();
  });

  beforeEach(async () => {
    workerCalls = 0;
    await client.query("delete from public.gpu_reservations where job_id = $1", [ids.job]);
  });

  it("refuses by capacity when no worker holds the model", async () => {
    await client.query("delete from public.gpu_workers where worker_id = $1", [workerId]);

    const { createActivities } =
      await import("../../services/orchestrator/src/activities/implementations.js");
    const activities = createActivities();

    await expect(
      activities.generateShot({
        job_id: ids.job,
        organization_id: ids.org,
        project_id: ids.project,
        shot,
        decision,
        attempt: 1,
        idempotency_key: `${ids.job}:capacity`,
      }),
    ).rejects.toThrow(/No healthy worker/);

    // Nothing was reserved, so nothing is left held for the maintenance loop
    // to clean up after a failure that never touched a worker.
    const held = await client.query(
      "select 1 from public.gpu_reservations where job_id = $1 and status = 'held'",
      [ids.job],
    );
    expect(held.rows).toHaveLength(0);
    expect(workerCalls).toBe(0);
  });

  it("generates through a signed call and records the attempt", async () => {
    const port = (worker.server.address() as { port: number }).port;
    await registerWorker(port);

    const { createActivities } =
      await import("../../services/orchestrator/src/activities/implementations.js");
    const key = `${ids.job}:shot_01:1:${randomUUID().slice(0, 8)}`;
    const output = await createActivities().generateShot({
      job_id: ids.job,
      organization_id: ids.org,
      project_id: ids.project,
      shot,
      decision,
      attempt: 1,
      idempotency_key: key,
    });

    expect(workerCalls).toBe(1);
    expect(lastEnvelopeValid, "the worker rejected our envelope").toBe(true);
    expect(output.asset_id).toBeTruthy();
    expect(output.gpu_seconds).toBeGreaterThan(0);

    const attempt = await client.query<{
      status: string;
      worker_id: string;
      model_id: string;
      provenance: { prompt: string; seed: number; gpu_name: string | null; output_hash: string };
      peak_vram_bytes: string;
    }>(
      `select status, worker_id, model_id, provenance, peak_vram_bytes
       from public.generation_attempts where organization_id = $1 and idempotency_key = $2`,
      [ids.org, key],
    );
    expect(attempt.rows).toHaveLength(1);
    const row = attempt.rows[0]!;
    expect(row.status).toBe("succeeded");
    expect(row.worker_id).toBe(workerId);

    // Provenance is the reproducibility record, and it has to carry the prompt
    // that was actually sent rather than a summary of it.
    expect(row.provenance.prompt).toContain("holds the bottle up to the window light");
    expect(row.provenance.gpu_name).toBe("9.0");
    expect(row.provenance.output_hash).toBe(createHash("sha256").update(OUTPUT).digest("hex"));

    // The asset is ours, hashed by us, not by the name the worker chose.
    const asset = await client.query<{ sha256: string; storage_key: string }>(
      `select v.sha256, v.storage_key from public.asset_versions v where v.asset_id = $1`,
      [output.asset_id],
    );
    expect(asset.rows[0]!.sha256).toBe(createHash("sha256").update(OUTPUT).digest("hex"));
    expect(asset.rows[0]!.storage_key).not.toBe(OUTPUT_KEY);

    // And the VRAM went back.
    const held = await client.query(
      "select 1 from public.gpu_reservations where job_id = $1 and status = 'held'",
      [ids.job],
    );
    expect(held.rows).toHaveLength(0);
  });

  it("replays instead of generating twice", async () => {
    const port = (worker.server.address() as { port: number }).port;
    await registerWorker(port);

    const { createActivities } =
      await import("../../services/orchestrator/src/activities/implementations.js");
    const activities = createActivities();
    const key = `${ids.job}:shot_01:1:${randomUUID().slice(0, 8)}`;
    const input = {
      job_id: ids.job,
      organization_id: ids.org,
      project_id: ids.project,
      shot,
      decision,
      attempt: 1,
      idempotency_key: key,
    };

    const first = await activities.generateShot(input);
    const second = await activities.generateShot(input);

    // The guarantee the idempotency key was computed for and nothing used: a
    // Temporal replay after a crash must not pay for a second generation.
    expect(workerCalls).toBe(1);
    expect(second.asset_id).toBe(first.asset_id);
    expect(second.gpu_seconds).toBe(0);

    const attempts = await client.query(
      "select 1 from public.generation_attempts where organization_id = $1 and idempotency_key = $2",
      [ids.org, key],
    );
    expect(attempts.rows).toHaveLength(1);
  });

  it("releases the reservation when the worker fails", async () => {
    // Point the worker row at a port nothing is listening on.
    await registerWorker(1);

    const { createActivities } =
      await import("../../services/orchestrator/src/activities/implementations.js");
    const key = `${ids.job}:shot_01:1:${randomUUID().slice(0, 8)}`;

    await expect(
      createActivities().generateShot({
        job_id: ids.job,
        organization_id: ids.org,
        project_id: ids.project,
        shot,
        decision,
        attempt: 1,
        idempotency_key: key,
      }),
    ).rejects.toThrow();

    // A worker that errors must not strand its VRAM. The maintenance loop is
    // the backstop for crashes, not for ordinary failures.
    const held = await client.query(
      "select 1 from public.gpu_reservations where job_id = $1 and status = 'held'",
      [ids.job],
    );
    expect(held.rows).toHaveLength(0);

    const attempt = await client.query<{ status: string; error_message: string | null }>(
      "select status, error_message from public.generation_attempts where idempotency_key = $1",
      [key],
    );
    expect(attempt.rows[0]!.status).toBe("failed");
    expect(attempt.rows[0]!.error_message).toBeTruthy();
  });
});
