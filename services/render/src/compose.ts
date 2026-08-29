import type { AudioEvent, CaptionEvent, Timeline, VideoEvent } from "@videoai/contracts";
import { LOUDNESS_TARGETS } from "@videoai/contracts";
import { framesToDisplaySeconds, type Rational } from "@videoai/timeline";
import { ffmpeg } from "./ffmpeg.js";

/**
 * Final composition (spec sections 40, 41).
 *
 * The timeline is authoritative. This module translates its integer frame and
 * sample positions into an ffmpeg filter graph, and does not make timing
 * decisions of its own: if two clips disagree about where they sit, that is a
 * timeline bug to fix upstream, not something to paper over here.
 */

export interface ComposeInput {
  timeline: Timeline;
  /** Resolved local paths for every asset the timeline references. */
  assetPaths: Record<string, string>;
  outputPath: string;
  width: number;
  height: number;
  captionsPath?: string;
  burnCaptions?: boolean;
  captionSafeAreaFraction?: number;
}

export async function compose(input: ComposeInput): Promise<void> {
  const { timeline } = input;
  const fps = timeline.timebase.frame_rate;
  const sampleRate = timeline.timebase.audio_sample_rate;

  const videoEvents = sorted(timeline.events.filter(isVideo), (e) => e.start_frame);
  const audioEvents = sorted(timeline.events.filter(isAudio), (e) => e.start_sample);
  if (videoEvents.length === 0) throw new Error("Nothing to render: the timeline has no video");

  const inputs: string[] = [];
  const filters: string[] = [];
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];

  videoEvents.forEach((event, index) => {
    const path = resolve(input.assetPaths, event.asset.asset_id);
    inputs.push("-i", path);
    const start = framesToDisplaySeconds(event.source_start_frame, fps);
    const duration = framesToDisplaySeconds(event.end_frame - event.start_frame, fps);
    const label = `v${index}`;
    // Scale then pad so a source of a different aspect is letterboxed rather
    // than stretched, and force a constant frame rate onto the project timebase.
    filters.push(
      `[${index}:v]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS,` +
        `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,` +
        `pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2,` +
        `fps=${fps.num}/${fps.den},format=yuv420p[${label}]`,
    );
    videoLabels.push(label);
  });

  const videoOffset = videoEvents.length;

  audioEvents.forEach((event, i) => {
    const index = videoOffset + i;
    inputs.push("-i", resolve(input.assetPaths, event.asset.asset_id));
    const label = `a${i}`;
    const startMs = Math.round((event.start_sample * 1000) / sampleRate);
    const parts = [
      `atrim=start_sample=${event.source_start_sample}`,
      "asetpts=PTS-STARTPTS",
      `aresample=${sampleRate}`,
      // Delay in milliseconds is the finest granularity adelay offers; the
      // sample positions themselves stay canonical on the timeline.
      `adelay=${startMs}|${startMs}`,
      `volume=${dbToLinear(event.gain_db).toFixed(6)}`,
    ];
    if (event.fade_in_samples > 0) {
      parts.push(`afade=t=in:st=0:d=${(event.fade_in_samples / sampleRate).toFixed(6)}`);
    }
    if (event.fade_out_samples > 0) {
      const length = (event.end_sample - event.start_sample) / sampleRate;
      const fade = event.fade_out_samples / sampleRate;
      parts.push(`afade=t=out:st=${(length - fade).toFixed(6)}:d=${fade.toFixed(6)}`);
    }
    filters.push(`[${index}:a]${parts.join(",")}[${label}]`);
    audioLabels.push(label);
  });

  filters.push(`${videoLabels.map((l) => `[${l}]`).join("")}concat=n=${videoLabels.length}:v=1:a=0[vcat]`);

  let videoOut = "vcat";
  if (input.burnCaptions && input.captionsPath) {
    const margin = Math.round(input.height * (input.captionSafeAreaFraction ?? 0.12));
    // The path is quoted and escaped because it lands inside a filter string,
    // which is the one place ffmpeg parses its own syntax.
    filters.push(
      `[vcat]subtitles=${escapeFilterPath(input.captionsPath)}:` +
        `force_style='Alignment=2,MarginV=${margin}'[vout]`,
    );
    videoOut = "vout";
  }

  const target = LOUDNESS_TARGETS[
    input.timeline.loudness_profile === "custom" ? "social" : input.timeline.loudness_profile
  ];

  if (audioLabels.length > 0) {
    filters.push(
      `${audioLabels.map((l) => `[${l}]`).join("")}amix=inputs=${audioLabels.length}:` +
        `duration=longest:dropout_transition=0:normalize=0[amix]`,
    );
    // Loudness is normalised per delivery profile rather than to one hardcoded
    // level (spec section 20).
    filters.push(
      `[amix]loudnorm=I=${target.integrated_lufs}:TP=${target.true_peak_dbtp}:LRA=${target.lra}[aout]`,
    );
  }

  const args = [
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", `[${videoOut}]`,
    ...(audioLabels.length > 0 ? ["-map", "[aout]"] : []),
    "-r", `${fps.num}/${fps.den}`,
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    // faststart moves the index to the front so the file plays before it has
    // fully downloaded, which matters for every social target.
    "-movflags", "+faststart",
    ...(audioLabels.length > 0 ? ["-c:a", "aac", "-b:a", "192k", "-ar", String(sampleRate)] : []),
    input.outputPath,
  ];

  await ffmpeg(args);
}

function isVideo(e: Timeline["events"][number]): e is VideoEvent {
  return e.kind === "video";
}
function isAudio(e: Timeline["events"][number]): e is AudioEvent {
  return e.kind === "audio";
}
export function isCaption(e: Timeline["events"][number]): e is CaptionEvent {
  return e.kind === "caption";
}

function sorted<T>(items: T[], key: (item: T) => number): T[] {
  return [...items].sort((a, b) => key(a) - key(b));
}

function resolve(paths: Record<string, string>, assetId: string): string {
  const path = paths[assetId];
  if (!path) throw new Error(`Timeline references asset ${assetId} but no file was provided for it`);
  return path;
}

function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

/** ffmpeg filter syntax treats these as structure, so they must be escaped. */
function escapeFilterPath(path: string): string {
  return `'${path.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:")}'`;
}

/** Export presets (spec section 41). */
export const EXPORT_PRESETS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "21:9": { width: 2560, height: 1080 },
};

export function presetFor(aspect: string, fps: Rational): { width: number; height: number; fps: Rational } {
  const preset = EXPORT_PRESETS[aspect];
  if (!preset) throw new Error(`No export preset for aspect ratio ${aspect}`);
  return { ...preset, fps };
}
