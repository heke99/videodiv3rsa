import { describe, expect, it } from "vitest";
import type { Activities } from "@videoai/orchestrator";
import {
  createActivities,
  DISPATCHING_ACTIVITIES,
  UNIMPLEMENTED_ACTIVITIES,
} from "../../services/orchestrator/src/activities/implementations.js";

/**
 * What is written and what is not, pinned in both directions.
 *
 * Two failures this guards against, and they are opposites. One is the cheerful
 * kind: an activity reporting that it needs a GPU when it needs nothing of the
 * sort, which made the system look more blocked than it was. The other is the
 * flattering kind: an activity that never dispatches claiming to be "built but
 * unverified until hardware", which is how `generateShot` sat throwing for
 * twelve batches while `callWorker` had no callers at all.
 *
 * So there are three sets. Unimplemented activities say so by name. Dispatching
 * ones reach the fleet and refuse for capacity. Everything else must not blame
 * hardware for its own failures.
 */

const ENV: Record<string, string> = {
  NODE_ENV: "test",
  PUBLIC_APP_URL: "https://example.test",
  APP_NAME: "test",
  APP_DOMAIN: "example.test",
  AUTH_CALLBACK_URL: "https://example.test/auth/callback",
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
  // Port 1 is reserved and never listening, so the CPU-bound activities fail
  // fast on connection refused rather than hanging on a real database.
  DATABASE_URL: "postgres://user:pw@127.0.0.1:1/videoai",
  STORAGE_PROVIDER: "local",
  STORAGE_BUCKET: "test",
  STORAGE_LOCAL_ROOT: "/tmp/videoai-boundary-test",
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

for (const [key, value] of Object.entries(ENV)) {
  process.env[key] ??= value;
}

/** Every activity, called with an argument shaped enough to get past destructuring. */
const CALLS: Record<keyof Activities, () => Promise<unknown>> = (() => {
  const activities = createActivities();
  const shot = { id: "s1", dialogue_line_ids: [], duration_frames: 24, motion_complexity: 0.5 };
  const any = (value: unknown) => value as never;
  return {
    loadCapabilitySnapshot: () => activities.loadCapabilitySnapshot(any({ organization_id: "o" })),
    generateBrief: () => activities.generateBrief(any({ job_id: "j", project_id: "p" })),
    generateSceneBible: () => activities.generateSceneBible(any({ job_id: "j" })),
    generateScript: () => activities.generateScript(any({ job_id: "j" })),
    generateShotPlan: () => activities.generateShotPlan(any({ job_id: "j" })),
    runPreflight: () => activities.runPreflight(any({ job_id: "j", plan: { shots: [] } })),
    routeShots: () =>
      activities.routeShots(any({ job_id: "j", plan: { shots: [] }, quality_mode: "STANDARD" })),
    generateDialogue: () => activities.generateDialogue(any({ job_id: "j" })),
    alignDialogue: () => activities.alignDialogue(any({ job_id: "j", dialogue_asset_ids: [] })),
    generateAmbience: () => activities.generateAmbience(any({ job_id: "j", shot_ids: [] })),
    generateReferences: () => activities.generateReferences(any({ job_id: "j" })),
    generateShot: () => activities.generateShot(any({ job_id: "j", shot })),
    runQc: () => activities.runQc(any({ job_id: "j", asset_id: "a", shot, qc_profile: "STANDARD" })),
    planRepair: () =>
      activities.planRepair(
        any({
          job_id: "j",
          shot,
          evaluation: { judges: [], scores: {}, quality_profile: "STANDARD" },
          budget: {
            max_generation_attempts: 3,
            max_repair_attempts: 2,
            max_gpu_seconds: 600,
            max_cost_units: 100,
          },
          spend: { generation_attempts: 1, repair_attempts: 0, gpu_seconds: 10, cost_units: 5 },
        }),
      ),
    applyRepair: () => activities.applyRepair(any({ job_id: "j", plan: {}, idempotency_key: "k" })),
    buildTimeline: () => activities.buildTimeline(any({ job_id: "j", plan: { shots: [] }, shot_assets: {} })),
    composeFinal: () => activities.composeFinal(any({ job_id: "j", timeline_id: "t" })),
    exportRenders: () => activities.exportRenders(any({ job_id: "j", render_asset_id: "a" })),
    recordShotTake: () =>
      activities.recordShotTake(
        any({ job_id: "j", shot_id: "s1", asset_id: "a", evaluation_id: "e", passed: true }),
      ),
    setJobStatus: () => activities.setJobStatus(any({ job_id: "j", status: "queued" })),
    saveCheckpoint: () => activities.saveCheckpoint(any({ job_id: "j", stage: "s", unit_id: null })),
    loadCheckpoint: () => activities.loadCheckpoint(any({ job_id: "j", stage: "s", unit_id: null })),
    recordSpend: () => activities.recordSpend(any({ job_id: "j", gpu_seconds: 0, cost_units: 0 })),
    releaseReservations: () => activities.releaseReservations(any({ job_id: "j" })),
  };
})();

async function failsWith(call: () => Promise<unknown>, type: string): Promise<boolean> {
  try {
    await call();
    return false;
  } catch (error) {
    const failure = error as { type?: string; name?: string; message?: string };
    return failure.type === type || failure.name === type || Boolean(failure.message?.includes(type));
  }
}

describe("the hardware boundary", () => {
  it.each(UNIMPLEMENTED_ACTIVITIES)("%s says plainly that it is not written", async (name) => {
    expect(await failsWith(CALLS[name], "NotImplemented")).toBe(true);
  });

  it.each(UNIMPLEMENTED_ACTIVITIES)("%s does not claim to be waiting on hardware", async (name) => {
    // The distinction the whole file turns on. "Blocked on hardware" is a
    // claim that the code exists, and for these four it does not.
    expect(await failsWith(CALLS[name], "NoCapacityError")).toBe(false);
  });

  const rest = (Object.keys(CALLS) as Array<keyof Activities>).filter(
    (name) => !(UNIMPLEMENTED_ACTIVITIES as readonly string[]).includes(name),
  );

  it.each(rest)("%s does not claim to be unimplemented", async (name) => {
    // These may well fail -- there is no database behind this test -- but they
    // must fail for the reason they actually have.
    expect(await failsWith(CALLS[name], "NotImplemented")).toBe(false);
  });

  it("covers every activity", () => {
    expect(Object.keys(CALLS).length).toBe(rest.length + UNIMPLEMENTED_ACTIVITIES.length);
  });

  it("names the activities that dispatch, and they are not in the unwritten list", () => {
    for (const name of DISPATCHING_ACTIVITIES) {
      expect(UNIMPLEMENTED_ACTIVITIES as readonly string[]).not.toContain(name);
      expect(Object.keys(CALLS)).toContain(name);
    }
  });
});
