import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * A GPU host reaching the control plane, and the fleet being maintained.
 *
 * `workers/gpu-supervisor/supervisor/agent.py` has posted to
 * `/internal/workers/register` and `/internal/workers/heartbeat` since Batch 3.
 * Nothing served them. Because nothing served them, nothing ever wrote
 * `last_seen_at` -- and both `selectWorkers` and `availableProfiles` filter on
 * it, so the scheduler saw an empty fleet however much hardware existed. The
 * assertion that matters here is not that the routes return 200; it is that
 * after a register and a heartbeat the scheduler can finally see a worker.
 *
 * The payloads below are the ones agent.py actually sends. If they drift, this
 * is where it should hurt.
 *
 * Skipped when DATABASE_URL is unset, as the other database suites are.
 */

const DATABASE_URL = process.env["DATABASE_URL"];
const WORKER_TOKEN = "fleet-spec-worker-token-0000000000000000";

const ENV: Record<string, string> = {
  PUBLIC_APP_URL: "https://example.test",
  APP_NAME: "test",
  APP_DOMAIN: "example.test",
  AUTH_CALLBACK_URL: "https://example.test/auth/callback",
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
  STORAGE_PROVIDER: "local",
  STORAGE_BUCKET: "test",
  STORAGE_LOCAL_ROOT: "/tmp/videoai-fleet-test",
  GPU_PROVIDER: "manual",
  GPU_GATEWAY_SIGNING_KEY: "0".repeat(64),
  GPU_WORKER_TOKEN: WORKER_TOKEN,
  GPU_IDLE_TIMEOUT_SECONDS: "1",
  MODEL_ROOT: "/tmp/videoai-models",
  SKILLS_ROOT: "skills",
  TEMPORAL_ADDRESS: "127.0.0.1:7233",
  DIRECTOR_MODEL: "local/director",
  DIRECTOR_ENDPOINT: "http://127.0.0.1:1/v1",
  QC_MODEL: "local/qc",
};
for (const [key, value] of Object.entries(ENV)) process.env[key] ??= value;

const workerId = `spec-worker-${randomUUID().slice(0, 8)}`;

/** Exactly what `Supervisor.register()` posts. */
const REGISTER = {
  worker_id: workerId,
  provider: "manual",
  endpoint: "http://worker.internal:8000",
  profile: "GPU_PROFILE_ULTRA",
  gpu_count: 1,
  vram_total_bytes: 103_079_215_104,
  vram_free_bytes: 103_079_215_104,
  cuda_version: "12.4",
  driver_version: "550.54",
  compute_capability: "9.0",
  supported_precisions: ["fp16", "bf16", "fp8"],
  runtimes: ["wan-runtime", "vision-runtime"],
  healthy: true,
  detail: "1 GPU visible",
};

/** Exactly what `Supervisor.heartbeat_once()` posts. */
const HEARTBEAT = {
  worker_id: workerId,
  healthy: true,
  detail: "ok",
  vram_free_bytes: 90_000_000_000,
  temperature_c: 61,
  utilization_pct: 12,
  uptime_seconds: 420,
};

let app: FastifyInstance;
let client: Client;

async function post(path: string, body: unknown, token = WORKER_TOKEN) {
  return app.inject({
    method: "POST",
    url: path,
    headers: { authorization: `Bearer ${token}` },
    payload: body as object,
  });
}

describe.skipIf(!DATABASE_URL)("a GPU host reaching the control plane", () => {
  beforeAll(async () => {
    const { workerRoutes } = await import("../../services/api/src/routes/workers.js");
    app = Fastify();
    await app.register(workerRoutes);
    // Mirrors the API's own handler: HttpError carries the status it means.
    app.setErrorHandler((error: Error & { status?: number }, _request, reply) => {
      return reply.status(error.status ?? 500).send({ error: error.message });
    });
    await app.ready();

    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client?.query("delete from public.gpu_workers where worker_id like 'spec-worker-%'");
    await client?.end();
    await app?.close();
  });

  it("refuses a caller with no worker token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/workers/register",
      payload: REGISTER,
    });
    expect(response.statusCode).toBe(401);
  });

  it("refuses a wrong worker token", async () => {
    // Same length as the real one, so this exercises the comparison rather
    // than the length guard in front of it.
    const wrong = `${"x".repeat(WORKER_TOKEN.length)}`;
    expect((await post("/internal/workers/register", REGISTER, wrong)).statusCode).toBe(401);
  });

  it("registers a worker the scheduler can then see", async () => {
    expect((await post("/internal/workers/register", REGISTER)).statusCode).toBe(200);

    const { selectWorkers, availableProfiles } = await import("../../services/gpu-manager/src/scheduler.js");

    // The claim this whole file exists for. Before the routes existed both of
    // these returned empty for every possible fleet.
    expect(await availableProfiles()).toContain("GPU_PROFILE_ULTRA");

    const candidates = await selectWorkers(
      {
        required_profile: "GPU_PROFILE_ULTRA",
        required_precision: "fp8",
        required_vram_bytes: 1_000_000,
      } as never,
      "wan2.2-t2v-a14b",
    );
    expect(candidates.map((c) => c.worker_id)).toContain(workerId);
  });

  it("records the runtimes and precisions the host reported", async () => {
    const rows = await client.query<{ capability: string }>(
      "select capability from public.gpu_worker_capabilities where worker_id = $1 order by capability",
      [workerId],
    );
    const capabilities = rows.rows.map((r) => r.capability);
    // gpu_worker_capabilities had no writer at all until now, which is why the
    // vision-judge gate that queried it could never have been satisfied.
    expect(capabilities).toContain("runtime:vision-runtime");
    expect(capabilities).toContain("precision:fp8");
  });

  it("keeps the heartbeat fresh and reports whether to drain", async () => {
    const before = await client.query<{ last_seen_at: string }>(
      "select last_seen_at from public.gpu_workers where worker_id = $1",
      [workerId],
    );

    const response = await post("/internal/workers/heartbeat", HEARTBEAT);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ drain_requested: false });

    const after = await client.query<{ last_seen_at: string; utilization_pct: string }>(
      "select last_seen_at, utilization_pct from public.gpu_workers where worker_id = $1",
      [workerId],
    );
    expect(Date.parse(after.rows[0]!.last_seen_at)).toBeGreaterThanOrEqual(
      Date.parse(before.rows[0]!.last_seen_at),
    );
    expect(Number(after.rows[0]!.utilization_pct)).toBe(12);
  });

  it("tells a worker to drain once an operator asks", async () => {
    await client.query("update public.gpu_workers set drain_requested = true where worker_id = $1", [
      workerId,
    ]);
    expect((await post("/internal/workers/heartbeat", HEARTBEAT)).json()).toEqual({
      drain_requested: true,
    });
    await client.query("update public.gpu_workers set drain_requested = false where worker_id = $1", [
      workerId,
    ]);
  });

  it("takes an unhealthy worker out of scheduling immediately", async () => {
    await post("/internal/workers/heartbeat", { ...HEARTBEAT, healthy: false, detail: "GPU fell off" });

    const { availableProfiles } = await import("../../services/gpu-manager/src/scheduler.js");
    expect(await availableProfiles()).not.toContain("GPU_PROFILE_ULTRA");

    // Recovery is a re-registration, not a hopeful heartbeat: the capability
    // scan has to be trusted again before work resumes.
    await post("/internal/workers/heartbeat", HEARTBEAT);
    expect(await availableProfiles()).not.toContain("GPU_PROFILE_ULTRA");
    await post("/internal/workers/register", REGISTER);
    expect(await availableProfiles()).toContain("GPU_PROFILE_ULTRA");
  });

  it("404s a heartbeat from a worker it has never seen", async () => {
    const response = await post("/internal/workers/heartbeat", {
      ...HEARTBEAT,
      worker_id: "spec-worker-unknown",
    });
    // Not a drain instruction: that would stop the supervisor for good. A 404
    // makes it retry, and its next registration repairs the gap.
    expect(response.statusCode).toBe(404);
  });
});

describe.skipIf(!DATABASE_URL)("fleet maintenance", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: DATABASE_URL });
    await db.connect();
  });

  afterAll(async () => {
    await db?.query("delete from public.gpu_workers where worker_id like 'maint-%'");
    await db?.end();
  });

  beforeEach(async () => {
    await db.query("delete from public.gpu_workers where worker_id like 'maint-%'");
  });

  it("expires a reservation whose job died without releasing it", async () => {
    await db.query(
      `insert into public.gpu_workers (worker_id, provider, provider_ref, endpoint, lifecycle, profile, healthy, last_seen_at)
       values ('maint-a', 'manual', 'maint-a', 'http://x', 'BUSY', 'GPU_PROFILE_ULTRA', true, now())`,
    );
    const org = await db.query<{ id: string }>("select id from public.organizations limit 1");
    if (org.rows.length === 0) return;

    await db.query(
      `insert into public.gpu_reservations (worker_id, organization_id, vram_bytes, status, expires_at)
       values ('maint-a', $1, 1, 'held', now() - interval '1 hour')`,
      [org.rows[0]!.id],
    );

    const { tick } = await import("../../services/gpu-manager/src/maintenance.js");
    const report = await tick();
    expect(report.reservations_expired).toBeGreaterThan(0);

    const still = await db.query(
      "select 1 from public.gpu_reservations where worker_id = 'maint-a' and status = 'held'",
    );
    expect(still.rows).toHaveLength(0);
  });

  it("stops calling a silent worker healthy", async () => {
    await db.query(
      `insert into public.gpu_workers (worker_id, provider, provider_ref, endpoint, lifecycle, profile, healthy, last_seen_at)
       values ('maint-b', 'manual', 'maint-b', 'http://x', 'IDLE', 'GPU_PROFILE_HIGH', true, now() - interval '1 hour')`,
    );

    const { tick } = await import("../../services/gpu-manager/src/maintenance.js");
    expect((await tick()).workers_marked_unhealthy).toContain("maint-b");

    const row = await db.query<{ healthy: boolean; lifecycle: string }>(
      "select healthy, lifecycle from public.gpu_workers where worker_id = 'maint-b'",
    );
    expect(row.rows[0]!.healthy).toBe(false);
    expect(row.rows[0]!.lifecycle).toBe("UNHEALTHY");
  });

  it("notes an idle worker it cannot stop rather than crashing on it", async () => {
    await db.query(
      `insert into public.gpu_workers (worker_id, provider, provider_ref, endpoint, lifecycle, profile, healthy, queue_depth, last_seen_at, updated_at)
       values ('maint-c', 'manual', 'maint-c', 'http://x', 'IDLE', 'GPU_PROFILE_HIGH', true, 0, now(), now() - interval '1 hour')`,
    );

    const { tick } = await import("../../services/gpu-manager/src/maintenance.js");
    const report = await tick();

    // The manual provider cannot stop a machine under someone's desk. Proving
    // the loop survives that is the point of the provider abstraction.
    expect(report.suspend_unsupported).toContain("maint-c");
    expect(report.workers_suspended).not.toContain("maint-c");
  });

  it("does not un-drain a worker when its last job finishes", async () => {
    const org = await db.query<{ id: string }>("select id from public.organizations limit 1");
    if (org.rows.length === 0) return;

    await db.query(
      `insert into public.gpu_workers (worker_id, provider, provider_ref, endpoint, lifecycle, profile, healthy, queue_depth, drain_requested, last_seen_at)
       values ('maint-e', 'manual', 'maint-e', 'http://x', 'DRAINING', 'GPU_PROFILE_HIGH', true, 1, true, now())`,
    );
    const reservation = await db.query<{ id: string }>(
      `insert into public.gpu_reservations (worker_id, organization_id, vram_bytes, status, expires_at)
       values ('maint-e', $1, 1, 'held', now() + interval '1 hour') returning id`,
      [org.rows[0]!.id],
    );

    const { release } = await import("../../services/gpu-manager/src/scheduler.js");
    await release(reservation.rows[0]!.id);

    const row = await db.query<{ lifecycle: string; queue_depth: number }>(
      "select lifecycle, queue_depth from public.gpu_workers where worker_id = 'maint-e'",
    );
    // The queue empties, but the operator asked for this machine to be retired.
    // Flipping it back to IDLE showed a worker as available in the fleet view
    // while someone was trying to take it out of service.
    expect(row.rows[0]!.queue_depth).toBe(0);
    expect(row.rows[0]!.lifecycle).toBe("DRAINING");
  });

  it("leaves a worker alone while a reservation is still held against it", async () => {
    const org = await db.query<{ id: string }>("select id from public.organizations limit 1");
    if (org.rows.length === 0) return;

    await db.query(
      `insert into public.gpu_workers (worker_id, provider, provider_ref, endpoint, lifecycle, profile, healthy, queue_depth, last_seen_at, updated_at)
       values ('maint-d', 'manual', 'maint-d', 'http://x', 'IDLE', 'GPU_PROFILE_HIGH', true, 0, now(), now() - interval '1 hour')`,
    );
    await db.query(
      `insert into public.gpu_reservations (worker_id, organization_id, vram_bytes, status, expires_at)
       values ('maint-d', $1, 1, 'held', now() + interval '1 hour')`,
      [org.rows[0]!.id],
    );

    const { tick } = await import("../../services/gpu-manager/src/maintenance.js");
    const report = await tick();
    expect(report.suspend_unsupported).not.toContain("maint-d");
    expect(report.workers_suspended).not.toContain("maint-d");
  });
});
