import { z } from "zod";

/**
 * Shared primitives. Every schema in this package builds on these so that
 * identity, timing and versioning are expressed one way across the system.
 */

export const Uuid = z.string().uuid();
export const Slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);

/** Every Director-facing schema carries the version it was produced against. */
export const SchemaVersion = z.string().regex(/^\d+\.\d+$/);

/**
 * Canonical timing. Frames and audio samples are integers over a rational
 * timebase; float seconds are derived for display only and are never stored
 * as truth (spec section 18).
 */
export const FrameRate = z.object({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
});
export type FrameRate = z.infer<typeof FrameRate>;

export const SampleRate = z.union([
  z.literal(44100),
  z.literal(48000),
  z.literal(96000),
]);

export const Timebase = z.object({
  frame_rate: FrameRate,
  audio_sample_rate: SampleRate,
});
export type Timebase = z.infer<typeof Timebase>;

/** Frame index, inclusive start / exclusive end. */
export const FrameSpan = z
  .object({
    start_frame: z.number().int().nonnegative(),
    end_frame: z.number().int().nonnegative(),
  })
  .refine((s) => s.end_frame > s.start_frame, {
    message: "end_frame must be greater than start_frame",
  });
export type FrameSpan = z.infer<typeof FrameSpan>;

/** Sample index, inclusive start / exclusive end. */
export const SampleSpan = z
  .object({
    start_sample: z.number().int().nonnegative(),
    end_sample: z.number().int().nonnegative(),
  })
  .refine((s) => s.end_sample > s.start_sample, {
    message: "end_sample must be greater than start_sample",
  });
export type SampleSpan = z.infer<typeof SampleSpan>;

export const AspectRatio = z.enum(["9:16", "16:9", "1:1", "4:5", "21:9"]);
export type AspectRatio = z.infer<typeof AspectRatio>;

export const Resolution = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const QualityMode = z.enum([
  "PREVIEW",
  "STANDARD",
  "REALISTIC",
  "UGC",
  "CINEMATIC",
  "PRODUCT",
  "AVATAR",
  "ULTRA",
]);
export type QualityMode = z.infer<typeof QualityMode>;

export const Platform = z.enum([
  "tiktok",
  "reels",
  "shorts",
  "youtube",
  "web",
  "broadcast",
  "other",
]);

export const Precision = z.enum(["fp32", "bf16", "fp16", "fp8"]);
export type Precision = z.infer<typeof Precision>;

export const GpuProfile = z.enum([
  "GPU_PROFILE_ECONOMY",
  "GPU_PROFILE_STANDARD",
  "GPU_PROFILE_HIGH",
  "GPU_PROFILE_ULTRA",
]);
export type GpuProfile = z.infer<typeof GpuProfile>;

/** Minimum VRAM in GiB advertised by each profile. */
export const GPU_PROFILE_VRAM_GIB: Record<GpuProfile, number> = {
  GPU_PROFILE_ECONOMY: 24,
  GPU_PROFILE_STANDARD: 48,
  GPU_PROFILE_HIGH: 80,
  GPU_PROFILE_ULTRA: 96,
};

export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const AssetRef = z.object({
  asset_id: Uuid,
  version: z.number().int().positive().optional(),
  sha256: Sha256.optional(),
});
export type AssetRef = z.infer<typeof AssetRef>;
