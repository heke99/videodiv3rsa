import { describe, expect, it } from "vitest";
import type { QualityEvaluation, RetryBudget } from "@videoai/contracts";
import { createActivities } from "../../services/orchestrator/src/activities/implementations.js";

/**
 * Who decides how a shot gets repaired.
 *
 * Scope, cost and whether the budget can cover a fix are arithmetic, and
 * packages/quality/src/repair.ts makes them arithmetic. For a while the
 * orchestrator asked the Director for the whole repair plan instead, which
 * handed all three back to a model: an LLM deciding that a 60-second shot
 * regeneration fits in 12 remaining GPU seconds is a decision that cannot be
 * tested and will sometimes be wrong in the expensive direction.
 *
 * These tests pin the division. The Director's endpoint here points at a closed
 * port, so any test that passes without a connection error is a test where the
 * Director was never consulted -- which is the point being asserted.
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
  STORAGE_LOCAL_ROOT: "/tmp/videoai-repair-test",
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

const shot = {
  id: "shot_01",
  scene_id: "scene_01",
  index: 0,
  description: "d",
  action: "a",
  shot_type: "medium",
  duration_frames: 48,
  camera: { framing: "medium", lens: "", movement: "static", height: "eye_level", focus_behavior: "" },
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

/** A failure that wants a full shot regeneration: the most expensive scope. */
function severeEvaluation(): QualityEvaluation {
  return {
    schema_version: "1.0",
    subject_kind: "shot",
    subject_id: "shot_01",
    quality_profile: "STANDARD",
    overall: 0.2,
    scores: { temporal_consistency: 0.1 },
    judges: [
      {
        judge_id: "temporal-consistency-judge",
        judge_version: "1.0",
        status: "fail",
        score: 0.1,
        confidence: 1,
        findings: [
          {
            code: "scene_collapse",
            severity: "critical",
            message: "The shot loses its subject halfway through",
            frames: [24],
            entity_ref: null,
          },
        ],
        recommended_actions: [],
        metrics: {},
        repair_scope: "shot",
      },
    ],
    passed: false,
  };
}

const budget: RetryBudget = {
  max_generation_attempts: 3,
  max_repair_attempts: 2,
  max_gpu_seconds: 600,
  max_cost_units: 100,
};

describe("who decides a repair", () => {
  const activities = createActivities();

  it("refuses a repair the remaining budget cannot finish, without asking a model", async () => {
    const decision = await activities.planRepair({
      job_id: "job",
      shot,
      evaluation: severeEvaluation(),
      budget,
      // Twelve seconds left against a scope that costs an order of magnitude
      // more. Starting it would spend the rest of the budget and produce
      // nothing.
      spend: { generation_attempts: 1, repair_attempts: 0, gpu_seconds: 588, cost_units: 10 },
    });

    expect(decision.needs_review).toBe(true);
    expect(decision.plan.scope).toBe("none");
    expect(decision.reason).toMatch(/GPU/);
  });

  it("refuses once the repair attempts are spent", async () => {
    const decision = await activities.planRepair({
      job_id: "job",
      shot,
      evaluation: severeEvaluation(),
      budget,
      spend: { generation_attempts: 1, repair_attempts: 2, gpu_seconds: 10, cost_units: 5 },
    });

    expect(decision.needs_review).toBe(true);
    expect(decision.reason).toMatch(/budget is spent/);
  });

  it("has nothing to do when nothing failed, and does not ask", async () => {
    const decision = await activities.planRepair({
      job_id: "job",
      shot,
      evaluation: {
        ...severeEvaluation(),
        overall: 0.95,
        passed: true,
        judges: [],
      },
      budget,
      spend: { generation_attempts: 1, repair_attempts: 0, gpu_seconds: 10, cost_units: 5 },
    });

    expect(decision.plan.scope).toBe("none");
    expect(decision.needs_review).toBe(false);
  });
});
