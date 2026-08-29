import { z } from "zod";
import { QualityMode, SchemaVersion, Slug, Uuid } from "./primitives.js";

/**
 * Skill execution contract, judges, QC scoring and repair
 * (spec sections 23, 32, 33, 35, 36).
 */

export const Severity = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof Severity>;

export const Finding = z.object({
  code: z.string().min(1),
  severity: Severity,
  message: z.string().default(""),
  /** Frame indices, not seconds. */
  frames: z.array(z.number().int().nonnegative()).default([]),
  entity_ref: Slug.nullable().default(null),
});
export type Finding = z.infer<typeof Finding>;

/** Every skill returns this shape (spec section 23). */
export const SkillRunResult = z.object({
  status: z.enum(["pass", "fail", "error", "skipped"]),
  confidence: z.number().min(0).max(1).default(1),
  findings: z.array(Finding).default([]),
  recommended_actions: z.array(z.string()).default([]),
  metrics: z.record(z.string(), z.number()).default({}),
  output: z.unknown().optional(),
});
export type SkillRunResult = z.infer<typeof SkillRunResult>;

export const RepairScope = z.enum([
  "none",
  "lipsync",
  "audio",
  "timing",
  "frame",
  "keyframe",
  "shot",
  "scene",
  "dependent_shots",
  "project",
]);
export type RepairScope = z.infer<typeof RepairScope>;

export const JudgeResult = SkillRunResult.extend({
  judge_id: Slug,
  judge_version: z.string().min(1),
  score: z.number().min(0).max(1),
  repair_scope: RepairScope.default("none"),
});
export type JudgeResult = z.infer<typeof JudgeResult>;

/**
 * Per-dimension scores, kept alongside the overall (spec section 33). A single
 * total is never enough to choose a repair scope.
 */
export const QualityDimension = z.enum([
  "prompt_adherence",
  "scene_bible_adherence",
  "realism",
  "identity",
  "face",
  "hands",
  "anatomy",
  "physics",
  "motion",
  "temporal_consistency",
  "flicker",
  "background",
  "object_persistence",
  "product",
  "logo",
  "text_preservation",
  "interaction",
  "camera",
  "framing",
  "lighting",
  "exposure",
  "color",
  "continuity",
  "transition",
  "lip_sync",
  "av_sync",
  "voice_consistency",
  "audio_quality",
  "caption_sync",
  "safe_area",
  "encoding",
]);
export type QualityDimension = z.infer<typeof QualityDimension>;

export const QualityEvaluation = z.object({
  schema_version: SchemaVersion.default("1.0"),
  subject_kind: z.enum(["shot", "scene", "reference", "audio", "final"]),
  subject_id: z.string().min(1),
  quality_profile: QualityMode,
  overall: z.number().min(0).max(1),
  scores: z.record(QualityDimension, z.number().min(0).max(1)).default({}),
  judges: z.array(JudgeResult).default([]),
  passed: z.boolean(),
});
export type QualityEvaluation = z.infer<typeof QualityEvaluation>;

/** Thresholds per quality profile; a dimension absent here is not gating. */
export const QualityThresholds = z.object({
  profile: QualityMode,
  overall: z.number().min(0).max(1),
  dimensions: z.record(QualityDimension, z.number().min(0).max(1)).default({}),
});
export type QualityThresholds = z.infer<typeof QualityThresholds>;

export const RepairAction = z.enum([
  "prompt_repair",
  "reference_repair",
  "keyframe_repair",
  "shot_regeneration",
  "local_image_repair",
  "identity_repair",
  "product_repair",
  "motion_repair",
  "lip_sync_repair",
  "audio_repair",
  "timing_repair",
  "upscale_repair",
  "caption_repair",
]);
export type RepairAction = z.infer<typeof RepairAction>;

export const RepairPlan = z.object({
  schema_version: SchemaVersion.default("1.0"),
  subject_id: z.string().min(1),
  /** The planner must choose the smallest scope that can fix the findings. */
  scope: RepairScope,
  actions: z.array(
    z.object({
      action: RepairAction,
      target_id: z.string().min(1),
      rationale: z.string().min(1),
      params: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
  addressed_findings: z.array(z.string()).default([]),
  estimated_gpu_seconds: z.number().nonnegative().default(0),
});
export type RepairPlan = z.infer<typeof RepairPlan>;

/** Bounded retries (spec section 36) — exhaustion yields needs_review, never a loop. */
export const RetryBudget = z.object({
  max_generation_attempts: z.number().int().positive().default(3),
  max_repair_attempts: z.number().int().positive().default(2),
  max_gpu_seconds: z.number().positive(),
  max_cost_units: z.number().positive(),
});
export type RetryBudget = z.infer<typeof RetryBudget>;

export const BudgetSpend = z.object({
  generation_attempts: z.number().int().nonnegative().default(0),
  repair_attempts: z.number().int().nonnegative().default(0),
  gpu_seconds: z.number().nonnegative().default(0),
  cost_units: z.number().nonnegative().default(0),
});
export type BudgetSpend = z.infer<typeof BudgetSpend>;

/** Technical QC (spec section 37) — pure media validation, no model involved. */
export const TechnicalQcReport = z.object({
  asset_id: Uuid,
  exists: z.boolean(),
  container_ok: z.boolean(),
  has_nan_frames: z.boolean(),
  frame_count: z.number().int().nonnegative(),
  expected_frame_count: z.number().int().nonnegative().nullable(),
  fps_num: z.number().int().positive().nullable(),
  fps_den: z.number().int().positive().nullable(),
  duration_samples: z.number().int().nonnegative().nullable(),
  width: z.number().int().nonnegative().nullable(),
  height: z.number().int().nonnegative().nullable(),
  pixel_format: z.string().nullable(),
  video_codec: z.string().nullable(),
  audio_codec: z.string().nullable(),
  audio_sample_rate: z.number().int().nullable(),
  audio_channels: z.number().int().nullable(),
  black_frame_ratio: z.number().min(0).max(1).default(0),
  silent_audio_ratio: z.number().min(0).max(1).default(0),
  duplicate_frame_ratio: z.number().min(0).max(1).default(0),
  findings: z.array(Finding).default([]),
  passed: z.boolean(),
});
export type TechnicalQcReport = z.infer<typeof TechnicalQcReport>;
