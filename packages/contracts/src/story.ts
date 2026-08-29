import { z } from "zod";
import { AssetRef, SchemaVersion, Slug, Uuid } from "./primitives.js";

/**
 * Script, scenes, shots and the shot dependency graph
 * (spec sections 14 and 15).
 */
export const SCRIPT_SCHEMA_VERSION = "1.0";
export const SHOT_PLAN_SCHEMA_VERSION = "1.0";

export const DialogueLine = z.object({
  id: Slug,
  character_id: Slug,
  voice_id: Slug,
  text: z.string().min(1),
  emotion: z.string().default("neutral"),
  /** Explicit pauses the TTS planner should honour, in milliseconds. */
  pause_before_ms: z.number().int().nonnegative().default(0),
  pause_after_ms: z.number().int().nonnegative().default(0),
  pronunciation_hints: z.record(z.string(), z.string()).default({}),
});
export type DialogueLine = z.infer<typeof DialogueLine>;

export const Script = z.object({
  schema_version: SchemaVersion.default(SCRIPT_SCHEMA_VERSION),
  title: z.string().min(1),
  logline: z.string().default(""),
  narration: z.array(DialogueLine).default([]),
  dialogue: z.array(DialogueLine).default([]),
  on_screen_text: z.array(z.string()).default([]),
});
export type Script = z.infer<typeof Script>;

export const ShotType = z.enum([
  "establishing",
  "wide",
  "medium",
  "closeup",
  "extreme_closeup",
  "insert",
  "over_the_shoulder",
  "pov",
  "selfie",
  "product_hero",
  "cutaway",
]);

/**
 * Which generation family a shot needs. The router turns this plus the rest of
 * the routing input into a concrete model decision; the planner never names a
 * model itself.
 */
export const GenerationKind = z.enum([
  "text_to_video",
  "image_to_video",
  "speech_to_video",
  "character_animation",
  "image",
]);
export type GenerationKind = z.infer<typeof GenerationKind>;

export const CameraPlan = z.object({
  framing: ShotType,
  lens: z.string().default(""),
  movement: z.string().default("static"),
  height: z.string().default("eye_level"),
  focus_behavior: z.string().default(""),
});

export const Shot = z.object({
  id: Slug,
  scene_id: Slug,
  index: z.number().int().nonnegative(),
  description: z.string().min(1),
  action: z.string().min(1),
  shot_type: ShotType,
  /** Duration is authoritative in frames, never seconds. */
  duration_frames: z.number().int().positive(),
  camera: CameraPlan,
  character_ids: z.array(Slug).default([]),
  product_ids: z.array(Slug).default([]),
  location_id: Slug.nullable().default(null),
  dialogue_line_ids: z.array(Slug).default([]),
  /** Planner's view of how hard this is; feeds the router and retry budget. */
  motion_complexity: z.number().min(0).max(1).default(0.5),
  continuity_requirement: z.number().min(0).max(1).default(0.5),
  requires_identity_lock: z.boolean().default(false),
  requires_product_fidelity: z.boolean().default(false),
  preferred_generation_kind: GenerationKind,
  start_frame_asset: AssetRef.nullable().default(null),
  end_frame_asset: AssetRef.nullable().default(null),
  notes: z.string().default(""),
});
export type Shot = z.infer<typeof Shot>;

export const Scene = z.object({
  id: Slug,
  index: z.number().int().nonnegative(),
  summary: z.string().min(1),
  location_id: Slug.nullable().default(null),
  shot_ids: z.array(Slug).min(1),
});
export type Scene = z.infer<typeof Scene>;

/** Edge kinds in the dependency graph (spec section 15). */
export const DependencyKind = z.enum([
  "character",
  "product",
  "location",
  "voice",
  "style",
  "shot_end_frame",
  "shot_start_frame",
  "dialogue",
]);
export type DependencyKind = z.infer<typeof DependencyKind>;

export const ShotDependency = z.object({
  shot_id: Slug,
  kind: DependencyKind,
  /** Entity slug, or `shot_id` for frame dependencies. */
  ref: Slug,
});
export type ShotDependency = z.infer<typeof ShotDependency>;

export const ShotPlan = z.object({
  schema_version: SchemaVersion.default(SHOT_PLAN_SCHEMA_VERSION),
  scenes: z.array(Scene).min(1),
  shots: z.array(Shot).min(1),
  dependencies: z.array(ShotDependency).default([]),
});
export type ShotPlan = z.infer<typeof ShotPlan>;

/** Result of dependency invalidation: exactly which shots went stale and why. */
export const InvalidationResult = z.object({
  changed_ref: Slug,
  changed_kind: DependencyKind,
  stale_shot_ids: z.array(Slug),
  reasons: z.record(Slug, z.array(z.string())),
});
export type InvalidationResult = z.infer<typeof InvalidationResult>;

export const StoryboardFrame = z.object({
  shot_id: Slug,
  asset: AssetRef.nullable().default(null),
  prompt: z.string().default(""),
});

export const Storyboard = z.object({
  schema_version: SchemaVersion.default("1.0"),
  frames: z.array(StoryboardFrame).default([]),
  project_id: Uuid.optional(),
});
export type Storyboard = z.infer<typeof Storyboard>;
