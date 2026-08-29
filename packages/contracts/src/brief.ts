import { z } from "zod";
import { AspectRatio, Platform, QualityMode, SchemaVersion, Uuid } from "./primitives.js";

/**
 * Creative Brief (spec section 10). The Director normalises a free-text user
 * prompt into this structure. Nothing downstream reads the raw user prompt;
 * everything reads the brief.
 */
export const CREATIVE_BRIEF_SCHEMA_VERSION = "1.0";

export const BriefProduct = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  key_features: z.array(z.string()).default([]),
  claims: z.array(z.string()).default([]),
  reference_asset_ids: z.array(Uuid).default([]),
});

export const CreativeBrief = z.object({
  schema_version: SchemaVersion.default(CREATIVE_BRIEF_SCHEMA_VERSION),
  goal: z.string().min(1),
  audience: z.string().min(1),
  platform: Platform,
  /** Target duration expressed in frames against the project timebase. */
  target_duration_frames: z.number().int().positive(),
  aspect_ratio: AspectRatio,
  quality_mode: QualityMode,
  tone: z.array(z.string()).min(1),
  style: z.string().min(1),
  creator_profile: z.string().nullable().default(null),
  product: BriefProduct.nullable().default(null),
  hook: z.string().min(1),
  problem: z.string().nullable().default(null),
  solution: z.string().nullable().default(null),
  proof: z.array(z.string()).default([]),
  cta: z.string().nullable().default(null),
  constraints: z.array(z.string()).default([]),
  references: z.array(Uuid).default([]),
  language: z.string().min(2).default("en"),
});
export type CreativeBrief = z.infer<typeof CreativeBrief>;

/** What the user actually submits from the Create screen. */
export const CreateVideoRequest = z.object({
  prompt: z.string().min(1).max(8000),
  mode: QualityMode.default("STANDARD"),
  aspect_ratio: AspectRatio.default("9:16"),
  target_duration_seconds: z.number().positive().max(600),
  attachments: z
    .array(
      z.object({
        asset_id: Uuid,
        role: z.enum(["image", "product", "video", "audio", "voice_reference"]),
      }),
    )
    .default([]),
  approval_gates: z.boolean().default(false),
});
export type CreateVideoRequest = z.infer<typeof CreateVideoRequest>;
