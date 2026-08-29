import { z } from "zod";
import { AssetRef, SchemaVersion, Slug, Timebase, Uuid } from "./primitives.js";

/**
 * Master timeline (spec sections 18 and 20). Video events are addressed in
 * frames, audio events in samples, both against one project timebase. There is
 * no float seconds field anywhere in this schema on purpose.
 */
export const TIMELINE_SCHEMA_VERSION = "1.0";

export const TrackKind = z.enum([
  "VIDEO",
  "DIALOGUE",
  "MUSIC",
  "SFX",
  "AMBIENCE",
  "ROOM_TONE",
  "CAPTIONS",
]);
export type TrackKind = z.infer<typeof TrackKind>;

export const AUDIO_TRACK_KINDS: TrackKind[] = [
  "DIALOGUE",
  "MUSIC",
  "SFX",
  "AMBIENCE",
  "ROOM_TONE",
];

export const VideoEvent = z.object({
  id: Slug,
  track_id: Slug,
  kind: z.literal("video"),
  asset: AssetRef,
  shot_id: Slug.nullable().default(null),
  scene_id: Slug.nullable().default(null),
  start_frame: z.number().int().nonnegative(),
  end_frame: z.number().int().positive(),
  /** Offset into the source asset, in frames. */
  source_start_frame: z.number().int().nonnegative().default(0),
});
export type VideoEvent = z.infer<typeof VideoEvent>;

export const AudioEvent = z.object({
  id: Slug,
  track_id: Slug,
  kind: z.literal("audio"),
  asset: AssetRef,
  shot_id: Slug.nullable().default(null),
  scene_id: Slug.nullable().default(null),
  start_sample: z.number().int().nonnegative(),
  end_sample: z.number().int().positive(),
  source_start_sample: z.number().int().nonnegative().default(0),
  gain_db: z.number().default(0),
  fade_in_samples: z.number().int().nonnegative().default(0),
  fade_out_samples: z.number().int().nonnegative().default(0),
  pan: z.number().min(-1).max(1).default(0),
  ducking_group: z.string().nullable().default(null),
});
export type AudioEvent = z.infer<typeof AudioEvent>;

export const CaptionEvent = z.object({
  id: Slug,
  track_id: Slug,
  kind: z.literal("caption"),
  text: z.string().min(1),
  /** Captions derive from final dialogue timing, so they are sample-addressed. */
  start_sample: z.number().int().nonnegative(),
  end_sample: z.number().int().positive(),
  speaker_id: Slug.nullable().default(null),
});
export type CaptionEvent = z.infer<typeof CaptionEvent>;

export const TimelineEvent = z.discriminatedUnion("kind", [
  VideoEvent,
  AudioEvent,
  CaptionEvent,
]);
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const TimelineTrack = z.object({
  id: Slug,
  kind: TrackKind,
  index: z.number().int().nonnegative(),
  muted: z.boolean().default(false),
});
export type TimelineTrack = z.infer<typeof TimelineTrack>;

/** Loudness targets per delivery context (spec section 20 — never one hardcoded LUFS). */
export const LoudnessProfile = z.enum(["social", "youtube", "broadcast", "cinema", "custom"]);
export type LoudnessProfile = z.infer<typeof LoudnessProfile>;

export const LOUDNESS_TARGETS: Record<
  Exclude<LoudnessProfile, "custom">,
  { integrated_lufs: number; true_peak_dbtp: number; lra: number }
> = {
  social: { integrated_lufs: -14, true_peak_dbtp: -1, lra: 8 },
  youtube: { integrated_lufs: -14, true_peak_dbtp: -1, lra: 9 },
  broadcast: { integrated_lufs: -23, true_peak_dbtp: -2, lra: 11 },
  cinema: { integrated_lufs: -27, true_peak_dbtp: -3, lra: 16 },
};

export const Timeline = z.object({
  schema_version: SchemaVersion.default(TIMELINE_SCHEMA_VERSION),
  project_id: Uuid,
  timebase: Timebase,
  duration_frames: z.number().int().positive(),
  tracks: z.array(TimelineTrack).min(1),
  events: z.array(TimelineEvent).default([]),
  loudness_profile: LoudnessProfile.default("social"),
});
export type Timeline = z.infer<typeof Timeline>;

/** Word-level alignment produced by the aligner, used for lip sync and captions. */
export const WordTiming = z.object({
  word: z.string(),
  start_sample: z.number().int().nonnegative(),
  end_sample: z.number().int().positive(),
  confidence: z.number().min(0).max(1).default(1),
});
export type WordTiming = z.infer<typeof WordTiming>;

export const DialogueAlignment = z.object({
  dialogue_line_id: Slug,
  asset: AssetRef,
  sample_rate: z.number().int().positive(),
  words: z.array(WordTiming),
  phonemes: z
    .array(
      z.object({
        phoneme: z.string(),
        start_sample: z.number().int().nonnegative(),
        end_sample: z.number().int().positive(),
      }),
    )
    .default([]),
});
export type DialogueAlignment = z.infer<typeof DialogueAlignment>;
