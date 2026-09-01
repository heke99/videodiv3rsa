import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonExporter, MemoryExporter, SPANS, configureTelemetry, setExporter } from "@videoai/telemetry";
import { createActivities } from "../../services/orchestrator/src/activities/implementations.js";

/**
 * That the instrumentation is attached to anything at all.
 *
 * SPANS and METRICS named every span and metric the spec asks for, and for
 * twelve batches nothing emitted one: the only references were in the telemetry
 * package's own test. A constant naming a span that is never started is worse
 * than no constant, because it reads like coverage.
 */

const ENV: Record<string, string> = {
  PUBLIC_APP_URL: "https://example.test",
  APP_NAME: "test",
  APP_DOMAIN: "example.test",
  AUTH_CALLBACK_URL: "https://example.test/auth/callback",
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
  DATABASE_URL: "postgres://user:pw@127.0.0.1:1/videoai",
  STORAGE_PROVIDER: "local",
  STORAGE_BUCKET: "test",
  STORAGE_LOCAL_ROOT: "/tmp/videoai-telemetry-test",
  GPU_PROVIDER: "manual",
  GPU_GATEWAY_SIGNING_KEY: "0".repeat(64),
  GPU_WORKER_TOKEN: "1".repeat(64),
  MODEL_ROOT: "/tmp/videoai-models",
  SKILLS_ROOT: "skills",
  TEMPORAL_ADDRESS: "127.0.0.1:7233",
  DIRECTOR_MODEL: "local/director",
  DIRECTOR_ENDPOINT: "http://127.0.0.1:1/v1",
  QC_MODEL: "local/qc",
};
for (const [key, value] of Object.entries(ENV)) process.env[key] ??= value;

let exporter: MemoryExporter;

beforeEach(() => {
  exporter = new MemoryExporter();
  setExporter(exporter);
});

afterEach(() => {
  setExporter(null);
});

describe("activities are traced", () => {
  it("records a span for a GPU activity even when it fails", async () => {
    const activities = createActivities();

    // generateShot has no hardware to reach, so it throws. The span still has
    // to be recorded and still has to carry the error: an activity that only
    // appears in telemetry when it succeeds hides exactly the runs an operator
    // is looking for.
    await expect(
      activities.generateShot({
        job_id: "job-1",
        organization_id: "org",
        project_id: "project",
        shot: { id: "shot_01" } as never,
        decision: {} as never,
        attempt: 1,
        idempotency_key: "k",
      }),
    ).rejects.toThrow();

    const span = exporter.spans.find((s) => s.name === SPANS.generation);
    expect(span, "no generation span was recorded").toBeDefined();
    expect(span!.attributes["activity"]).toBe("generateShot");
    expect(span!.attributes["job_id"]).toBe("job-1");
    expect(span!.error).toBeTruthy();
  });

  it("carries the job id so spans can be grouped by production", async () => {
    const activities = createActivities();
    // A shot that has an approved take but no reachable database: the activity
    // has real work to do, so it must fail rather than skip, and the span has
    // to carry the job it failed under.
    await expect(
      activities.generateAmbience({
        job_id: "job-2",
        shots: [{ shot_id: "shot_01", asset_id: "asset-1" }],
      }),
    ).rejects.toThrow();

    expect(exporter.spans.at(-1)!.attributes["job_id"]).toBe("job-2");
  });

  it("emits spend as metrics", async () => {
    const activities = createActivities();

    // The database is unreachable here, so the write fails -- but the metric is
    // emitted before it, which is deliberate: a run that cannot record its
    // spend is one an operator most wants the number from.
    await activities
      .recordSpend({ job_id: "job-3", gpu_seconds: 42, cost_units: 7, repair_attempts: 1 })
      .catch(() => {});

    const names = exporter.metrics.map((m) => m.name);
    expect(names).toContain("videoai.generation_time_seconds");
    expect(names).toContain("videoai.repair_rate");
    expect(exporter.metrics.find((m) => m.name === "videoai.generation_time_seconds")!.value).toBe(42);
  });
});

describe("the exporter a process attaches", () => {
  it("writes one JSON object per record", () => {
    const lines: string[] = [];
    const json = new JsonExporter((line) => lines.push(line));

    json.span({ name: "x", attributes: { job_id: "j" }, duration_ms: 5, started_at: 1 });
    json.metric({ name: "videoai.success_rate", value: 1, attributes: {} });

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ kind: "span", name: "x", duration_ms: 5 });
    expect(JSON.parse(lines[1]!)).toMatchObject({ kind: "metric", value: 1 });
  });

  it("never lets a bad record break the caller", () => {
    const json = new JsonExporter(() => {
      throw new Error("stdout is gone");
    });
    // Telemetry failing must not fail the work it is describing.
    expect(() => json.metric({ name: "n", value: 1, attributes: {} })).not.toThrow();
  });

  it("says so when an OTLP endpoint is configured but unimplemented", () => {
    const warnings: string[] = [];
    configureTelemetry({ otlpEndpoint: "https://collector.invalid", warn: (m) => warnings.push(m) });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("not");
    setExporter(null);
  });
});
