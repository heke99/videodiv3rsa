import { ffmpeg, ffmpegStdout, ffprobe } from "@videoai/render";

/**
 * Measured signals (spec section 32).
 *
 * These are computed from the file, not judged by a model. That matters for
 * two reasons: they are available now, without a GPU, and they are certain.
 * Where a measured metric disagrees with a model's opinion, the measurement is
 * right.
 */

export interface FrameSeries {
  /** Mean luma per frame. */
  luma: number[];
  /** High-frequency energy per frame, a proxy for texture and sharpness. */
  detail: number[];
}

/**
 * Per-frame statistics in one decode pass.
 *
 * signalstats reports YAVG and YDIF per frame; the first gives brightness, the
 * second gives how much changed since the previous frame, which is the basis
 * of every temporal metric below.
 */
export async function frameStatistics(path: string): Promise<{ luma: number[]; diff: number[] }> {
  const stdout = await ffmpegStdout(
    ["-i", path, "-vf", "signalstats,metadata=mode=print:file=-", "-an", "-f", "null", "-"],
    10 * 60_000,
  );

  const luma: number[] = [];
  const diff: number[] = [];
  for (const line of stdout.split("\n")) {
    const yavg = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    if (yavg) luma.push(Number(yavg[1]));
    const ydif = /lavfi\.signalstats\.YDIF=([\d.]+)/.exec(line);
    if (ydif) diff.push(Number(ydif[1]));
  }
  return { luma, diff };
}

/**
 * Flicker: rapid oscillation in brightness with no motion to explain it.
 *
 * Measured as the proportion of frames where the luma change reverses sign
 * relative to the previous change. Real lighting changes are monotonic over
 * several frames; flicker alternates.
 */
export function flickerScore(luma: number[]): { score: number; oscillation_ratio: number } {
  if (luma.length < 4) return { score: 1, oscillation_ratio: 0 };

  const deltas: number[] = [];
  for (let i = 1; i < luma.length; i++) deltas.push(luma[i]! - luma[i - 1]!);

  // Only count reversals that are large enough to be visible; sensor noise
  // reverses constantly and means nothing.
  const magnitude = deltas.reduce((sum, d) => sum + Math.abs(d), 0) / deltas.length;
  const threshold = Math.max(magnitude * 0.5, 0.5);

  let reversals = 0;
  let counted = 0;
  for (let i = 1; i < deltas.length; i++) {
    const a = deltas[i - 1]!;
    const b = deltas[i]!;
    if (Math.abs(a) < threshold || Math.abs(b) < threshold) continue;
    counted += 1;
    if (Math.sign(a) !== Math.sign(b)) reversals += 1;
  }

  const ratio = counted === 0 ? 0 : reversals / counted;
  // A perfectly alternating series has ratio 1; smooth content approaches 0.
  return { score: clamp(1 - ratio), oscillation_ratio: ratio };
}

/**
 * Temporal consistency, normalised by how much the shot is actually moving.
 *
 * A fast pan legitimately produces large frame differences. Comparing raw
 * difference against a fixed threshold flags every moving shot, so what
 * matters is the variability of the difference rather than its level.
 */
export function temporalConsistency(diff: number[]): { score: number; spikes: number[] } {
  if (diff.length < 4) return { score: 1, spikes: [] };

  // Median and median absolute deviation rather than mean and standard
  // deviation: a single large discontinuity inflates the standard deviation
  // enough to hide itself, which is exactly the case this needs to catch.
  const middle = median(diff);
  const absoluteDeviations = diff.map((d) => Math.abs(d - middle));
  const mad = median(absoluteDeviations);

  // 1.4826 scales MAD to be comparable with a standard deviation on normal
  // data, so the multiplier below means what it usually means.
  const scale = mad * 1.4826;
  if (scale === 0) {
    // Perfectly uniform differences: anything that differs at all is a spike.
    const spikes = diff
      .map((value, index) => (value !== middle ? index + 1 : -1))
      .filter((i) => i > 0);
    return { score: spikes.length === 0 ? 1 : clamp(1 - spikes.length / diff.length), spikes };
  }

  const spikes: number[] = [];
  for (const [index, value] of diff.entries()) {
    if (value > middle + 4 * scale) spikes.push(index + 1);
  }

  const variability = scale / (middle + scale);
  return { score: clamp(1 - spikes.length / diff.length - variability * 0.2), spikes };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Motion magnitude, from ffmpeg's own motion estimate. */
export async function motionMagnitude(path: string): Promise<number> {
  const stdout = await ffmpegStdout(
    ["-i", path, "-vf", "vmafmotion,metadata=mode=print:file=-", "-an", "-f", "null", "-"],
    10 * 60_000,
  );
  const values = [...stdout.matchAll(/lavfi\.vmafmotion\.score=([\d.]+)/g)].map((m) => Number(m[1]));
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  // vmafmotion is unbounded in principle. Measured against real material a
  // held frame is 0, ordinary movement sits around 2 to 5, and fast motion
  // reaches 10 and above, so 10 is the useful normalisation point.
  return clamp(mean / 10);
}

/** Frozen segments, which are valid media and a broken generation. */
export async function freezeRatio(path: string, durationSeconds: number): Promise<number> {
  if (durationSeconds <= 0) return 0;
  const stderr = await ffmpeg(
    ["-i", path, "-vf", "freezedetect=n=-60dB:d=0.3", "-an", "-f", "null", "-"],
    10 * 60_000,
  );
  const frozen = [...stderr.matchAll(/freeze_duration:\s*([\d.]+)/g)].reduce(
    (sum, m) => sum + Number(m[1]),
    0,
  );
  return clamp(frozen / durationSeconds);
}

/**
 * Structural similarity between two renders of the same shot.
 *
 * This is what makes the upscale rule enforceable (spec section 38): an
 * upscale that changed the content rather than the resolution shows up as low
 * SSIM against its source.
 */
export async function structuralSimilarity(
  reference: string,
  distorted: string,
): Promise<{ ssim: number; psnr: number } | null> {
  try {
    // The two inputs are frequently different resolutions -- comparing a shot
    // against its upscale is the main use -- so the reference is scaled to
    // match before comparison. Per-frame stats go to stdout; this build prints
    // no summary line, so the mean is computed here.
    const stdout = await ffmpegStdout(
      [
        "-i", distorted, "-i", reference,
        "-lavfi",
        "[0:v]settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[d];" +
          "[1:v]settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[r];" +
          "[r][d]scale2ref[rs][ds];[ds][rs]ssim=stats_file=-",
        "-f", "null", "-",
      ],
      10 * 60_000,
    );

    const values = [...stdout.matchAll(/All:([\d.]+)/g)].map((m) => Number(m[1]));
    if (values.length === 0) return null;
    const ssim = values.reduce((a, b) => a + b, 0) / values.length;

    // SSIM of 1 means identical; convert to a rough PSNR for reporting.
    const psnr = ssim >= 1 ? 100 : -10 * Math.log10(Math.max(1 - ssim, 1e-10));
    return { ssim, psnr };
  } catch {
    return null;
  }
}

/** Integrated loudness, true peak and range, from ffmpeg's EBU R128 scanner. */
export async function loudness(
  path: string,
): Promise<{ integrated_lufs: number; true_peak_dbtp: number; lra: number } | null> {
  try {
    const stderr = await ffmpeg(["-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], 5 * 60_000);
    const integrated = lastMatch(stderr, /I:\s*(-?[\d.]+)\s*LUFS/g);
    const peak = lastMatch(stderr, /Peak:\s*(-?[\d.]+)\s*dBFS/g);
    const lra = lastMatch(stderr, /LRA:\s*(-?[\d.]+)\s*LU/g);
    if (integrated === null) return null;
    return { integrated_lufs: integrated, true_peak_dbtp: peak ?? -99, lra: lra ?? 0 };
  } catch {
    return null;
  }
}

/** Where audible sound actually starts, for comparing against the timeline. */
export async function firstSoundSample(path: string, sampleRate: number): Promise<number | null> {
  try {
    const stderr = await ffmpeg(
      ["-i", path, "-af", "silencedetect=noise=-45dB:d=0.05", "-vn", "-f", "null", "-"],
      5 * 60_000,
    );
    const end = /silence_end:\s*([\d.]+)/.exec(stderr);
    if (!end) return 0;
    return Math.round(Number(end[1]) * sampleRate);
  } catch {
    return null;
  }
}

/** Duration in seconds, needed to normalise the ratio metrics. */
export async function durationSeconds(path: string): Promise<number> {
  try {
    const out = await ffprobe([
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=nokey=1:noprint_wrappers=1", path,
    ]);
    const value = Number(out.trim());
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function lastMatch(text: string, pattern: RegExp): number | null {
  const values = [...text.matchAll(pattern)].map((m) => Number(m[1]));
  return values.length > 0 ? values[values.length - 1]! : null;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
