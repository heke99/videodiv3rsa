import type { Finding, JudgeResult, QualityDimension, Severity } from "@videoai/contracts";
import { LOUDNESS_TARGETS, type LoudnessProfile } from "@videoai/contracts";
import { CAPTION_SAFE_AREA } from "@videoai/render";
import {
  durationSeconds,
  firstSoundSample,
  flickerScore,
  frameStatistics,
  freezeRatio,
  loudness,
  motionMagnitude,
  structuralSimilarity,
  temporalConsistency,
} from "./metrics.js";

/**
 * The judges (spec section 32).
 *
 * Two tiers, kept visibly distinct. Measured judges compute a verdict from the
 * file and are certain. Model judges need a vision model on the GPU and, until
 * one exists, report themselves unavailable rather than returning a number.
 *
 * The distinction is load-bearing: an unavailable dimension must not be scored
 * as passing, because the repair planner would then believe it had been
 * checked.
 */

export interface JudgeContext {
  asset_path: string;
  /** For comparison judges: the source this output was derived from. */
  reference_path?: string;
  planned_motion_complexity?: number;
  loudness_profile?: LoudnessProfile;
  audio_sample_rate?: number;
  expected_first_sound_sample?: number;
  platform?: string;
  caption_bottom_fraction?: number;
  expects_audio?: boolean;
}

export interface Judge {
  id: string;
  version: string;
  dimension: QualityDimension;
  /** False when the judge needs hardware we do not have. */
  available: boolean;
  run(context: JudgeContext): Promise<JudgeResult>;
}

function result(
  judge: Pick<Judge, "id" | "version">,
  score: number,
  findings: Finding[],
  metrics: Record<string, number>,
  repairScope: JudgeResult["repair_scope"] = "none",
): JudgeResult {
  const failed = findings.some((f) => f.severity === "high" || f.severity === "critical");
  return {
    judge_id: judge.id,
    judge_version: judge.version,
    status: failed ? "fail" : "pass",
    score,
    confidence: 1,
    findings,
    recommended_actions: [],
    metrics,
    repair_scope: failed ? repairScope : "none",
  };
}

function finding(code: string, severity: Severity, message: string, frames: number[] = []): Finding {
  return { code, severity, message, frames, entity_ref: null };
}

/** A judge that cannot run yet. Reports absence rather than a guess. */
function unavailable(id: string, dimension: QualityDimension, why: string): Judge {
  return {
    id,
    version: "0.0",
    dimension,
    available: false,
    async run(): Promise<JudgeResult> {
      return {
        judge_id: id,
        judge_version: "0.0",
        status: "skipped",
        // Zero confidence is what keeps this out of the weighted aggregate.
        score: 0,
        confidence: 0,
        findings: [],
        recommended_actions: [why],
        metrics: {},
        repair_scope: "none",
      };
    },
  };
}

export const flickerJudge: Judge = {
  id: "flicker-judge",
  version: "1.0",
  dimension: "flicker",
  available: true,
  async run(ctx) {
    const { luma } = await frameStatistics(ctx.asset_path);
    const { score, oscillation_ratio } = flickerScore(luma);
    const findings: Finding[] = [];
    if (oscillation_ratio > 0.6) {
      findings.push(
        finding(
          "flicker",
          oscillation_ratio > 0.8 ? "critical" : "high",
          `Brightness oscillates on ${Math.round(oscillation_ratio * 100)}% of frame transitions`,
        ),
      );
    }
    return result(flickerJudge, score, findings, { oscillation_ratio }, "shot");
  },
};

export const temporalConsistencyJudge: Judge = {
  id: "temporal-consistency-judge",
  version: "1.0",
  dimension: "temporal_consistency",
  available: true,
  async run(ctx) {
    const { diff } = await frameStatistics(ctx.asset_path);
    const { score, spikes } = temporalConsistency(diff);
    const findings: Finding[] = [];
    if (spikes.length > 0) {
      findings.push(
        finding(
          "content_discontinuity",
          spikes.length > 3 ? "high" : "medium",
          `${spikes.length} frame(s) changed far more than the shot's own norm`,
          // Naming the frames is what lets a repair be scoped to a region.
          spikes,
        ),
      );
    }
    return result(temporalConsistencyJudge, score, findings, { spikes: spikes.length }, "shot");
  },
};

export const motionJudge: Judge = {
  id: "motion-judge",
  version: "1.0",
  dimension: "motion",
  available: true,
  async run(ctx) {
    const measured = await motionMagnitude(ctx.asset_path);
    const duration = await durationSeconds(ctx.asset_path);
    const frozen = await freezeRatio(ctx.asset_path, duration);
    const planned = ctx.planned_motion_complexity ?? 0.5;

    const findings: Finding[] = [];
    if (frozen > 0.25) {
      findings.push(
        finding("frozen_segment", "high", `${Math.round(frozen * 100)}% of the shot is frozen`),
      );
    }
    // A shot planned to move that did not is a real generation failure, and
    // technically valid output makes it easy to miss.
    if (planned > 0.4 && measured < planned * 0.25) {
      findings.push(
        finding(
          "insufficient_motion",
          "high",
          `Planned for motion around ${planned.toFixed(2)} but measured ${measured.toFixed(2)}`,
        ),
      );
    }
    if (planned < 0.3 && measured > 0.7) {
      findings.push(
        finding("excess_motion", "medium", "Movement far exceeds what the shot called for"),
      );
    }

    const score = 1 - Math.min(1, Math.abs(measured - planned)) * 0.5 - frozen * 0.5;
    return result(motionJudge, Math.max(0, score), findings, { measured, planned, frozen }, "shot");
  },
};

export const audioQualityJudge: Judge = {
  id: "audio-quality-judge",
  version: "1.0",
  dimension: "audio_quality",
  available: true,
  async run(ctx) {
    const measured = await loudness(ctx.asset_path);
    const findings: Finding[] = [];

    if (!measured) {
      if (ctx.expects_audio) {
        findings.push(finding("no_audio", "critical", "The output should carry audio but has none"));
      }
      return result(audioQualityJudge, ctx.expects_audio ? 0 : 1, findings, {}, "audio");
    }

    const profile = ctx.loudness_profile && ctx.loudness_profile !== "custom" ? ctx.loudness_profile : "social";
    const target = LOUDNESS_TARGETS[profile];
    const drift = Math.abs(measured.integrated_lufs - target.integrated_lufs);

    if (drift > 1.5) {
      findings.push(
        finding(
          "loudness_off_target",
          drift > 4 ? "high" : "medium",
          `Measured ${measured.integrated_lufs.toFixed(1)} LUFS against a ${target.integrated_lufs} target`,
        ),
      );
    }
    if (measured.true_peak_dbtp > target.true_peak_dbtp) {
      // Above the ceiling, the platform's own re-encode will clip audibly even
      // though this file does not.
      findings.push(
        finding(
          "true_peak_exceeded",
          "high",
          `True peak ${measured.true_peak_dbtp.toFixed(1)} dBTP exceeds ${target.true_peak_dbtp}`,
        ),
      );
    }
    if (measured.lra < 1 && measured.integrated_lufs > -50) {
      findings.push(
        finding("over_compressed", "medium", "Loudness range near zero; the mix will sound lifeless"),
      );
    }

    return result(
      audioQualityJudge,
      Math.max(0, 1 - drift / 6),
      findings,
      { integrated_lufs: measured.integrated_lufs, true_peak_dbtp: measured.true_peak_dbtp, lra: measured.lra },
      "audio",
    );
  },
};

export const avSyncJudge: Judge = {
  id: "av-sync-judge",
  version: "1.0",
  dimension: "av_sync",
  available: true,
  async run(ctx) {
    if (ctx.expected_first_sound_sample === undefined || !ctx.audio_sample_rate) {
      return result(avSyncJudge, 1, [], {});
    }

    const measured = await firstSoundSample(ctx.asset_path, ctx.audio_sample_rate);
    if (measured === null) {
      return result(avSyncJudge, 0, [finding("no_audio", "critical", "No audio to synchronise")], {}, "audio");
    }

    const offsetSamples = measured - ctx.expected_first_sound_sample;
    const offsetMs = (offsetSamples / ctx.audio_sample_rate) * 1000;

    // Perception is asymmetric: audio ahead of picture is noticed at around
    // 45ms, audio behind is tolerated to about 125ms.
    const tolerance = offsetMs < 0 ? 45 : 125;
    const findings: Finding[] = [];
    if (Math.abs(offsetMs) > tolerance) {
      findings.push(
        finding(
          "av_sync",
          Math.abs(offsetMs) > tolerance * 2 ? "high" : "medium",
          `Audio is ${offsetMs > 0 ? "late" : "early"} by ${Math.abs(offsetMs).toFixed(0)}ms`,
        ),
      );
    }

    return result(
      avSyncJudge,
      Math.max(0, 1 - Math.abs(offsetMs) / (tolerance * 3)),
      findings,
      { offset_ms: offsetMs },
      // A sync error is an assembly fault, so recomposing fixes it and
      // regenerating would not.
      "timing",
    );
  },
};

export const safeAreaJudge: Judge = {
  id: "safe-area-judge",
  version: "1.0",
  dimension: "safe_area",
  available: true,
  async run(ctx) {
    if (ctx.caption_bottom_fraction === undefined) return result(safeAreaJudge, 1, [], {});

    const required = CAPTION_SAFE_AREA[ctx.platform ?? "other"] ?? 0.12;
    const findings: Finding[] = [];
    if (ctx.caption_bottom_fraction < required) {
      // Silent failure: the file is correct and the caption is hidden behind
      // the platform's own interface.
      findings.push(
        finding(
          "safe_area_violation",
          "high",
          `Caption sits ${(ctx.caption_bottom_fraction * 100).toFixed(0)}% from the bottom; ` +
            `${ctx.platform ?? "this platform"} needs ${(required * 100).toFixed(0)}%`,
        ),
      );
    }

    return result(
      safeAreaJudge,
      Math.min(1, ctx.caption_bottom_fraction / required),
      findings,
      { bottom_fraction: ctx.caption_bottom_fraction, required },
      "caption",
    );
  },
};

export const upscaleJudge: Judge = {
  id: "upscale-judge",
  version: "1.0",
  dimension: "temporal_consistency",
  available: true,
  async run(ctx) {
    if (!ctx.reference_path) return result(upscaleJudge, 1, [], {});

    const similarity = await structuralSimilarity(ctx.reference_path, ctx.asset_path);
    if (!similarity) return result(upscaleJudge, 1, [], {});

    const findings: Finding[] = [];
    // An upscale is meant to add resolution, not to change the content. Low
    // similarity means it invented something (spec section 38).
    if (similarity.ssim < 0.9) {
      findings.push(
        finding(
          "upscale_changed_content",
          similarity.ssim < 0.8 ? "high" : "medium",
          `Upscale differs structurally from its source (SSIM ${similarity.ssim.toFixed(3)})`,
        ),
      );
    }

    const before = flickerScore((await frameStatistics(ctx.reference_path)).luma);
    const after = flickerScore((await frameStatistics(ctx.asset_path)).luma);
    if (after.oscillation_ratio > before.oscillation_ratio + 0.15) {
      findings.push(finding("upscale_added_flicker", "high", "The upscale increased flicker"));
    }

    return result(
      upscaleJudge,
      similarity.ssim,
      findings,
      { ssim: similarity.ssim, psnr: similarity.psnr },
      "upscale",
    );
  },
};

/**
 * Judges that need a vision model. Registered so the ensemble knows the
 * dimension exists and reports it unmeasured, rather than leaving a gap that
 * looks like a pass.
 */
const NEEDS_GPU = "Requires a vision model on a provisioned GPU worker.";

export const modelJudges: Judge[] = [
  unavailable("prompt-adherence-judge", "prompt_adherence", NEEDS_GPU),
  unavailable("identity-judge", "identity", NEEDS_GPU),
  unavailable("face-judge", "face", NEEDS_GPU),
  unavailable("hand-judge", "hands", NEEDS_GPU),
  unavailable("anatomy-judge", "anatomy", NEEDS_GPU),
  unavailable("physics-judge", "physics", NEEDS_GPU),
  unavailable("product-judge", "product", NEEDS_GPU),
  unavailable("logo-judge", "logo", NEEDS_GPU),
  unavailable("text-preservation-judge", "text_preservation", NEEDS_GPU),
  unavailable("lip-sync-judge", "lip_sync", NEEDS_GPU),
];

export const measuredJudges: Judge[] = [
  flickerJudge,
  temporalConsistencyJudge,
  motionJudge,
  audioQualityJudge,
  avSyncJudge,
  safeAreaJudge,
];

export const allJudges: Judge[] = [...measuredJudges, ...modelJudges];
