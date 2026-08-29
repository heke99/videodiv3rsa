import type {
  JudgeResult,
  QualityDimension,
  QualityEvaluation,
  QualityMode,
  QualityThresholds,
} from "@videoai/contracts";
import type { Judge, JudgeContext } from "./judges.js";

/**
 * Ensemble aggregation and thresholds (spec sections 32, 33).
 *
 * The rule that shapes this module: a judge with no confidence contributes
 * nothing. An unavailable dimension must not average out to a pass, because
 * the repair planner treats a passing dimension as checked.
 */

/**
 * Thresholds per quality profile. Only dimensions listed here gate; the rest
 * are recorded and reported without blocking.
 */
export const QUALITY_PROFILES: Record<QualityMode, QualityThresholds> = {
  PREVIEW: { profile: "PREVIEW", overall: 0.4, dimensions: {} },
  STANDARD: {
    profile: "STANDARD",
    overall: 0.7,
    dimensions: { flicker: 0.6, temporal_consistency: 0.6, motion: 0.5, audio_quality: 0.7, av_sync: 0.7 },
  },
  REALISTIC: {
    profile: "REALISTIC",
    overall: 0.8,
    dimensions: {
      flicker: 0.75,
      temporal_consistency: 0.75,
      motion: 0.6,
      identity: 0.85,
      face: 0.8,
      hands: 0.75,
      physics: 0.75,
      audio_quality: 0.75,
      av_sync: 0.8,
    },
  },
  UGC: {
    profile: "UGC",
    overall: 0.7,
    dimensions: {
      // UGC tolerates loose framing and uneven light, and does not relax any
      // of the correctness dimensions (spec section 30).
      identity: 0.85,
      lip_sync: 0.85,
      hands: 0.75,
      product: 0.85,
      flicker: 0.6,
      av_sync: 0.8,
      audio_quality: 0.7,
      safe_area: 0.9,
    },
  },
  CINEMATIC: {
    profile: "CINEMATIC",
    overall: 0.82,
    dimensions: {
      flicker: 0.8,
      temporal_consistency: 0.8,
      motion: 0.7,
      camera: 0.75,
      lighting: 0.75,
      color: 0.75,
      framing: 0.7,
      audio_quality: 0.8,
      av_sync: 0.8,
    },
  },
  PRODUCT: {
    profile: "PRODUCT",
    overall: 0.85,
    dimensions: {
      product: 0.9,
      logo: 0.9,
      text_preservation: 0.9,
      flicker: 0.75,
      temporal_consistency: 0.8,
      interaction: 0.8,
    },
  },
  AVATAR: {
    profile: "AVATAR",
    overall: 0.8,
    dimensions: { lip_sync: 0.88, av_sync: 0.85, identity: 0.85, face: 0.8, audio_quality: 0.8 },
  },
  ULTRA: {
    profile: "ULTRA",
    overall: 0.88,
    dimensions: {
      flicker: 0.85,
      temporal_consistency: 0.85,
      motion: 0.75,
      identity: 0.9,
      face: 0.85,
      hands: 0.8,
      physics: 0.8,
      audio_quality: 0.85,
      av_sync: 0.85,
    },
  },
};

export interface EnsembleResult extends QualityEvaluation {
  /** Dimensions that could not be measured, and why. */
  unmeasured: Array<{ dimension: QualityDimension; reason: string }>;
}

export async function evaluate(
  judges: Judge[],
  context: JudgeContext,
  options: {
    subject_kind: QualityEvaluation["subject_kind"];
    subject_id: string;
    profile: QualityMode;
  },
): Promise<EnsembleResult> {
  const thresholds = QUALITY_PROFILES[options.profile];
  const results: JudgeResult[] = [];

  for (const judge of judges) {
    try {
      results.push(await judge.run(context));
    } catch (error) {
      // A judge that throws is a broken judge, not a failed shot. Recording it
      // at zero confidence keeps it out of the score while leaving a trace.
      results.push({
        judge_id: judge.id,
        judge_version: judge.version,
        status: "error",
        score: 0,
        confidence: 0,
        findings: [
          {
            code: "judge_error",
            severity: "medium",
            message: `${judge.id} failed: ${(error as Error).message}`,
            frames: [],
            entity_ref: null,
          },
        ],
        recommended_actions: [],
        metrics: {},
        repair_scope: "none",
      });
    }
  }

  return aggregate(results, judges, thresholds, options);
}

export function aggregate(
  results: JudgeResult[],
  judges: Judge[],
  thresholds: QualityThresholds,
  options: {
    subject_kind: QualityEvaluation["subject_kind"];
    subject_id: string;
    profile: QualityMode;
  },
): EnsembleResult {
  const byId = new Map(judges.map((j) => [j.id, j]));
  const scores: Partial<Record<QualityDimension, number>> = {};
  const unmeasured: EnsembleResult["unmeasured"] = [];

  let weighted = 0;
  let weight = 0;

  for (const judgeResult of results) {
    const judge = byId.get(judgeResult.judge_id);
    if (!judge) continue;

    if (judgeResult.confidence === 0) {
      unmeasured.push({
        dimension: judge.dimension,
        reason: judgeResult.recommended_actions[0] ?? "unavailable",
      });
      continue;
    }

    // Where two judges cover one dimension, keep the lower score: a dimension
    // is only as good as its worst evidence.
    const existing = scores[judge.dimension];
    scores[judge.dimension] =
      existing === undefined ? judgeResult.score : Math.min(existing, judgeResult.score);

    weighted += judgeResult.score * judgeResult.confidence;
    weight += judgeResult.confidence;
  }

  const overall = weight === 0 ? 0 : weighted / weight;

  // A dimension below its threshold fails the evaluation outright, whatever
  // the average says. Averaging is how a fatal defect gets hidden by six
  // dimensions that happened to be fine.
  const breached = (Object.entries(thresholds.dimensions) as Array<[QualityDimension, number]>).filter(
    ([dimension, minimum]) => {
      const score = scores[dimension];
      return score !== undefined && score < minimum;
    },
  );

  const hasSevereFinding = results.some((r) =>
    r.findings.some((f) => f.severity === "critical" || f.severity === "high"),
  );

  return {
    schema_version: "1.0",
    subject_kind: options.subject_kind,
    subject_id: options.subject_id,
    quality_profile: options.profile,
    overall,
    scores,
    judges: results,
    passed: overall >= thresholds.overall && breached.length === 0 && !hasSevereFinding,
    unmeasured,
  };
}

/**
 * How much of the profile's gating set was actually measurable.
 *
 * Surfaced so a user is told "this passed the checks we can run" rather than
 * "this passed", which would be a different and untrue claim while the vision
 * judges are unavailable.
 */
export function coverage(evaluation: EnsembleResult, profile: QualityMode): number {
  const gated = Object.keys(QUALITY_PROFILES[profile].dimensions);
  if (gated.length === 0) return 1;
  const measured = gated.filter((d) => evaluation.scores[d as QualityDimension] !== undefined);
  return measured.length / gated.length;
}
