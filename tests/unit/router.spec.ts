import { describe, expect, it } from "vitest";
import type { RoutingRequest, RoutingRule } from "@videoai/contracts";
import { ModelId, RoutingDecision, Slug } from "@videoai/contracts";
import { checkLicenseGate, route, RoutingError, type RoutableModel } from "@videoai/models";

/**
 * Routing and the licence gate (spec sections 17, 65, 85). The behaviour under
 * test is mostly refusal: the router must decline rather than substitute.
 */

const approvedLicense = {
  license_status: "approved" as const,
  commercial_use: true,
  territories: ["*"],
};

function model(overrides: Partial<RoutableModel> = {}): RoutableModel {
  return {
    model_id: "wan2.2-t2v-a14b",
    version: "2.2.0",
    adapter: "WanAdapter",
    runtime: "runtime-wan",
    lifecycle: "production",
    required_profile: "GPU_PROFILE_ULTRA",
    required_vram_gib: 80,
    supported_precisions: ["bf16", "fp8"],
    generation_kinds: ["text_to_video"],
    max_duration_frames: 121,
    license: approvedLicense,
    ...overrides,
  };
}

const defaultRule: RoutingRule = {
  id: "default-t2v",
  priority: 10,
  enabled: true,
  match: { generation_kind: ["text_to_video"] },
  target: {
    model_id: "wan2.2-t2v-a14b",
    precision: "bf16",
    generation_profile: "t2v_standard",
    qc_profile: "STANDARD",
    skills: ["wan-t2v-prompt"],
  },
  reason: "Fallback for text to video.",
};

function request(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return {
    generation_kind: "text_to_video",
    quality_mode: "STANDARD",
    duration_frames: 96,
    resolution: { width: 720, height: 1280 },
    human_count: 0,
    has_dialogue: false,
    has_reference_images: false,
    motion_complexity: 0.5,
    continuity_requirement: 0.5,
    requires_product_fidelity: false,
    requires_identity_lock: false,
    available_profiles: ["GPU_PROFILE_ULTRA"],
    ...overrides,
  };
}

describe("licence gate", () => {
  it("allows only an approved, commercial, promoted model", () => {
    expect(
      checkLicenseGate({
        model_id: "m",
        lifecycle: "production",
        license_status: "approved",
        commercial_use: true,
        territories: ["*"],
      }).allowed,
    ).toBe(true);
  });

  it.each(["unknown", "pending_review", "blocked", "expired_review"] as const)(
    "denies licence status %s",
    (status) => {
      const decision = checkLicenseGate({
        model_id: "m",
        lifecycle: "production",
        license_status: status,
        commercial_use: true,
        territories: ["*"],
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain(status);
    },
  );

  it("denies an approved licence that does not grant commercial use", () => {
    expect(
      checkLicenseGate({
        model_id: "m",
        lifecycle: "production",
        license_status: "approved",
        commercial_use: false,
        territories: ["*"],
      }).allowed,
    ).toBe(false);
  });

  it("denies a model whose version has not been promoted past candidate", () => {
    expect(
      checkLicenseGate({
        model_id: "m",
        lifecycle: "candidate",
        license_status: "approved",
        commercial_use: true,
        territories: ["*"],
      }).allowed,
    ).toBe(false);
  });

  it("denies delivery into a territory the licence does not cover", () => {
    expect(
      checkLicenseGate({
        model_id: "m",
        lifecycle: "production",
        license_status: "approved",
        commercial_use: true,
        territories: ["US"],
        target_territory: "SE",
      }).allowed,
    ).toBe(false);
  });
});

describe("model router", () => {
  it("routes a plain text-to-video shot to the default rule", () => {
    const decision = route(request(), { rules: [defaultRule], models: [model()] });
    expect(decision.model_id).toBe("wan2.2-t2v-a14b");
    expect(decision.precision).toBe("bf16");
    expect(decision.rule_id).toBe("default-t2v");
  });

  it("prefers the higher priority rule when both match", () => {
    const identityRule: RoutingRule = {
      ...defaultRule,
      id: "identity-locked-i2v",
      priority: 90,
      match: { generation_kind: ["text_to_video"], requires_identity_lock: true },
      target: { ...defaultRule.target, model_id: "wan2.2-i2v-a14b", qc_profile: "REALISTIC" },
    };
    const decision = route(request({ requires_identity_lock: true }), {
      rules: [defaultRule, identityRule],
      models: [
        model(),
        model({ model_id: "wan2.2-i2v-a14b", generation_kinds: ["text_to_video", "image_to_video"] }),
      ],
    });
    expect(decision.model_id).toBe("wan2.2-i2v-a14b");
    expect(decision.qc_profile).toBe("REALISTIC");
  });

  it("refuses rather than substituting when the only candidate is unlicensed", () => {
    expect(() =>
      route(request(), {
        rules: [defaultRule],
        models: [model({ license: { ...approvedLicense, license_status: "pending_review" } })],
      }),
    ).toThrow(RoutingError);
  });

  it("refuses when the shot is longer than the model can produce", () => {
    expect(() =>
      route(request({ duration_frames: 400 }), { rules: [defaultRule], models: [model()] }),
    ).toThrow(/handles at most 121 frames/);
  });

  it("refuses when the fleet has no worker large enough", () => {
    expect(() =>
      route(request({ available_profiles: ["GPU_PROFILE_ECONOMY"] }), {
        rules: [defaultRule],
        models: [model()],
      }),
    ).toThrow(/needs GPU_PROFILE_ULTRA/);
  });

  it("accepts a larger profile than the model requires", () => {
    const decision = route(request({ available_profiles: ["GPU_PROFILE_ULTRA"] }), {
      rules: [defaultRule],
      models: [model({ required_profile: "GPU_PROFILE_STANDARD", required_vram_gib: 40 })],
    });
    expect(decision.model_id).toBe("wan2.2-t2v-a14b");
  });

  it("names every candidate it rejected so the failure is diagnosable", () => {
    try {
      route(request(), {
        rules: [defaultRule],
        models: [model({ license: { ...approvedLicense, license_status: "blocked" } })],
      });
      expect.unreachable("routing should have thrown");
    } catch (error) {
      expect((error as RoutingError).considered).toHaveLength(1);
      expect((error as Error).message).toContain("default-t2v");
    }
  });
});

describe("model identifiers", () => {
  // Real model ids carry the upstream family version, so they contain dots.
  // Validating them as entity slugs rejected every model we actually ship,
  // which went unnoticed because the router's own types are structural.
  const REAL_IDS = ["wan2.2-t2v-a14b", "wan2.2-i2v-a14b", "wan2.2-s2v-14b", "qwen-image-2", "mmaudio"];

  it("accepts the ids of the models we ship", () => {
    for (const id of REAL_IDS) {
      expect(ModelId.safeParse(id).success, id).toBe(true);
    }
  });

  it("still rejects an id that could be a path or a header injection", () => {
    for (const bad of ["../etc/passwd", "model id", "MODEL", "model\nid", ""]) {
      expect(ModelId.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("keeps entity slugs strict, where a dot has no meaning", () => {
    expect(Slug.safeParse("character_001").success).toBe(true);
    expect(Slug.safeParse("wan2.2-t2v-a14b").success).toBe(false);
  });

  it("validates a routing decision carrying a real model id", () => {
    const decision = route(request(), { rules: [defaultRule], models: [model()] });
    expect(RoutingDecision.safeParse(decision).success).toBe(true);
  });
});
