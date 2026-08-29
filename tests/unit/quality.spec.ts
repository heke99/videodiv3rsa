import { describe, expect, it } from "vitest";
import type { JudgeResult, QualityEvaluation } from "@videoai/contracts";
import {
  QUALITY_PROFILES,
  aggregate,
  blindSpots,
  calibrate,
  classify,
  coverage,
  errorRates,
  flickerScore,
  pearson,
  planRepair,
  recommendThreshold,
  temporalConsistency,
  type CalibrationSample,
  type Judge,
} from "@videoai/quality";

/**
 * The parts of QC that are pure computation: how signals become scores, how
 * scores become a verdict, and how a verdict becomes the smallest repair.
 */

function judge(id: string, dimension: Judge["dimension"], available = true): Judge {
  return { id, version: "1.0", dimension, available, run: async () => ({}) as JudgeResult };
}

function judgeResult(over: Partial<JudgeResult> = {}): JudgeResult {
  return {
    judge_id: "j", judge_version: "1.0", status: "pass", score: 1, confidence: 1,
    findings: [], recommended_actions: [], metrics: {}, repair_scope: "none", ...over,
  };
}

describe("flicker detection", () => {
  it("passes a smoothly changing series", () => {
    expect(flickerScore([100, 101, 102, 103, 104, 105]).oscillation_ratio).toBeLessThan(0.3);
  });

  it("catches an alternating series", () => {
    const { oscillation_ratio, score } = flickerScore([100, 118, 99, 120, 98, 119, 97]);
    expect(oscillation_ratio).toBeGreaterThan(0.8);
    expect(score).toBeLessThan(0.2);
  });

  it("ignores noise below the visible threshold", () => {
    // Tiny alternation is sensor noise, not flicker.
    expect(flickerScore([100, 100.05, 100, 100.05, 100]).score).toBeGreaterThan(0.5);
  });

  it("does not flag a one-off lighting change", () => {
    expect(flickerScore([60, 61, 62, 105, 106, 107, 108]).score).toBeGreaterThan(0.6);
  });

  it("handles a series too short to judge", () => {
    expect(flickerScore([100, 101]).score).toBe(1);
  });
});

describe("temporal consistency", () => {
  it("passes a shot whose frame differences are steady", () => {
    expect(temporalConsistency([5, 5.2, 4.9, 5.1, 5, 5.05]).spikes).toEqual([]);
  });

  it("catches a discontinuity and names the frame", () => {
    const { spikes } = temporalConsistency([5, 5.1, 4.9, 60, 5, 5.1, 5]);
    expect(spikes).toContain(4);
  });

  it("tolerates consistently large differences under fast motion", () => {
    // High but steady difference is a pan, not a defect.
    expect(temporalConsistency([40, 41, 39, 40, 41, 40]).spikes).toEqual([]);
  });
});

describe("ensemble aggregation", () => {
  const judges = [
    judge("flicker-judge", "flicker"),
    judge("motion-judge", "motion"),
    judge("identity-judge", "identity", false),
  ];
  const options = { subject_kind: "shot" as const, subject_id: "shot_01", profile: "STANDARD" as const };

  it("passes when everything measured clears its threshold", () => {
    const result = aggregate(
      [judgeResult({ judge_id: "flicker-judge", score: 0.9 }), judgeResult({ judge_id: "motion-judge", score: 0.8 })],
      judges,
      QUALITY_PROFILES.STANDARD,
      options,
    );
    expect(result.passed).toBe(true);
  });

  it("fails on one breached dimension even when the average is high", () => {
    // The failure this prevents: a fatal defect averaged away by dimensions
    // that happened to be fine.
    const result = aggregate(
      [judgeResult({ judge_id: "flicker-judge", score: 0.1 }), judgeResult({ judge_id: "motion-judge", score: 1 })],
      judges,
      QUALITY_PROFILES.STANDARD,
      options,
    );
    expect(result.passed).toBe(false);
  });

  it("fails on a severe finding regardless of score", () => {
    const result = aggregate(
      [judgeResult({
        judge_id: "flicker-judge", score: 0.95,
        findings: [{ code: "flicker", severity: "critical", message: "m", frames: [], entity_ref: null }],
      })],
      judges,
      QUALITY_PROFILES.STANDARD,
      options,
    );
    expect(result.passed).toBe(false);
  });

  it("excludes an unavailable judge from the score rather than counting it as a pass", () => {
    const result = aggregate(
      [
        judgeResult({ judge_id: "flicker-judge", score: 0.8 }),
        judgeResult({ judge_id: "identity-judge", score: 0, confidence: 0, status: "skipped",
                      recommended_actions: ["Requires a vision model."] }),
      ],
      judges,
      QUALITY_PROFILES.STANDARD,
      options,
    );
    // Averaging in a zero would have failed the shot; ignoring it entirely
    // would have hidden the gap. It does neither.
    expect(result.overall).toBeCloseTo(0.8, 5);
    expect(result.unmeasured.map((u) => u.dimension)).toContain("identity");
  });

  it("takes the lower score when two judges cover one dimension", () => {
    const two = [judge("a", "flicker"), judge("b", "flicker")];
    const result = aggregate(
      [judgeResult({ judge_id: "a", score: 0.9 }), judgeResult({ judge_id: "b", score: 0.4 })],
      two,
      QUALITY_PROFILES.PREVIEW,
      options,
    );
    expect(result.scores.flicker).toBe(0.4);
  });

  it("reports how much of the profile could actually be measured", () => {
    const result = aggregate(
      [judgeResult({ judge_id: "flicker-judge", score: 0.9 })],
      judges,
      QUALITY_PROFILES.REALISTIC,
      { ...options, profile: "REALISTIC" },
    );
    expect(coverage(result, "REALISTIC")).toBeLessThan(0.5);
  });
});

describe("quality profiles", () => {
  it("does not relax correctness for UGC", () => {
    // UGC tolerates loose framing, never identity drift or bad lip sync.
    expect(QUALITY_PROFILES.UGC.dimensions.identity).toBeGreaterThanOrEqual(0.85);
    expect(QUALITY_PROFILES.UGC.dimensions.lip_sync).toBeGreaterThanOrEqual(0.85);
  });

  it("holds product dimensions highest in the product profile", () => {
    expect(QUALITY_PROFILES.PRODUCT.dimensions.logo).toBeGreaterThanOrEqual(0.9);
    expect(QUALITY_PROFILES.PRODUCT.dimensions.text_preservation).toBeGreaterThanOrEqual(0.9);
  });

  it("makes ultra stricter than standard without changing the model", () => {
    expect(QUALITY_PROFILES.ULTRA.overall).toBeGreaterThan(QUALITY_PROFILES.STANDARD.overall);
  });
});

describe("failure classification", () => {
  const evaluation = (findings: Array<{ code: string; severity: string; frames?: number[] }>): QualityEvaluation => ({
    schema_version: "1.0", subject_kind: "shot", subject_id: "shot_01",
    quality_profile: "STANDARD", overall: 0.4, scores: {}, passed: false,
    judges: [judgeResult({
      findings: findings.map((f) => ({
        code: f.code, severity: f.severity as never, message: "", frames: f.frames ?? [], entity_ref: null,
      })),
    })],
  });

  it("calls a caption problem a composition fault", () => {
    expect(classify(evaluation([{ code: "caption_mismatch", severity: "high" }])).failure_class)
      .toBe("composition_fault");
  });

  it("calls a static shot a motion fault", () => {
    expect(classify(evaluation([{ code: "insufficient_motion", severity: "high" }])).failure_class)
      .toBe("motion_fault");
  });

  it("calls a bounded defect a local artifact", () => {
    expect(classify(evaluation([{ code: "content_discontinuity", severity: "high", frames: [60, 61] }])).failure_class)
      .toBe("local_artifact");
  });

  it("only calls whole-shot failure on several unrelated severe findings", () => {
    expect(classify(evaluation([
      { code: "anatomy", severity: "critical" },
      { code: "physics", severity: "high" },
      { code: "background_instability", severity: "high" },
    ])).failure_class).toBe("whole_shot_failure");
  });

  it("treats a changed canonical entity as invalidation, not a bad generation", () => {
    const result = classify(evaluation([{ code: "identity_drift", severity: "high" }]), true);
    expect(result.failure_class).toBe("identity_fault");
    expect(result.rationale).toContain("dependent shots are stale");
  });

  it("finds nothing to classify when nothing is severe", () => {
    expect(classify(evaluation([{ code: "flicker", severity: "low" }])).failure_class).toBe("none");
  });
});

describe("repair planning", () => {
  const budget = { max_generation_attempts: 3, max_repair_attempts: 2, max_gpu_seconds: 600, max_cost_units: 100 };
  const spend = { generation_attempts: 1, repair_attempts: 0, gpu_seconds: 60, cost_units: 10 };

  const evaluation = (codes: Array<[string, string]>): QualityEvaluation => ({
    schema_version: "1.0", subject_kind: "shot", subject_id: "shot_01",
    quality_profile: "STANDARD", overall: 0.4, scores: {}, passed: false,
    judges: [judgeResult({
      findings: codes.map(([code, severity]) => ({
        code, severity: severity as never, message: code, frames: [], entity_ref: null,
      })),
    })],
  });

  it("repairs captions only, when captions are the only problem", () => {
    const decision = planRepair({
      evaluation: evaluation([["caption_mismatch", "high"]]),
      subject_id: "shot_01", budget, spend,
    });
    expect(decision.plan.scope).toBe("caption");
    expect(decision.plan.estimated_gpu_seconds).toBe(0);
  });

  it("remixes audio rather than regenerating for a level problem", () => {
    const decision = planRepair({
      evaluation: evaluation([["loudness_off_target", "high"]]),
      subject_id: "shot_01", budget, spend,
    });
    expect(decision.plan.scope).toBe("audio");
    expect(decision.plan.actions[0]!.action).toBe("audio_repair");
  });

  it("recomposes for a sync fault instead of regenerating", () => {
    const decision = planRepair({
      evaluation: evaluation([["av_sync", "high"]]),
      subject_id: "shot_01", budget, spend,
    });
    expect(decision.plan.scope).toBe("timing");
  });

  it("invalidates dependents when a canonical entity changed", () => {
    const decision = planRepair({
      evaluation: evaluation([["identity_drift", "high"]]),
      subject_id: "shot_01", budget, spend, entity_changed: true,
    });
    expect(decision.plan.scope).toBe("dependent_shots");
  });

  it("never selects project scope", () => {
    const decision = planRepair({
      evaluation: evaluation([["anatomy", "critical"], ["physics", "high"], ["background_instability", "high"]]),
      subject_id: "shot_01", budget, spend,
    });
    expect(decision.plan.scope).not.toBe("project");
  });

  it("hands to review rather than starting a repair it cannot finish", () => {
    const decision = planRepair({
      evaluation: evaluation([["anatomy", "critical"], ["physics", "high"], ["background_instability", "high"]]),
      subject_id: "shot_01", budget,
      spend: { ...spend, gpu_seconds: 595 },
    });
    expect(decision.needs_review).toBe(true);
    expect(decision.plan.scope).toBe("none");
  });

  it("hands to review when the repair budget is spent", () => {
    const decision = planRepair({
      evaluation: evaluation([["insufficient_motion", "high"]]),
      subject_id: "shot_01", budget,
      spend: { ...spend, repair_attempts: 2 },
    });
    expect(decision.needs_review).toBe(true);
  });

  it("corrects the prompt when no specific repair maps to the findings", () => {
    const decision = planRepair({
      evaluation: evaluation([["something_unmapped", "high"]]),
      subject_id: "shot_01", budget, spend,
    });
    expect(decision.plan.actions[0]!.action).toBe("prompt_repair");
  });

  it("plans nothing when nothing failed", () => {
    const decision = planRepair({
      evaluation: evaluation([["flicker", "low"]]),
      subject_id: "shot_01", budget, spend,
    });
    expect(decision.plan.scope).toBe("none");
    expect(decision.needs_review).toBe(false);
  });
});

describe("calibration", () => {
  function samples(pairs: Array<[number, number]>, labels: string[][] = []): CalibrationSample[] {
    return pairs.map(([judgeScore, humanScore], i) => ({
      asset_id: `a${i}`, judge_score: judgeScore, human_score: humanScore,
      failure_labels: labels[i] ?? [],
    }));
  }

  it("computes correlation", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 5);
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 5);
  });

  it("reports zero rather than a spurious correlation when nothing varies", () => {
    expect(pearson([1, 1, 1], [1, 1, 1])).toBe(0);
  });

  it("counts a judge failing what people accepted as a false positive", () => {
    const rates = errorRates(samples([[0.5, 0.9], [0.5, 0.9], [0.9, 0.9]]), 0.7, 0.7);
    expect(rates.false_positive_rate).toBe(1);
  });

  it("counts a judge passing what people rejected as a false negative", () => {
    const rates = errorRates(samples([[0.9, 0.2], [0.9, 0.9]]), 0.7, 0.7);
    expect(rates.false_negative_rate).toBe(0.5);
  });

  it("refuses to trust a judge that does not correlate with people", () => {
    const uncorrelated = samples(Array.from({ length: 30 }, (_, i) => [i % 2 ? 0.9 : 0.2, 0.8]));
    expect(calibrate("flicker", uncorrelated, 0.7).usable).toBe(false);
  });

  it("trusts a judge that does, given enough samples", () => {
    const correlated = samples(Array.from({ length: 30 }, (_, i) => {
      const v = i / 29;
      return [v, v];
    }));
    const report = calibrate("flicker", correlated, 0.7);
    expect(report.correlation).toBeGreaterThan(0.9);
    expect(report.usable).toBe(true);
  });

  it("says so when there are too few samples to recommend anything", () => {
    expect(calibrate("flicker", samples([[0.9, 0.9]]), 0.7).notes.join(" "))
      .toContain("rated samples");
  });

  it("recommends a threshold that weights missed defects over needless repairs", () => {
    // Judge scores cluster: bad shots near 0.5, good shots near 0.9.
    const data = samples([
      [0.5, 0.2], [0.52, 0.3], [0.55, 0.25],
      [0.9, 0.9], [0.92, 0.95], [0.88, 0.85],
    ]);
    const threshold = recommendThreshold(data);
    expect(threshold).toBeGreaterThan(0.55);
    expect(threshold).toBeLessThanOrEqual(0.9);
  });

  it("finds a defect class the judge is blind to", () => {
    // The judge passes everything, but people rejected the hand failures.
    const data = samples(
      [[0.9, 0.2], [0.9, 0.2], [0.9, 0.3], [0.9, 0.9]],
      [["hands"], ["hands"], ["hands"], []],
    );
    expect(blindSpots(data, 0.7)).toContain("hands");
  });
});
