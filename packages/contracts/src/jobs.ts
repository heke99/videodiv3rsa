import { z } from "zod";
import { ModelId, SchemaVersion, Slug, Uuid } from "./primitives.js";

/** Job status model (spec section 47) and the user-facing progress mapping. */
export const JobStatus = z.enum([
  "queued",
  "preflight",
  "planning",
  "generating_script",
  "generating_audio",
  "generating_references",
  "reference_qc",
  "generating_shots",
  "shot_qc",
  "repairing",
  "syncing",
  "audio_generation",
  "audio_qc",
  "upscaling",
  "final_render",
  "final_qc",
  "completed",
  "failed",
  "cancelled",
  "needs_review",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const TERMINAL_JOB_STATUSES: JobStatus[] = ["completed", "failed", "cancelled", "needs_review"];

/**
 * Human-readable production steps shown in the UI (spec section 46).
 * Internal implementation detail never reaches the user.
 */
export const ProgressStep = z.enum([
  "understanding_your_idea",
  "writing_storyboard",
  "creating_characters",
  "creating_keyframes",
  "generating_scenes",
  "synchronizing_dialogue",
  "creating_sound",
  "quality_checking",
  "rendering_final_video",
]);
export type ProgressStep = z.infer<typeof ProgressStep>;

export const JOB_STATUS_TO_STEP: Record<JobStatus, ProgressStep | null> = {
  queued: "understanding_your_idea",
  preflight: "understanding_your_idea",
  planning: "understanding_your_idea",
  generating_script: "writing_storyboard",
  generating_references: "creating_characters",
  reference_qc: "creating_characters",
  generating_shots: "generating_scenes",
  shot_qc: "quality_checking",
  repairing: "quality_checking",
  generating_audio: "synchronizing_dialogue",
  syncing: "synchronizing_dialogue",
  audio_generation: "creating_sound",
  audio_qc: "creating_sound",
  upscaling: "rendering_final_video",
  final_render: "rendering_final_video",
  final_qc: "quality_checking",
  completed: null,
  failed: null,
  cancelled: null,
  needs_review: null,
};

export const JobProgress = z.object({
  job_id: Uuid,
  status: JobStatus,
  step: ProgressStep.nullable(),
  completed_units: z.number().int().nonnegative().default(0),
  total_units: z.number().int().nonnegative().default(0),
  message: z.string().default(""),
  updated_at: z.string().datetime(),
});
export type JobProgress = z.infer<typeof JobProgress>;

/** Checkpoint written after every expensive stage (spec section 49). */
export const Checkpoint = z.object({
  schema_version: SchemaVersion.default("1.0"),
  job_id: Uuid,
  stage: z.string().min(1),
  unit_id: z.string().nullable().default(null),
  inputs_hash: z.string().min(1),
  artifacts: z.array(Uuid).default([]),
  result: z.unknown().optional(),
  created_at: z.string().datetime(),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

/** Preflight report (spec section 109) — generation cannot start without a pass. */
export const PreflightReport = z.object({
  passed: z.boolean(),
  models_installed: z.boolean(),
  licenses_approved: z.boolean(),
  gpu_available: z.boolean(),
  references_valid: z.boolean(),
  storage_available: z.boolean(),
  quota_available: z.boolean(),
  budget_sufficient: z.boolean(),
  blockers: z.array(z.string()).default([]),
  estimated_gpu_seconds: z.number().nonnegative().default(0),
  estimated_queue_seconds: z.number().nonnegative().default(0),
  estimated_render_seconds: z.number().nonnegative().default(0),
  is_estimate: z.literal(true).default(true),
});
export type PreflightReport = z.infer<typeof PreflightReport>;

/** Rights declaration required before a face or voice can be used (spec section 75). */
export const RightsType = z.enum([
  "face_likeness",
  "voice_clone",
  "copyrighted_product",
  "private_footage",
  "music",
]);

export const RightsDeclaration = z.object({
  asset_id: Uuid,
  rights_type: RightsType,
  declared_by: Uuid,
  declared_at: z.string().datetime(),
  scope: z.string().min(1),
  evidence_asset_id: Uuid.nullable().default(null),
});
export type RightsDeclaration = z.infer<typeof RightsDeclaration>;

export const SkillDescriptor = z.object({
  skill_id: Slug,
  name: z.string().min(1),
  version: z.string().min(1),
  category: z.enum([
    "planning",
    "prompt",
    "cinematic",
    "realism",
    "identity",
    "motion",
    "ugc",
    "audio",
    "quality",
    "repair",
    "operations",
    "governance",
  ]),
  description: z.string().min(1),
  required_tools: z.array(z.string()).default([]),
  supported_models: z.array(ModelId).default([]),
  requires_skills: z.array(Slug).default([]),
  quality_profile: z.string().default("STANDARD"),
  timeout_seconds: z.number().int().positive().default(120),
  max_retries: z.number().int().nonnegative().default(1),
  license: z.string().default("proprietary"),
  status: z.enum(["draft", "active", "deprecated", "disabled"]).default("active"),
});
export type SkillDescriptor = z.infer<typeof SkillDescriptor>;
