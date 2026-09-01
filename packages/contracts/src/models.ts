import { z } from "zod";
import {
  AssetRef,
  GpuProfile,
  ModelId,
  Precision,
  QualityMode,
  Resolution,
  SchemaVersion,
  Sha256,
  Slug,
  Uuid,
} from "./primitives.js";
import { GenerationKind } from "./story.js";

/**
 * Model registry, licensing and routing (spec sections 17, 53, 55, 65, 85).
 *
 * Nothing in product logic names a model or a GPU. Callers describe what a shot
 * needs; the router answers with a decision drawn from the registry, and it
 * refuses anything whose licence is not explicitly approved.
 */

export const ModelLifecycle = z.enum([
  "candidate",
  "testing",
  "benchmarking",
  "approved",
  "canary",
  "production",
  "deprecated",
  "license_blocked",
  "disabled",
]);
export type ModelLifecycle = z.infer<typeof ModelLifecycle>;

/** Only `approved` may be routed to. Everything else is fail-closed. */
export const LicenseStatus = z.enum(["unknown", "pending_review", "approved", "blocked", "expired_review"]);
export type LicenseStatus = z.infer<typeof LicenseStatus>;

export const ModelLicense = z.object({
  license_name: z.string().min(1),
  license_url: z.string().url().nullable().default(null),
  commercial_use: z.boolean(),
  territories: z.array(z.string()).default(["*"]),
  attribution_required: z.boolean().default(false),
  restrictions: z.array(z.string()).default([]),
  reviewed_at: z.string().datetime().nullable().default(null),
  reviewed_by: z.string().nullable().default(null),
  status: LicenseStatus,
});
export type ModelLicense = z.infer<typeof ModelLicense>;

/**
 * Every kind of work a model can be routed for.
 *
 * A superset of `GenerationKind`, which is what a *shot* may ask for. Speech,
 * alignment, ambience and lipsync are not shots and never appear in a shot
 * plan, but they are routed through the same registry and the same rules --
 * the model registry has carried capability rows for them since the first
 * seed, and this enum is what finally lets the router see them. Kept in step
 * with the check constraint on `model_capabilities.generation_kind`.
 */
export const RoutableKind = z.enum([
  ...GenerationKind.options,
  "text_to_speech",
  "video_to_audio",
  "lipsync",
  "alignment",
  "vision_qc",
  "reasoning",
  "upscale",
]);
export type RoutableKind = z.infer<typeof RoutableKind>;

export const ModelCapability = z.object({
  generation_kind: RoutableKind,
  // Zero means "not bounded by frames": a TTS line is as long as the sentence
  // and an alignment pass has no output length at all. The router skips the
  // duration check for those rather than rejecting every one of them.
  max_duration_frames: z.number().int().nonnegative(),
  supported_resolutions: z.array(Resolution).min(1),
  supported_precisions: z.array(Precision).min(1),
  accepts_reference_images: z.boolean().default(false),
  accepts_driving_audio: z.boolean().default(false),
  produces_audio: z.boolean().default(false),
});
export type ModelCapability = z.infer<typeof ModelCapability>;

export const ModelArtifact = z.object({
  file: z.string().min(1),
  sha256: Sha256,
  size_bytes: z.number().int().positive(),
  source: z.string().min(1),
});

export const ModelVersionRecord = z.object({
  model_id: ModelId,
  version: z.string().min(1),
  adapter: z.string().min(1),
  runtime: z.string().min(1),
  lifecycle: ModelLifecycle,
  required_profile: GpuProfile,
  required_vram_gib: z.number().positive(),
  capabilities: z.array(ModelCapability).min(1),
  license: ModelLicense,
  artifacts: z.array(ModelArtifact).default([]),
});
export type ModelVersionRecord = z.infer<typeof ModelVersionRecord>;

/** Input to the router (spec section 17). */
export const RoutingRequest = z.object({
  generation_kind: RoutableKind,
  quality_mode: QualityMode,
  // Zero for work that is not measured in frames -- a line of speech, an
  // alignment pass, an ambience bed. The router skips its duration check then.
  duration_frames: z.number().int().nonnegative(),
  resolution: Resolution,
  human_count: z.number().int().nonnegative().default(0),
  has_dialogue: z.boolean().default(false),
  has_reference_images: z.boolean().default(false),
  motion_complexity: z.number().min(0).max(1).default(0.5),
  continuity_requirement: z.number().min(0).max(1).default(0.5),
  requires_product_fidelity: z.boolean().default(false),
  requires_identity_lock: z.boolean().default(false),
  /** Profiles the scheduler currently has healthy workers for. */
  available_profiles: z.array(GpuProfile).min(1),
});
export type RoutingRequest = z.infer<typeof RoutingRequest>;

export const RoutingDecision = z.object({
  model_id: ModelId,
  model_version: z.string().min(1),
  adapter: z.string().min(1),
  runtime: z.string().min(1),
  precision: Precision,
  generation_profile: z.string().min(1),
  required_profile: GpuProfile,
  skills: z.array(Slug).default([]),
  qc_profile: z.string().min(1),
  rule_id: z.string().min(1),
  reason: z.string().min(1),
});
export type RoutingDecision = z.infer<typeof RoutingDecision>;

/**
 * Routing rules live in the database, not in code branches, so routing can be
 * changed without a deploy and without a UI migration (spec section 17).
 */
export const RoutingRule = z.object({
  id: z.string().min(1),
  priority: z.number().int(),
  enabled: z.boolean().default(true),
  match: z.object({
    generation_kind: z.array(RoutableKind).optional(),
    quality_mode: z.array(QualityMode).optional(),
    has_dialogue: z.boolean().optional(),
    requires_identity_lock: z.boolean().optional(),
    requires_product_fidelity: z.boolean().optional(),
    min_motion_complexity: z.number().min(0).max(1).optional(),
    max_duration_frames: z.number().int().positive().optional(),
  }),
  target: z.object({
    model_id: ModelId,
    precision: Precision,
    generation_profile: z.string().min(1),
    qc_profile: z.string().min(1),
    skills: z.array(Slug).default([]),
  }),
  reason: z.string().min(1),
});
export type RoutingRule = z.infer<typeof RoutingRule>;

/** Model adapter contract (spec section 55). */
export const GenerateRequest = z.object({
  job_id: Uuid,
  project_id: Uuid,
  organization_id: Uuid,
  shot_id: Slug.nullable().default(null),
  attempt: z.number().int().positive().default(1),
  model_id: ModelId,
  model_version: z.string().min(1),
  precision: Precision,
  prompt: z.string().default(""),
  negative_prompt: z.string().default(""),
  references: z
    .array(
      z.object({ role: z.string().min(1), asset: AssetRef, strength: z.number().min(0).max(1).default(1) }),
    )
    .default([]),
  driving_audio: AssetRef.nullable().default(null),
  seed: z.number().int().nonnegative(),
  duration_frames: z.number().int().positive().optional(),
  fps_num: z.number().int().positive().optional(),
  fps_den: z.number().int().positive().optional(),
  resolution: Resolution,
  settings: z.record(z.string(), z.unknown()).default({}),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

export const GenerateResult = z.object({
  job_id: Uuid,
  asset_id: Uuid,
  storage_key: z.string().min(1),
  sha256: Sha256,
  runtime_ms: z.number().int().nonnegative(),
  peak_vram_bytes: z.number().int().nonnegative(),
  model_version: z.string().min(1),
  seed: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type GenerateResult = z.infer<typeof GenerateResult>;

/** Full reproducibility record written for every generation (spec section 64). */
export const GenerationProvenance = z.object({
  model_id: ModelId,
  model_version: z.string(),
  model_hash: Sha256.nullable(),
  adapter_version: z.string(),
  skill_versions: z.record(z.string(), z.string()).default({}),
  prompt: z.string(),
  negative_prompt: z.string(),
  reference_hashes: z.array(Sha256).default([]),
  seed: z.number().int(),
  steps: z.number().int().nullable(),
  guidance: z.number().nullable(),
  resolution: Resolution,
  fps_num: z.number().int().nullable(),
  fps_den: z.number().int().nullable(),
  frames: z.number().int().nullable(),
  precision: Precision,
  gpu_name: z.string().nullable(),
  cuda_version: z.string().nullable(),
  runtime_ms: z.number().int(),
  peak_vram_bytes: z.number().int(),
  output_hash: Sha256,
});
export type GenerationProvenance = z.infer<typeof GenerationProvenance>;

/**
 * Capability snapshot handed to the Director at preflight (spec section 108).
 * The Director may only reference things present here, which structurally
 * prevents it from inventing models or tools.
 */
export const CapabilitySnapshot = z.object({
  schema_version: SchemaVersion.default("1.0"),
  generated_at: z.string().datetime(),
  models: z.array(
    z.object({
      model_id: ModelId,
      version: z.string(),
      generation_kinds: z.array(RoutableKind),
      max_duration_frames: z.number().int().nonnegative(),
    }),
  ),
  skills: z.array(z.object({ skill_id: Slug, version: z.string() })),
  available_profiles: z.array(GpuProfile),
  voices: z.array(Slug).default([]),
  quality_modes: z.array(QualityMode),
});
export type CapabilitySnapshot = z.infer<typeof CapabilitySnapshot>;
