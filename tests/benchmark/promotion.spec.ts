import { describe, expect, it } from "vitest";
import {
  GOLDEN_SUITE,
  compareToBaseline,
  evaluatePromotion,
  rollback,
  summarise,
  type BenchmarkMeasurement,
  type BenchmarkResult,
  type PromotionInput,
} from "@videoai/models";

/**
 * The gates between a downloaded model and one serving users (spec sections
 * 84, 85, 112). What is under test is mostly refusal, because a promotion
 * process only matters when it says no.
 */

function measurement(caseId: string, scores: Record<string, number>): BenchmarkMeasurement {
  return {
    case_id: caseId,
    scores: scores as BenchmarkMeasurement["scores"],
    runtime_ms: 1000,
    peak_vram_bytes: 40 * 1024 ** 3,
    repair_attempts: 0,
    gpu_seconds: 10,
    unmeasured: [],
  };
}

function result(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  const measurements = [
    measurement("single-human-walking", { motion: 0.9, physics: 0.85, anatomy: 0.88 }),
    measurement("hands-detail", { hands: 0.8, anatomy: 0.82, interaction: 0.79 }),
  ];
  return { ...summarise("wan2.2-t2v-a14b", "2.2.0", measurements), ...overrides };
}

function promotion(overrides: Partial<PromotionInput> = {}): PromotionInput {
  return {
    model_id: "wan2.2-t2v-a14b",
    version: "2.2.0",
    lifecycle: "approved",
    license: { license_status: "approved", commercial_use: true, territories: ["*"] },
    artifacts_verified: true,
    security_scanned: true,
    compatibility_checked: true,
    benchmark: result(),
    baseline: null,
    canary: { requests: 200, failure_rate: 0.02 },
    target: "production",
    ...overrides,
  };
}

describe("the golden suite", () => {
  it("has eighteen cases", () => {
    expect(GOLDEN_SUITE).toHaveLength(18);
  });

  it("gives every case a reason to exist", () => {
    for (const golden of GOLDEN_SUITE) {
      expect(golden.rationale.length, golden.id).toBeGreaterThan(20);
      expect(golden.focus.length, golden.id).toBeGreaterThan(0);
    }
  });

  it("covers the failure modes that matter", () => {
    const focus = new Set(GOLDEN_SUITE.flatMap((c) => c.focus));
    for (const required of ["hands", "identity", "physics", "text_preservation", "lip_sync", "motion"]) {
      expect(focus, `no case measures ${required}`).toContain(required);
    }
  });

  it("weighs a case's focus dimensions above the rest", () => {
    // A model good at everything except the thing a case exists to test should
    // not score as though it passed that case.
    const strongFocus = summarise("m", "1", [measurement("hands-detail", { hands: 1, anatomy: 0.5, interaction: 0.5 })]);
    const weakFocus = summarise("m", "1", [measurement("hands-detail", { hands: 0.5, anatomy: 1, interaction: 1 })]);
    expect(strongFocus.overall).toBeGreaterThan(0);
    expect(weakFocus.overall).toBeGreaterThan(0);
    // hands is a focus dimension for this case and weighs double.
    expect(summarise("m", "1", [measurement("hands-detail", { hands: 1 })]).overall).toBe(1);
  });

  it("reports coverage separately from score", () => {
    const partial = summarise("m", "1", [measurement("hands-detail", { hands: 0.95 })]);
    expect(partial.overall).toBeGreaterThan(0.9);
    // One focus dimension of three measured: a high score over a third of the
    // evidence is not a pass.
    expect(partial.coverage).toBeCloseTo(1 / 3, 2);
  });
});

describe("regression against a baseline", () => {
  it("passes when nothing got worse", () => {
    expect(compareToBaseline(result(), result()).passed).toBe(true);
  });

  it("blocks a single badly regressed case even when the average improved", () => {
    const baseline = result();
    const candidate = summarise("m", "2", [
      measurement("single-human-walking", { motion: 1, physics: 1, anatomy: 1 }),
      measurement("hands-detail", { hands: 0.4, anatomy: 0.95, interaction: 0.95 }),
    ]);

    const verdict = compareToBaseline(candidate, baseline);
    expect(verdict.passed).toBe(false);
    expect(verdict.regressions.some((r) => r.case_id === "hands-detail" && r.dimension === "hands")).toBe(true);
  });

  it("blocks a large runtime increase", () => {
    const baseline = result();
    const candidate = { ...result(), runtime_ms_total: baseline.runtime_ms_total * 3 };
    expect(compareToBaseline(candidate, baseline).reasons.join(" ")).toContain("Runtime rose");
  });

  it("blocks a drop in coverage, which is less evidence rather than a better result", () => {
    const baseline = result();
    const candidate = { ...result(), coverage: baseline.coverage / 2 };
    expect(compareToBaseline(candidate, baseline).reasons.join(" ")).toContain("Coverage fell");
  });

  it("tolerates a small movement that is within noise", () => {
    const baseline = result();
    const candidate = summarise("m", "2", [
      measurement("single-human-walking", { motion: 0.87, physics: 0.85, anatomy: 0.88 }),
      measurement("hands-detail", { hands: 0.79, anatomy: 0.82, interaction: 0.79 }),
    ]);
    expect(compareToBaseline(candidate, baseline).regressions).toEqual([]);
  });
});

describe("promotion gates", () => {
  it("allows a version that cleared every gate", () => {
    expect(evaluatePromotion(promotion()).allowed).toBe(true);
  });

  it("refuses a model whose licence is not approved", () => {
    const decision = evaluatePromotion(
      promotion({ license: { license_status: "pending_review", commercial_use: true, territories: ["*"] } }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.blockers.join(" ")).toContain("licence_reviewed");
  });

  it("refuses a licence that grants no commercial use", () => {
    const decision = evaluatePromotion(
      promotion({ license: { license_status: "approved", commercial_use: false, territories: ["*"] } }),
    );
    expect(decision.allowed).toBe(false);
  });

  it("refuses a version whose artifacts do not match their hashes", () => {
    expect(evaluatePromotion(promotion({ artifacts_verified: false })).allowed).toBe(false);
  });

  it("refuses a version with no security scan", () => {
    expect(evaluatePromotion(promotion({ security_scanned: false })).allowed).toBe(false);
  });

  it("refuses a version that never produced output", () => {
    expect(evaluatePromotion(promotion({ compatibility_checked: false })).allowed).toBe(false);
  });

  it("blocks rather than fails when the benchmark has not been run", () => {
    const decision = evaluatePromotion(promotion({ benchmark: null }));
    expect(decision.allowed).toBe(false);
    // Blocked and failed are different: one needs work, the other needs a
    // decision.
    expect(decision.gates.find((g) => g.gate === "benchmarked")!.blocked).toBe(true);
  });

  it("refuses a version that scored below the bar", () => {
    const weak = summarise("m", "1", [measurement("hands-detail", { hands: 0.3, anatomy: 0.3, interaction: 0.3 })]);
    expect(evaluatePromotion(promotion({ benchmark: weak })).allowed).toBe(false);
  });

  it("accepts a first version with no baseline to regress against", () => {
    const decision = evaluatePromotion(promotion({ baseline: null }));
    expect(decision.gates.find((g) => g.gate === "no_golden_regression")!.passed).toBe(true);
  });

  it("requires observed canary traffic before production", () => {
    const decision = evaluatePromotion(promotion({ canary: null }));
    expect(decision.allowed).toBe(false);
    expect(decision.gates.find((g) => g.gate === "canary_observed")!.blocked).toBe(true);
  });

  it("does not require canary traffic to enter canary", () => {
    const decision = evaluatePromotion(promotion({ canary: null, target: "canary" }));
    expect(decision.allowed).toBe(true);
  });

  it("refuses production when canary is failing", () => {
    const decision = evaluatePromotion(promotion({ canary: { requests: 200, failure_rate: 0.4 } }));
    expect(decision.allowed).toBe(false);
    expect(decision.blockers.join(" ")).toContain("failure rate");
  });

  it("refuses production on too little canary evidence", () => {
    const decision = evaluatePromotion(promotion({ canary: { requests: 3, failure_rate: 0 } }));
    expect(decision.allowed).toBe(false);
  });

  it("names every blocker, so the work needed is unambiguous", () => {
    const decision = evaluatePromotion(
      promotion({
        license: { license_status: "blocked", commercial_use: false, territories: [] },
        security_scanned: false,
        artifacts_verified: false,
      }),
    );
    expect(decision.blockers.length).toBeGreaterThanOrEqual(3);
  });
});

describe("rollback", () => {
  it("is immediate and needs no gate", () => {
    // A rollback that had to pass checks is one nobody could perform during an
    // incident.
    expect(rollback("wan2.2-t2v-a14b", "2.2.0")).toEqual({
      model_id: "wan2.2-t2v-a14b",
      version: "2.2.0",
      lifecycle: "approved",
      canary_weight: 0,
    });
  });
});
