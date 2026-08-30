import { describe, expect, it } from "vitest";
import type { Activities } from "@videoai/orchestrator";
import {
  createActivities,
  HARDWARE_BOUND_ACTIVITIES,
} from "../../services/orchestrator/src/activities/implementations.js";

/**
 * What actually needs a GPU, pinned.
 *
 * The interesting failure this guards against is the cheerful one: an activity
 * that reports "requires a provisioned GPU worker" when it needs nothing of the
 * sort makes the whole system look more blocked than it is, and four of these
 * did exactly that until the delivery path was wired up. So the boundary is
 * asserted in both directions -- what must refuse, and what must not.
 */

const ENV: Record<string, string> = {
  NODE_ENV: "test",
  PUBLIC_APP_URL: "https://example.test",
  APP_NAME: "test",
  APP_DOMAIN: "example.test",
  AUTH_CALLBACK_URL: "https://example.test/auth/callback",
  // Port 1 is reserved and never listening, so the CPU-bound activities fail
  // fast on connection refused rather than hanging on a real database.
  DATABASE_URL: "postgres://user:pw@127.0.0.1:1/videoai",
  STORAGE_PROVIDER: "local",
  STORAGE_BUCKET: "test",
  STORAGE_LOCAL_ROOT: "/tmp/videoai-boundary-test",
  GPU_PROVIDER: "manual",
  GPU_GATEWAY_SIGNING_KEY: "0".repeat(64),
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
    planRepair: () => activities.planRepair(any({ job_id: "j", shot, evaluation: {} })),
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

async function refusesForHardware(call: () => Promise<unknown>): Promise<boolean> {
  try {
    await call();
    return false;
  } catch (error) {
    return (error as { type?: string }).type === "NoGpuWorker";
  }
}

describe("the hardware boundary", () => {
  it.each(HARDWARE_BOUND_ACTIVITIES)("%s refuses without a GPU worker", async (name) => {
    expect(await refusesForHardware(CALLS[name])).toBe(true);
  });

  const cpuBound = (Object.keys(CALLS) as Array<keyof Activities>).filter(
    (name) => !(HARDWARE_BOUND_ACTIVITIES as readonly string[]).includes(name),
  );

  it.each(cpuBound)("%s does not claim to need a GPU", async (name) => {
    // These may well fail -- there is no database behind this test -- but they
    // must fail for the reason they actually have, not by blaming hardware.
    expect(await refusesForHardware(CALLS[name])).toBe(false);
  });

  it("covers every activity", () => {
    expect(Object.keys(CALLS).length).toBe(cpuBound.length + HARDWARE_BOUND_ACTIVITIES.length);
  });
});
