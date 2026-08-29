import type { CaptionEvent } from "@videoai/contracts";

/**
 * Caption serialisation.
 *
 * Captions carry sample positions because they come from the final dialogue
 * alignment (spec section 21). Converting to wall-clock text happens only here,
 * at the point of writing a subtitle file, so the timing that ships is the
 * timing that was measured.
 */

export function toSrt(events: CaptionEvent[], sampleRate: number): string {
  return [...events]
    .sort((a, b) => a.start_sample - b.start_sample)
    .map((event, index) =>
      [
        String(index + 1),
        `${srtTime(event.start_sample, sampleRate)} --> ${srtTime(event.end_sample, sampleRate)}`,
        event.text,
        "",
      ].join("\n"),
    )
    .join("\n");
}

export function toWebVtt(events: CaptionEvent[], sampleRate: number): string {
  const cues = [...events]
    .sort((a, b) => a.start_sample - b.start_sample)
    .map((event) =>
      [
        `${vttTime(event.start_sample, sampleRate)} --> ${vttTime(event.end_sample, sampleRate)}`,
        event.text,
        "",
      ].join("\n"),
    );
  return ["WEBVTT", "", ...cues].join("\n");
}

/**
 * Samples to hh:mm:ss,mmm. Milliseconds are computed from the sample index by
 * integer division so a cue never lands a millisecond early through float
 * rounding.
 */
function components(samples: number, sampleRate: number) {
  const totalMs = Math.round((samples * 1000) / sampleRate);
  return {
    hours: Math.floor(totalMs / 3_600_000),
    minutes: Math.floor(totalMs / 60_000) % 60,
    seconds: Math.floor(totalMs / 1000) % 60,
    ms: totalMs % 1000,
  };
}

function srtTime(samples: number, sampleRate: number): string {
  const { hours, minutes, seconds, ms } = components(samples, sampleRate);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(ms, 3)}`;
}

function vttTime(samples: number, sampleRate: number): string {
  const { hours, minutes, seconds, ms } = components(samples, sampleRate);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms, 3)}`;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * Safe areas for burned-in captions, as a fraction of height from the bottom.
 * Platform chrome covers the lower part of the frame, so a caption placed
 * naively is legible in preview and hidden in the app.
 */
export const CAPTION_SAFE_AREA: Record<string, number> = {
  tiktok: 0.22,
  reels: 0.2,
  shorts: 0.18,
  youtube: 0.1,
  web: 0.08,
  broadcast: 0.1,
  other: 0.12,
};
