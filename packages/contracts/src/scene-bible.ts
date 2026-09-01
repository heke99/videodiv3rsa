import { z } from "zod";
import { AssetRef, SchemaVersion, Slug, Uuid } from "./primitives.js";

/**
 * Scene Bible (spec section 11) — the canonical source of truth for visual
 * identity. Generators may never invent a new version of a character or a
 * product; a change is an explicit new entity version, which in turn
 * invalidates dependent shots.
 */
export const SCENE_BIBLE_SCHEMA_VERSION = "1.0";

const Entity = {
  id: Slug,
  label: z.string().min(1),
  /** Attributes the pipeline must never drift on. */
  forbidden_changes: z.array(z.string()).default([]),
  notes: z.string().default(""),
};

export const CharacterViewKind = z.enum([
  "face_master",
  "front",
  "three_quarter_left",
  "three_quarter_right",
  "profile_left",
  "profile_right",
  "full_body",
  "clothing",
  "expression",
]);
export type CharacterViewKind = z.infer<typeof CharacterViewKind>;

/** Character Package (spec section 12). Generated views are QC'd before becoming canonical. */
export const CharacterPackage = z.object({
  views: z.record(CharacterViewKind, AssetRef.nullable()).default({}),
  voice_reference_asset_id: Uuid.nullable().default(null),
});

export const Character = z.object({
  ...Entity,
  reference_assets: z.array(AssetRef).default([]),
  appearance: z.object({
    hair: z.string().default(""),
    eyes: z.string().default(""),
    skin: z.string().default(""),
    build: z.string().default(""),
    height: z.string().default(""),
    distinctive_features: z.array(z.string()).default([]),
  }),
  wardrobe: z.object({
    clothes: z.string().default(""),
    shoes: z.string().default(""),
    accessories: z.array(z.string()).default([]),
  }),
  voice_id: Slug.nullable().default(null),
  package: CharacterPackage.default({ views: {}, voice_reference_asset_id: null }),
});
export type Character = z.infer<typeof Character>;

export const ProductViewKind = z.enum([
  "front",
  "back",
  "left",
  "right",
  "top",
  "packaging",
  "logo_crop",
  "text_crop",
  "material_reference",
  "scale_reference",
]);
export type ProductViewKind = z.infer<typeof ProductViewKind>;

/** Product Package (spec section 13) — what the product / logo / text judges compare against. */
export const Product = z.object({
  ...Entity,
  reference_assets: z.array(AssetRef).default([]),
  views: z.record(ProductViewKind, AssetRef.nullable()).default({}),
  physical: z.object({
    dimensions: z.string().default(""),
    material: z.string().default(""),
    colors: z.array(z.string()).default([]),
    shape: z.string().default(""),
  }),
  branding: z.object({
    logo_description: z.string().default(""),
    on_pack_text: z.array(z.string()).default([]),
  }),
  critical_features: z.array(z.string()).default([]),
});
export type Product = z.infer<typeof Product>;

export const Location = z.object({
  ...Entity,
  reference_assets: z.array(AssetRef).default([]),
  architecture: z.string().default(""),
  layout: z.string().default(""),
  lighting: z.string().default(""),
  time_of_day: z.string().default(""),
  weather: z.string().default(""),
  background: z.string().default(""),
  persistent_objects: z.array(z.string()).default([]),
});
export type Location = z.infer<typeof Location>;

export const StyleProfile = z.object({
  camera_style: z.string().default(""),
  lens_language: z.string().default(""),
  lighting: z.string().default(""),
  exposure: z.string().default(""),
  contrast: z.string().default(""),
  grain: z.string().default(""),
  motion_style: z.string().default(""),
  focus_behavior: z.string().default(""),
  color_grade: z.string().default(""),
  realism_profile: z.string().default(""),
});
export type StyleProfile = z.infer<typeof StyleProfile>;

/** Persistent project voice identity (spec section 6). Deterministic across shots. */
export const VoiceProfile = z.object({
  id: Slug,
  speaker_profile: z.string().min(1),
  language: z.string().min(2),
  accent: z.string().default(""),
  style: z.string().default(""),
  reference_asset_ids: z.array(Uuid).default([]),
  voice_model: z.string().min(1),
  model_version: z.string().min(1),
  seed: z.number().int().nonnegative(),
  speech_rate: z.number().positive().default(1),
});
export type VoiceProfile = z.infer<typeof VoiceProfile>;

export const SceneBible = z.object({
  schema_version: SchemaVersion.default(SCENE_BIBLE_SCHEMA_VERSION),
  characters: z.array(Character).default([]),
  products: z.array(Product).default([]),
  locations: z.array(Location).default([]),
  style: StyleProfile,
  voices: z.array(VoiceProfile).default([]),
});
export type SceneBible = z.infer<typeof SceneBible>;
