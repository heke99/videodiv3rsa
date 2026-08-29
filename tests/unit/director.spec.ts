import { describe, expect, it, vi } from "vitest";
import type { CapabilitySnapshot, CreateVideoRequest, Shot } from "@videoai/contracts";
import {
  Director,
  DirectorSchemaError,
  Planner,
  preflight,
  reconcileDurations,
  type DirectorBackend,
} from "@videoai/director";

/**
 * The Director is the one component that can produce anything, so what is
 * tested here is the boundary around it: that invalid output never escapes,
 * that the user's own constraints are not reinterpreted, and that a plan is
 * arithmetically sound before anything is generated from it.
 */

const capabilities: CapabilitySnapshot = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  models: [
    { model_id: "wan2.2-t2v-a14b", version: "2.2.0", generation_kinds: ["text_to_video"], max_duration_frames: 121 },
    { model_id: "wan2.2-i2v-a14b", version: "2.2.0", generation_kinds: ["image_to_video"], max_duration_frames: 121 },
  ],
  skills: [{ skill_id: "wan-t2v-prompt", version: "1.0" }],
  available_profiles: ["GPU_PROFILE_ULTRA"],
  voices: ["voice_001"],
  quality_modes: ["STANDARD", "UGC"],
};

const timebase = { num: 24, den: 1 };

/** A backend that replays canned responses, so planning is deterministic. */
function fixtureBackend(responses: string[]): DirectorBackend & { calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    async complete(params) {
      calls.push(params.user);
      return responses[Math.min(index++, responses.length - 1)]!;
    },
  };
}

const validBrief = JSON.stringify({
  schema_version: "1.0",
  goal: "Sell the serum to people who gave up on retinol",
  audience: "Women 25-40 who tried three retinols and stopped",
  platform: "tiktok",
  target_duration_frames: 999,
  aspect_ratio: "16:9",
  quality_mode: "CINEMATIC",
  tone: ["honest", "warm"],
  style: "handheld creator",
  hook: "I gave up on retinol twice before this",
  language: "en",
});

function shot(id: string, index: number, frames: number): Shot {
  return {
    id, scene_id: "scene_01", index,
    description: "d", action: "a", shot_type: "medium",
    duration_frames: frames,
    camera: { framing: "medium", lens: "", movement: "static", height: "eye_level", focus_behavior: "" },
    character_ids: [], product_ids: [], location_id: null, dialogue_line_ids: [],
    motion_complexity: 0.5, continuity_requirement: 0.5,
    requires_identity_lock: false, requires_product_fidelity: false,
    preferred_generation_kind: "text_to_video",
    start_frame_asset: null, end_frame_asset: null, notes: "",
  };
}

describe("Director output validation", () => {
  it("returns a plan that satisfies its schema", async () => {
    const planner = new Planner(new Director(fixtureBackend([validBrief])));
    const brief = await planner.brief(createRequest(), { capabilities, timebase });
    expect(brief.hook).toBe("I gave up on retinol twice before this");
  });

  it("recovers JSON the model wrapped in a code fence", async () => {
    const planner = new Planner(new Director(fixtureBackend(["```json\n" + validBrief + "\n```"])));
    const brief = await planner.brief(createRequest(), { capabilities, timebase });
    expect(brief.audience).toContain("retinols");
  });

  it("retries with the validation errors fed back, then succeeds", async () => {
    const backend = fixtureBackend([JSON.stringify({ goal: "too thin" }), validBrief]);
    const planner = new Planner(new Director(backend));

    const brief = await planner.brief(createRequest(), { capabilities, timebase });
    expect(brief.goal).toContain("Sell the serum");
    expect(backend.calls).toHaveLength(2);
    // The second prompt must name what was wrong, otherwise the retry is a
    // coin flip rather than a correction.
    expect(backend.calls[1]).toContain("Your previous response was rejected");
    expect(backend.calls[1]).toContain("audience");
  });

  it("fails loudly rather than passing invalid output downstream", async () => {
    const planner = new Planner(new Director(fixtureBackend([JSON.stringify({ goal: "x" })])));
    await expect(planner.brief(createRequest(), { capabilities, timebase })).rejects.toThrow(
      DirectorSchemaError,
    );
  });

  it("fails loudly when the model returns no JSON at all", async () => {
    const planner = new Planner(new Director(fixtureBackend(["I would suggest a warm opening shot."])));
    await expect(planner.brief(createRequest(), { capabilities, timebase })).rejects.toThrow(
      /not valid JSON|does not satisfy/,
    );
  });
});

describe("Director constraints", () => {
  it("puts the capability list in the prompt so nothing else can be referenced", async () => {
    const backend = fixtureBackend([validBrief]);
    await new Planner(new Director(backend)).brief(createRequest(), { capabilities, timebase });

    expect(backend.calls[0]).toContain("wan2.2-t2v-a14b");
    expect(backend.calls[0]).toContain("You may only reference the models, skills and voices listed above");
    expect(backend.calls[0]).not.toContain("hunyuan");
  });

  it("does not let the Director reinterpret duration, aspect or mode", async () => {
    // The fixture brief claims 999 frames, 16:9 and CINEMATIC; the user asked
    // for 30 seconds, 9:16 and UGC. The user wins.
    const planner = new Planner(new Director(fixtureBackend([validBrief])));
    const brief = await planner.brief(createRequest(), { capabilities, timebase });

    expect(brief.target_duration_frames).toBe(720);
    expect(brief.aspect_ratio).toBe("9:16");
    expect(brief.quality_mode).toBe("UGC");
  });

  it("converts the user's seconds into whole frames exactly once", async () => {
    const planner = new Planner(new Director(fixtureBackend([validBrief])));
    const brief = await planner.brief(createRequest({ target_duration_seconds: 7.3 }), {
      capabilities,
      timebase,
    });
    expect(Number.isInteger(brief.target_duration_frames)).toBe(true);
    expect(brief.target_duration_frames).toBe(175);
  });
});

describe("duration reconciliation", () => {
  it("leaves a plan alone when it already adds up", () => {
    const shots = [shot("a", 0, 48), shot("b", 1, 48)];
    expect(reconcileDurations(shots, 96).map((s) => s.duration_frames)).toEqual([48, 48]);
  });

  it("scales a plan that overruns and lands exactly on the target", () => {
    const shots = [shot("a", 0, 100), shot("b", 1, 100), shot("c", 2, 100)];
    const result = reconcileDurations(shots, 240);
    expect(result.reduce((n, s) => n + s.duration_frames, 0)).toBe(240);
  });

  it("puts the rounding remainder on the longest shot", () => {
    const shots = [shot("a", 0, 10), shot("b", 1, 10), shot("c", 2, 100)];
    const result = reconcileDurations(shots, 100);
    expect(result.reduce((n, s) => n + s.duration_frames, 0)).toBe(100);
    // The two short shots stay usable rather than being rounded into nothing.
    expect(result[0]!.duration_frames).toBeGreaterThan(0);
    expect(result[1]!.duration_frames).toBeGreaterThan(0);
  });

  it("never rounds a shot down to zero frames", () => {
    const shots = [shot("a", 0, 1), shot("b", 1, 1), shot("c", 2, 1000)];
    const result = reconcileDurations(shots, 100);
    expect(result.every((s) => s.duration_frames >= 1)).toBe(true);
    expect(result.reduce((n, s) => n + s.duration_frames, 0)).toBe(100);
  });
});

describe("preflight", () => {
  const base = {
    plan: { schema_version: "1.0", scenes: [], shots: [], dependencies: [] } as never,
    routableModelIds: ["wan2.2-t2v-a14b"],
    requiredModelIds: ["wan2.2-t2v-a14b"],
    installedModelIds: ["wan2.2-t2v-a14b"],
    availableProfileCount: 1,
    referencesValid: true,
    storageAvailable: true,
    quotaRemainingUnits: 1000,
    estimatedCostUnits: 100,
    estimatedGpuSeconds: 200,
    estimatedQueueSeconds: 30,
    estimatedRenderSeconds: 60,
  };

  it("passes when everything is in place", () => {
    const report = preflight(base);
    expect(report.blockers).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("blocks on a model whose licence has not been approved", () => {
    const report = preflight({ ...base, routableModelIds: [] });
    expect(report.passed).toBe(false);
    expect(report.licenses_approved).toBe(false);
    expect(report.blockers[0]).toContain("not cleared for use");
  });

  it("blocks when the model is not installed and verified on a worker", () => {
    const report = preflight({ ...base, installedModelIds: [] });
    expect(report.models_installed).toBe(false);
  });

  it("blocks when no GPU is available rather than queueing forever", () => {
    expect(preflight({ ...base, availableProfileCount: 0 }).gpu_available).toBe(false);
  });

  it("blocks when the estimate exceeds the remaining quota", () => {
    const report = preflight({ ...base, quotaRemainingUnits: 50 });
    expect(report.budget_sufficient).toBe(false);
    expect(report.blockers[0]).toContain("Estimated cost");
  });

  it("labels its numbers as estimates", () => {
    expect(preflight(base).is_estimate).toBe(true);
  });
});

function createRequest(overrides: Partial<CreateVideoRequest> = {}): CreateVideoRequest {
  return {
    prompt: "a UGC ad where a woman talks about the serum",
    mode: "UGC",
    aspect_ratio: "9:16",
    target_duration_seconds: 30,
    attachments: [],
    approval_gates: false,
    ...overrides,
  };
}
