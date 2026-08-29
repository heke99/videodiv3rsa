import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Thin wrapper over ffmpeg and ffprobe.
 *
 * Arguments are always passed as a list, never as a shell string, so nothing
 * derived from a prompt, a filename or a caption can be interpreted as shell
 * syntax.
 */

export const FFMPEG = process.env["FFMPEG_PATH"] ?? "ffmpeg";
export const FFPROBE = process.env["FFPROBE_PATH"] ?? "ffprobe";

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    // ffmpeg's stderr is long and mostly banner; the tail carries the reason.
    super(`${message}\n${stderr.split("\n").slice(-12).join("\n")}`);
    this.name = "FfmpegError";
  }
}

export async function ffmpeg(args: string[], timeoutMs = 30 * 60_000): Promise<string> {
  try {
    const { stderr } = await exec(FFMPEG, ["-hide_banner", "-nostdin", "-y", ...args], {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stderr;
  } catch (error) {
    throw new FfmpegError("ffmpeg failed", String((error as { stderr?: string }).stderr ?? error));
  }
}

/**
 * Run ffmpeg and return stdout.
 *
 * The metadata and stats_file filters write to stdout rather than stderr,
 * which is where every per-frame measurement comes from. Reading the wrong
 * stream returns an empty series and every metric silently comes out as zero.
 */
export async function ffmpegStdout(args: string[], timeoutMs = 30 * 60_000): Promise<string> {
  try {
    const { stdout } = await exec(FFMPEG, ["-hide_banner", "-nostdin", "-y", ...args], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new FfmpegError("ffmpeg failed", String((error as { stderr?: string }).stderr ?? error));
  }
}

export async function ffprobe(args: string[]): Promise<string> {
  try {
    const { stdout } = await exec(FFPROBE, ["-hide_banner", ...args], {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new FfmpegError("ffprobe failed", String((error as { stderr?: string }).stderr ?? error));
  }
}

export interface ProbeResult {
  container_ok: boolean;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  frame_rate_num: number | null;
  frame_rate_den: number | null;
  frame_count: number | null;
  pixel_format: string | null;
  video_codec: string | null;
  audio_codec: string | null;
  audio_sample_rate: number | null;
  audio_channels: number | null;
  bit_rate: number | null;
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  sample_rate?: string;
  channels?: number;
}

/** Read a file's real properties. Everything downstream trusts this, not the plan. */
export async function probe(path: string): Promise<ProbeResult> {
  let parsed: { streams?: RawStream[]; format?: { duration?: string; bit_rate?: string } };
  try {
    parsed = JSON.parse(await ffprobe(["-v", "error", "-show_streams", "-show_format", "-of", "json", path]));
  } catch {
    return emptyProbe();
  }

  const video = parsed.streams?.find((s) => s.codec_type === "video");
  const audio = parsed.streams?.find((s) => s.codec_type === "audio");
  // r_frame_rate is the container's declared rate and stays rational, which is
  // what we need; avg_frame_rate is a measured average and drifts.
  const rate = parseRational(video?.r_frame_rate ?? video?.avg_frame_rate);

  return {
    container_ok: true,
    duration_seconds: parsed.format?.duration ? Number(parsed.format.duration) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    frame_rate_num: rate?.num ?? null,
    frame_rate_den: rate?.den ?? null,
    frame_count: video?.nb_frames ? Number(video.nb_frames) : null,
    pixel_format: video?.pix_fmt ?? null,
    video_codec: video?.codec_name ?? null,
    audio_codec: audio?.codec_name ?? null,
    audio_sample_rate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    audio_channels: audio?.channels ?? null,
    bit_rate: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : null,
  };
}

function emptyProbe(): ProbeResult {
  return {
    container_ok: false,
    duration_seconds: null,
    width: null,
    height: null,
    frame_rate_num: null,
    frame_rate_den: null,
    frame_count: null,
    pixel_format: null,
    video_codec: null,
    audio_codec: null,
    audio_sample_rate: null,
    audio_channels: null,
    bit_rate: null,
  };
}

export function parseRational(value: string | undefined): { num: number; den: number } | null {
  if (!value) return null;
  const [num, den] = value.split("/").map(Number);
  if (!num || !den || !Number.isFinite(num) || !Number.isFinite(den)) return null;
  return { num, den };
}

/**
 * Count frames by decoding rather than trusting the container header, which is
 * frequently wrong or absent for generated output.
 */
export async function countFrames(path: string): Promise<number | null> {
  try {
    const out = await ffprobe([
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_frames",
      "-show_entries",
      "stream=nb_read_frames",
      "-of",
      "default=nokey=1:noprint_wrappers=1",
      path,
    ]);
    const n = Number(out.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
