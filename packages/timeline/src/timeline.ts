import type {
  AudioEvent,
  CaptionEvent,
  DialogueAlignment,
  Timeline,
  TimelineEvent,
  TrackKind,
  VideoEvent,
} from "@videoai/contracts";
import { AUDIO_TRACK_KINDS } from "@videoai/contracts";
import { framesToSamples, samplesToFrames, type Rational } from "./rational.js";

/**
 * Timeline assembly and validation. The timeline is the one place video and
 * audio agree on where things are, so every rule here is about keeping the two
 * clocks consistent rather than approximately aligned.
 */

export interface TimelineIssue {
  code: string;
  message: string;
  event_id?: string;
}

export function validateTimeline(timeline: Timeline): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  const fps: Rational = timeline.timebase.frame_rate;
  const sampleRate = timeline.timebase.audio_sample_rate;
  const trackKinds = new Map<string, TrackKind>(timeline.tracks.map((t) => [t.id, t.kind]));

  const spansByTrack = new Map<string, Array<{ id: string; start: number; end: number }>>();

  for (const event of timeline.events) {
    const kind = trackKinds.get(event.track_id);
    if (!kind) {
      issues.push({
        code: "unknown_track",
        message: `Event references track ${event.track_id} which is not declared`,
        event_id: event.id,
      });
      continue;
    }

    if (event.kind === "video" && kind !== "VIDEO") {
      issues.push({
        code: "track_kind_mismatch",
        message: `Video event on ${kind} track`,
        event_id: event.id,
      });
    }
    if (event.kind === "audio" && !AUDIO_TRACK_KINDS.includes(kind)) {
      issues.push({
        code: "track_kind_mismatch",
        message: `Audio event on ${kind} track`,
        event_id: event.id,
      });
    }
    if (event.kind === "caption" && kind !== "CAPTIONS") {
      issues.push({
        code: "track_kind_mismatch",
        message: `Caption event on ${kind} track`,
        event_id: event.id,
      });
    }

    const span = eventSpanTicks(event, fps, sampleRate);
    if (span.end <= span.start) {
      issues.push({ code: "empty_event", message: "Event ends before it starts", event_id: event.id });
    }

    const list = spansByTrack.get(event.track_id) ?? [];
    list.push({ id: event.id, ...span });
    spansByTrack.set(event.track_id, list);
  }

  // Overlap is an error on video and dialogue: two clips cannot own one moment.
  for (const [trackId, spans] of spansByTrack) {
    const kind = trackKinds.get(trackId);
    if (kind !== "VIDEO" && kind !== "DIALOGUE" && kind !== "CAPTIONS") continue;
    const sorted = [...spans].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (cur.start < prev.end) {
        issues.push({
          code: "overlapping_events",
          message: `Events ${prev.id} and ${cur.id} overlap on ${kind} track ${trackId}`,
          event_id: cur.id,
        });
      }
    }
  }

  const videoEnd = Math.max(
    0,
    ...timeline.events.filter((e): e is VideoEvent => e.kind === "video").map((e) => e.end_frame),
  );
  if (videoEnd > timeline.duration_frames) {
    issues.push({
      code: "event_past_duration",
      message: `Video extends to frame ${videoEnd} but timeline duration is ${timeline.duration_frames}`,
    });
  }

  return issues;
}

/** Normalise any event to master ticks so mixed clocks can be compared. */
function eventSpanTicks(
  event: TimelineEvent,
  fps: Rational,
  sampleRate: number,
): { start: number; end: number } {
  if (event.kind === "video") {
    return {
      start: framesToSamples(event.start_frame, fps, sampleRate),
      end: framesToSamples(event.end_frame, fps, sampleRate),
    };
  }
  return { start: event.start_sample, end: event.end_sample };
}

/**
 * Lay shots end to end on the video track. Shot durations are already in
 * frames, so this is exact and needs no rounding.
 */
export function layoutVideoTrack(
  trackId: string,
  shots: Array<{ shot_id: string; scene_id: string | null; asset_id: string; duration_frames: number }>,
): VideoEvent[] {
  let cursor = 0;
  return shots.map((shot) => {
    const event: VideoEvent = {
      id: `ev_${shot.shot_id}`,
      track_id: trackId,
      kind: "video",
      asset: { asset_id: shot.asset_id },
      shot_id: shot.shot_id,
      scene_id: shot.scene_id,
      start_frame: cursor,
      end_frame: cursor + shot.duration_frames,
      source_start_frame: 0,
    };
    cursor += shot.duration_frames;
    return event;
  });
}

/**
 * Place dialogue on the audio clock. The audio-first pipeline means the WAV
 * already exists, so its real sample length is authoritative and the video
 * plan must accommodate it, not the other way round.
 */
export function layoutDialogueTrack(
  trackId: string,
  lines: Array<{
    dialogue_line_id: string;
    asset_id: string;
    length_samples: number;
    pause_before_samples: number;
    pause_after_samples: number;
    shot_id: string | null;
  }>,
): AudioEvent[] {
  let cursor = 0;
  const events: AudioEvent[] = [];
  for (const line of lines) {
    cursor += line.pause_before_samples;
    events.push({
      id: `ev_${line.dialogue_line_id}`,
      track_id: trackId,
      kind: "audio",
      asset: { asset_id: line.asset_id },
      shot_id: line.shot_id,
      scene_id: null,
      start_sample: cursor,
      end_sample: cursor + line.length_samples,
      source_start_sample: 0,
      gain_db: 0,
      fade_in_samples: 0,
      fade_out_samples: 0,
      pan: 0,
      ducking_group: "dialogue",
    });
    cursor += line.length_samples + line.pause_after_samples;
  }
  return events;
}

/**
 * Captions come from final dialogue alignment, never from the original script
 * (spec section 21). Words are grouped into readable lines under the given
 * limits while staying inside the measured sample timing.
 */
export function captionsFromAlignment(
  trackId: string,
  alignments: DialogueAlignment[],
  opts: { maxChars?: number; maxWords?: number; offsetSamplesById?: Record<string, number> } = {},
): CaptionEvent[] {
  const maxChars = opts.maxChars ?? 42;
  const maxWords = opts.maxWords ?? 8;
  const events: CaptionEvent[] = [];
  let index = 0;

  for (const alignment of alignments) {
    const offset = opts.offsetSamplesById?.[alignment.dialogue_line_id] ?? 0;
    let bucket: typeof alignment.words = [];
    let chars = 0;

    const flush = () => {
      if (bucket.length === 0) return;
      const first = bucket[0]!;
      const last = bucket[bucket.length - 1]!;
      events.push({
        id: `cap_${alignment.dialogue_line_id}_${index++}`,
        track_id: trackId,
        kind: "caption",
        text: bucket.map((w) => w.word).join(" "),
        start_sample: first.start_sample + offset,
        end_sample: last.end_sample + offset,
        speaker_id: null,
      });
      bucket = [];
      chars = 0;
    };

    for (const word of alignment.words) {
      const projected = chars + word.word.length + (bucket.length ? 1 : 0);
      if (bucket.length >= maxWords || projected > maxChars) flush();
      bucket.push(word);
      chars += word.word.length + (bucket.length > 1 ? 1 : 0);
    }
    flush();
  }

  return events;
}

/**
 * Round a sample position to the nearest frame boundary. Used where a cut must
 * land on a frame, for example when a dialogue line drives a shot's length.
 */
export function snapSamplesToFrame(
  samples: number,
  fps: Rational,
  sampleRate: number,
): { frame: number; samples: number } {
  const frame = samplesToFrames(samples, fps, sampleRate, "nearest");
  return { frame, samples: framesToSamples(frame, fps, sampleRate) };
}
