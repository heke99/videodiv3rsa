import { describe, expect, it } from "vitest";
import type { Shot, ShotPlan } from "@videoai/contracts";
import { deriveDependencies, invalidate, validatePlanGraph } from "@videoai/scene-bible";

/**
 * Dependency invalidation (spec section 15). The property under test is
 * minimality: changing one entity must mark exactly the shots that depend on
 * it, plus what continues from them, and nothing else.
 */

function shot(id: string, index: number, overrides: Partial<Shot> = {}): Shot {
  return {
    id,
    scene_id: "scene_01",
    index,
    description: "d",
    action: "a",
    shot_type: "medium",
    duration_frames: 96,
    camera: { framing: "medium", lens: "", movement: "static", height: "eye_level", focus_behavior: "" },
    character_ids: [],
    product_ids: [],
    location_id: "location_01",
    dialogue_line_ids: [],
    motion_complexity: 0.5,
    continuity_requirement: 0.5,
    requires_identity_lock: false,
    requires_product_fidelity: false,
    preferred_generation_kind: "text_to_video",
    start_frame_asset: null,
    end_frame_asset: null,
    notes: "",
    ...overrides,
  };
}

function plan(shots: Shot[]): ShotPlan {
  return {
    schema_version: "1.0",
    scenes: [{ id: "scene_01", index: 0, summary: "s", location_id: "location_01", shot_ids: shots.map((s) => s.id) }],
    shots,
    dependencies: deriveDependencies(shots),
  };
}

describe("dependency derivation", () => {
  it("links a shot to its characters, products and location", () => {
    const edges = deriveDependencies([
      shot("shot_01", 0, { character_ids: ["character_001"], product_ids: ["product_001"] }),
    ]);
    expect(edges).toContainEqual({ shot_id: "shot_01", kind: "character", ref: "character_001" });
    expect(edges).toContainEqual({ shot_id: "shot_01", kind: "product", ref: "product_001" });
    expect(edges).toContainEqual({ shot_id: "shot_01", kind: "location", ref: "location_01" });
  });

  it("chains consecutive shots in a scene through the end frame", () => {
    const edges = deriveDependencies([shot("shot_01", 0), shot("shot_02", 1)]);
    expect(edges).toContainEqual({ shot_id: "shot_02", kind: "shot_end_frame", ref: "shot_01" });
  });

  it("breaks the chain where a shot has its own keyframe", () => {
    const edges = deriveDependencies([
      shot("shot_01", 0),
      shot("shot_02", 1, { start_frame_asset: { asset_id: "11111111-1111-4111-8111-111111111111" } }),
    ]);
    expect(edges.filter((e) => e.kind === "shot_end_frame")).toEqual([]);
  });

  it("does not chain across a scene boundary", () => {
    const edges = deriveDependencies([shot("shot_01", 0), shot("shot_02", 1, { scene_id: "scene_02" })]);
    expect(edges.filter((e) => e.kind === "shot_end_frame")).toEqual([]);
  });
});

describe("invalidation", () => {
  it("marks only the shots that use the changed character", () => {
    const p = plan([
      shot("shot_01", 0, { character_ids: ["character_001"], start_frame_asset: { asset_id: "11111111-1111-4111-8111-111111111111" } }),
      shot("shot_02", 1, { character_ids: ["character_002"], start_frame_asset: { asset_id: "22222222-2222-4222-8222-222222222222" } }),
      shot("shot_03", 2, { character_ids: ["character_001"], start_frame_asset: { asset_id: "33333333-3333-4333-8333-333333333333" } }),
    ]);
    const [result] = invalidate(p, [{ kind: "character", ref: "character_001" }]);
    expect(result!.stale_shot_ids).toEqual(["shot_01", "shot_03"]);
  });

  it("propagates forward through frame handoffs but not backwards", () => {
    const p = plan([
      shot("shot_01", 0),
      shot("shot_02", 1, { character_ids: ["character_001"] }),
      shot("shot_03", 2),
      shot("shot_04", 3),
    ]);
    const [result] = invalidate(p, [{ kind: "character", ref: "character_001" }]);
    expect(result!.stale_shot_ids).toEqual(["shot_02", "shot_03", "shot_04"]);
    expect(result!.stale_shot_ids).not.toContain("shot_01");
  });

  it("records why each shot went stale", () => {
    const p = plan([shot("shot_01", 0, { character_ids: ["character_001"] }), shot("shot_02", 1)]);
    const [result] = invalidate(p, [{ kind: "character", ref: "character_001" }]);
    expect(result!.reasons["shot_01"]![0]).toContain('depends on character "character_001"');
    expect(result!.reasons["shot_02"]![0]).toContain("continues from shot");
  });

  it("returns nothing when the changed entity is unused", () => {
    const p = plan([shot("shot_01", 0, { character_ids: ["character_001"] })]);
    const [result] = invalidate(p, [{ kind: "product", ref: "product_999" }]);
    expect(result!.stale_shot_ids).toEqual([]);
  });

  it("terminates on a cyclic graph rather than looping", () => {
    const shots = [shot("shot_01", 0, { character_ids: ["character_001"] }), shot("shot_02", 1)];
    const cyclic: ShotPlan = {
      schema_version: "1.0",
      scenes: [{ id: "scene_01", index: 0, summary: "s", location_id: null, shot_ids: ["shot_01", "shot_02"] }],
      shots,
      dependencies: [
        { shot_id: "shot_01", kind: "character", ref: "character_001" },
        { shot_id: "shot_02", kind: "shot_end_frame", ref: "shot_01" },
        { shot_id: "shot_01", kind: "shot_end_frame", ref: "shot_02" },
      ],
    };
    const [result] = invalidate(cyclic, [{ kind: "character", ref: "character_001" }]);
    expect(result!.stale_shot_ids).toEqual(["shot_01", "shot_02"]);
  });
});

describe("plan validation", () => {
  it("reports edges that point at shots which do not exist", () => {
    const p: ShotPlan = {
      schema_version: "1.0",
      scenes: [{ id: "scene_01", index: 0, summary: "s", location_id: null, shot_ids: ["shot_01"] }],
      shots: [shot("shot_01", 0)],
      dependencies: [{ shot_id: "shot_01", kind: "shot_end_frame", ref: "shot_missing" }],
    };
    expect(validatePlanGraph(p)).toContain('Shot shot_01 reads a frame from unknown shot shot_missing');
  });
});
