import type {
  AudioEvent,
  CaptionEvent,
  DialogueAlignment,
  Shot,
  ShotPlan,
  Timebase,
  Timeline,
  TimelineEvent,
  TimelineTrack,
  TrackKind,
  VideoEvent,
} from "@videoai/contracts";
import { captionsFromAlignment, layoutVideoTrack } from "./timeline.js";
import { framesToSamples, samplesToFrames, type Rational } from "./rational.js";

/**
 * Timeline assembly (spec sections 18, 19, 20).
 *
 * This is where the two clocks meet. Video is planned in frames and speech is
 * produced in samples, and the lengths never agree exactly: a TTS line is
 * however long it turned out to be, not however long the planner guessed.
 *
 * The rule applied here is that measured audio wins. A shot whose dialogue
 * overruns is extended to hold it, because the alternative -- clipping the
 * speech to fit the plan -- is the single most audible defect a system like
 * this can ship.
 */

export interface AssembledDialogue {
  dialogue_line_id: string;
  shot_id: string | null;
  asset_id: string;
  /** Real measured length of the rendered WAV, not the planned length. */
  length_samples: number;
  pause_before_samples: number;
  pause_after_samples: number;
  alignment?: DialogueAlignment;
}

export interface AssembledBed {
  kind: Extract<TrackKind, "MUSIC" | "SFX" | "AMBIENCE" | "ROOM_TONE">;
  asset_id: string;
  start_sample: number;
  length_samples: number;
  gain_db?: number;
  shot_id?: string | null;
}

export interface AssembleInput {
  project_id: string;
  timebase: Timebase;
  plan: ShotPlan;
  /** Shot slug to the asset id of its current approved take. */
  shot_assets: Record<string, string>;
  dialogue?: AssembledDialogue[];
  beds?: AssembledBed[];
  loudness_profile?: Timeline["loudness_profile"];
  captions?: { maxChars?: number; maxWords?: number };
}

export interface AssembleResult {
  timeline: Timeline;
  /** Shots whose length changed to hold their dialogue, and by how much. */
  extended_shots: Array<{ shot_id: string; from_frames: number; to_frames: number }>;
}

const TRACKS: Array<{ id: string; kind: TrackKind }> = [
  { id: "video", kind: "VIDEO" },
  { id: "dialogue", kind: "DIALOGUE" },
  { id: "music", kind: "MUSIC" },
  { id: "sfx", kind: "SFX" },
  { id: "ambience", kind: "AMBIENCE" },
  { id: "captions", kind: "CAPTIONS" },
];

export function assembleTimeline(input: AssembleInput): AssembleResult {
  const fps: Rational = input.timebase.frame_rate;
  const sampleRate = input.timebase.audio_sample_rate;
  const dialogue = input.dialogue ?? [];

  const { shots, extended } = fitShotsToDialogue(input.plan.shots, dialogue, fps, sampleRate);

  const videoEvents = layoutVideoTrack(
    "video",
    shots.map((shot) => ({
      shot_id: shot.id,
      scene_id: shot.scene_id,
      asset_id: input.shot_assets[shot.id] ?? "",
      duration_frames: shot.duration_frames,
    })),
  ).filter((event) => event.asset.asset_id !== "");

  // Dialogue is placed against the shot it belongs to rather than laid end to
  // end, so a line stays with its picture even when neighbouring shots change.
  const shotStarts = frameOffsets(shots);
  const { events: dialogueEvents, offsets } = placeDialogue(
    dialogue,
    shotStarts,
    fps,
    sampleRate,
  );

  const captionEvents: CaptionEvent[] = captionsFromAlignment(
    "captions",
    dialogue.filter((d) => d.alignment).map((d) => d.alignment!),
    { ...input.captions, offsetSamplesById: offsets },
  );

  const bedEvents = placeBeds(input.beds ?? []);
  const ducked = applyDucking(bedEvents, dialogueEvents, sampleRate);

  const durationFrames = shots.reduce((sum, s) => sum + s.duration_frames, 0);

  const timeline: Timeline = {
    schema_version: "1.0",
    project_id: input.project_id,
    timebase: input.timebase,
    duration_frames: Math.max(durationFrames, 1),
    tracks: TRACKS.map((t, index): TimelineTrack => ({ ...t, index, muted: false })),
    events: [...videoEvents, ...dialogueEvents, ...ducked, ...captionEvents] as TimelineEvent[],
    loudness_profile: input.loudness_profile ?? "social",
  };

  return { timeline, extended_shots: extended };
}

/**
 * Extend any shot whose dialogue does not fit inside it.
 *
 * The extension is rounded up to a whole frame, so the shot still ends on a
 * frame boundary and the cut stays clean.
 */
function fitShotsToDialogue(
  shots: Shot[],
  dialogue: AssembledDialogue[],
  fps: Rational,
  sampleRate: number,
): { shots: Shot[]; extended: AssembleResult["extended_shots"] } {
  const neededSamples = new Map<string, number>();
  for (const line of dialogue) {
    if (!line.shot_id) continue;
    const total = line.pause_before_samples + line.length_samples + line.pause_after_samples;
    neededSamples.set(line.shot_id, (neededSamples.get(line.shot_id) ?? 0) + total);
  }

  const extended: AssembleResult["extended_shots"] = [];
  const adjusted = shots.map((shot) => {
    const needed = neededSamples.get(shot.id);
    if (needed === undefined) return shot;

    const neededFrames = samplesToFrames(needed, fps, sampleRate, "ceil");
    if (neededFrames <= shot.duration_frames) return shot;

    extended.push({ shot_id: shot.id, from_frames: shot.duration_frames, to_frames: neededFrames });
    return { ...shot, duration_frames: neededFrames };
  });

  return { shots: adjusted, extended };
}

/** Start frame of every shot, in plan order. */
function frameOffsets(shots: Shot[]): Map<string, number> {
  const offsets = new Map<string, number>();
  let cursor = 0;
  for (const shot of [...shots].sort((a, b) => a.index - b.index)) {
    offsets.set(shot.id, cursor);
    cursor += shot.duration_frames;
  }
  return offsets;
}

function placeDialogue(
  dialogue: AssembledDialogue[],
  shotStarts: Map<string, number>,
  fps: Rational,
  sampleRate: number,
): { events: AudioEvent[]; offsets: Record<string, number> } {
  const events: AudioEvent[] = [];
  const offsets: Record<string, number> = {};
  // Lines that belong to no shot run in narration order after the last one
  // that does, rather than being dropped.
  const cursorByShot = new Map<string, number>();
  let narrationCursor = 0;

  for (const line of dialogue) {
    let start: number;
    if (line.shot_id && shotStarts.has(line.shot_id)) {
      const shotStart = framesToSamples(shotStarts.get(line.shot_id)!, fps, sampleRate);
      const within = cursorByShot.get(line.shot_id) ?? 0;
      start = shotStart + within + line.pause_before_samples;
      cursorByShot.set(
        line.shot_id,
        within + line.pause_before_samples + line.length_samples + line.pause_after_samples,
      );
    } else {
      start = narrationCursor + line.pause_before_samples;
      narrationCursor = start + line.length_samples + line.pause_after_samples;
    }

    // Captions are built from alignment timings that are relative to their own
    // WAV, so they need the same offset the audio got.
    offsets[line.dialogue_line_id] = start;

    events.push({
      id: `ev_${line.dialogue_line_id}`,
      track_id: "dialogue",
      kind: "audio",
      asset: { asset_id: line.asset_id },
      shot_id: line.shot_id,
      scene_id: null,
      start_sample: start,
      end_sample: start + line.length_samples,
      source_start_sample: 0,
      gain_db: 0,
      fade_in_samples: 0,
      fade_out_samples: 0,
      pan: 0,
      ducking_group: "dialogue",
    });
  }

  return { events, offsets };
}

function placeBeds(beds: AssembledBed[]): AudioEvent[] {
  return beds.map((bed, index) => ({
    id: `ev_bed_${bed.kind.toLowerCase()}_${index}`,
    track_id: bed.kind.toLowerCase(),
    kind: "audio" as const,
    asset: { asset_id: bed.asset_id },
    shot_id: bed.shot_id ?? null,
    scene_id: null,
    start_sample: bed.start_sample,
    end_sample: bed.start_sample + bed.length_samples,
    source_start_sample: 0,
    gain_db: bed.gain_db ?? 0,
    fade_in_samples: 0,
    fade_out_samples: 0,
    pan: 0,
    ducking_group: bed.kind === "MUSIC" ? "music" : null,
  }));
}

/** How far music drops under speech, and how quickly it recovers. */
export const DUCKING = {
  attenuation_db: -9,
  attack_ms: 120,
  release_ms: 400,
};

/**
 * Resolve ducking groups into explicit gain and fade values.
 *
 * The compositor could do this with a sidechain compressor, but computing it
 * here means the envelope is visible in the timeline: the editor can show why
 * the music dipped, and the result is identical on every render rather than
 * depending on a detector's behaviour.
 */
export function applyDucking(
  beds: AudioEvent[],
  dialogue: AudioEvent[],
  sampleRate: number,
): AudioEvent[] {
  if (dialogue.length === 0) return beds;

  const attack = Math.round((DUCKING.attack_ms * sampleRate) / 1000);
  const release = Math.round((DUCKING.release_ms * sampleRate) / 1000);
  const speech = mergeSpans(
    dialogue.map((d) => ({ start: d.start_sample, end: d.end_sample })),
  );

  return beds.flatMap((bed) => {
    if (bed.ducking_group !== "music") return [bed];

    const overlapping = speech.filter((s) => s.end > bed.start_sample && s.start < bed.end_sample);
    if (overlapping.length === 0) return [bed];

    // The bed is split at each speech span so the ducked section is its own
    // event with its own gain, which keeps every value on the timeline exact.
    const pieces: AudioEvent[] = [];
    let cursor = bed.start_sample;
    let part = 0;

    for (const span of overlapping) {
      const duckStart = Math.max(bed.start_sample, span.start - attack);
      const duckEnd = Math.min(bed.end_sample, span.end + release);

      if (duckStart > cursor) {
        pieces.push(slice(bed, cursor, duckStart, bed.gain_db, part++));
      }
      pieces.push(
        slice(bed, Math.max(cursor, duckStart), duckEnd, bed.gain_db + DUCKING.attenuation_db, part++, {
          fade_in_samples: attack,
          fade_out_samples: release,
        }),
      );
      cursor = duckEnd;
    }

    if (cursor < bed.end_sample) {
      pieces.push(slice(bed, cursor, bed.end_sample, bed.gain_db, part++));
    }
    return pieces.filter((p) => p.end_sample > p.start_sample);
  });
}

function slice(
  bed: AudioEvent,
  start: number,
  end: number,
  gainDb: number,
  part: number,
  extra: Partial<AudioEvent> = {},
): AudioEvent {
  return {
    ...bed,
    id: `${bed.id}_${part}`,
    start_sample: start,
    end_sample: end,
    // Reading continues from the same point in the source file, so splitting
    // for ducking never makes the music restart.
    source_start_sample: bed.source_start_sample + (start - bed.start_sample),
    gain_db: gainDb,
    fade_in_samples: 0,
    fade_out_samples: 0,
    ...extra,
  };
}

function mergeSpans(spans: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}
