import type { Finding, TechnicalQcReport } from "@videoai/contracts";
import { framesToSamples, type Rational } from "@videoai/timeline";
import { countFrames, ffmpeg, probe, type ProbeResult } from "./ffmpeg.js";

/**
 * Technical QC (spec section 37).
 *
 * Deliberately model-free: these are measurements, not judgements. A file that
 * fails here is broken in a way no amount of prompt work fixes, so this runs
 * before any judge is asked to spend time on it.
 */

export interface TechnicalQcExpectation {
  asset_id: string;
  expected_frames?: number;
  expected_fps?: Rational;
  expected_width?: number;
  expected_height?: number;
  expects_audio?: boolean;
  expected_sample_rate?: number;
}

/** Ratios above which an anomaly stops being incidental and becomes a defect. */
const THRESHOLDS = {
  black_frames: 0.2,
  silent_audio: 0.9,
  duplicate_frames: 0.3,
  /** One frame of slack for encoder boundary behaviour. */
  frame_count_tolerance: 1,
};

export async function runTechnicalQc(
  path: string,
  expect: TechnicalQcExpectation,
): Promise<TechnicalQcReport> {
  const findings: Finding[] = [];
  const info = await probe(path);

  if (!info.container_ok) {
    return report(expect, info, findings, {
      exists: false,
      frameCount: 0,
      black: 0,
      silent: 0,
      duplicate: 0,
      passed: false,
      extraFinding: {
        code: "unreadable_output",
        severity: "critical",
        message: "The file does not exist or is not a readable media container",
        frames: [],
        entity_ref: null,
      },
    });
  }

  const frameCount = (await countFrames(path)) ?? info.frame_count ?? 0;

  if (expect.expected_frames !== undefined) {
    const drift = Math.abs(frameCount - expect.expected_frames);
    if (drift > THRESHOLDS.frame_count_tolerance) {
      findings.push({
        code: "frame_count_mismatch",
        severity: drift > 2 ? "high" : "medium",
        message: `Expected ${expect.expected_frames} frames, found ${frameCount}`,
        frames: [],
        entity_ref: null,
      });
    }
  }

  if (expect.expected_fps && info.frame_rate_num && info.frame_rate_den) {
    // Compared as a rational so 24000/1001 does not read as 23.98 !== 23.976.
    const same =
      BigInt(info.frame_rate_num) * BigInt(expect.expected_fps.den) ===
      BigInt(expect.expected_fps.num) * BigInt(info.frame_rate_den);
    if (!same) {
      findings.push({
        code: "frame_rate_mismatch",
        severity: "high",
        message:
          `Expected ${expect.expected_fps.num}/${expect.expected_fps.den} fps, ` +
          `found ${info.frame_rate_num}/${info.frame_rate_den}`,
        frames: [],
        entity_ref: null,
      });
    }
  }

  if (expect.expected_width && info.width && info.width !== expect.expected_width) {
    findings.push(dimensionFinding("width", expect.expected_width, info.width));
  }
  if (expect.expected_height && info.height && info.height !== expect.expected_height) {
    findings.push(dimensionFinding("height", expect.expected_height, info.height));
  }

  if (expect.expects_audio && !info.audio_codec) {
    findings.push({
      code: "missing_audio_stream",
      severity: "critical",
      message: "The output should carry audio but has no audio stream",
      frames: [],
      entity_ref: null,
    });
  }
  if (
    expect.expected_sample_rate &&
    info.audio_sample_rate &&
    info.audio_sample_rate !== expect.expected_sample_rate
  ) {
    findings.push({
      code: "sample_rate_mismatch",
      severity: "high",
      message: `Expected ${expect.expected_sample_rate} Hz, found ${info.audio_sample_rate} Hz`,
      frames: [],
      entity_ref: null,
    });
  }

  const anomalies = await detectAnomalies(
    path,
    frameCount,
    info.duration_seconds ?? 0,
    Boolean(info.audio_codec),
  );

  if (anomalies.nanFrames) {
    findings.push({
      code: "nan_frames",
      severity: "critical",
      message: "Decoder reported invalid frame data",
      frames: [],
      entity_ref: null,
    });
  }
  if (anomalies.black > THRESHOLDS.black_frames) {
    findings.push({
      code: "black_frames",
      severity: anomalies.black > 0.8 ? "critical" : "high",
      message: `${Math.round(anomalies.black * 100)}% of the output is black`,
      frames: [],
      entity_ref: null,
    });
  }
  if (expect.expects_audio && anomalies.silent > THRESHOLDS.silent_audio) {
    findings.push({
      code: "silent_audio",
      severity: "high",
      message: `${Math.round(anomalies.silent * 100)}% of the audio is silence`,
      frames: [],
      entity_ref: null,
    });
  }
  if (anomalies.duplicate > THRESHOLDS.duplicate_frames) {
    // A high duplicate ratio means the model produced a near-still, which
    // reads as a broken shot even though the file is technically valid.
    findings.push({
      code: "duplicate_frames",
      severity: "high",
      message: `${Math.round(anomalies.duplicate * 100)}% of frames repeat the previous one`,
      frames: [],
      entity_ref: null,
    });
  }

  return report(expect, info, findings, {
    exists: true,
    frameCount,
    black: anomalies.black,
    silent: anomalies.silent,
    duplicate: anomalies.duplicate,
    nan: anomalies.nanFrames,
    passed: !findings.some((f) => f.severity === "high" || f.severity === "critical"),
  });
}

function dimensionFinding(axis: string, expected: number, actual: number): Finding {
  return {
    code: `${axis}_mismatch`,
    severity: "high",
    message: `Expected ${axis} ${expected}, found ${actual}`,
    frames: [],
    entity_ref: null,
  };
}

interface Anomalies {
  black: number;
  silent: number;
  duplicate: number;
  nanFrames: boolean;
}

/**
 * One decode pass collecting every anomaly signal, because decoding a video
 * several times to ask separate questions is the expensive way to do this.
 *
 * Duration comes from the probe rather than from ffmpeg's progress counter:
 * mpdecimate drops frames, which leaves `time=` at zero and would make every
 * ratio come out as zero.
 */
async function detectAnomalies(
  path: string,
  frameCount: number,
  durationSeconds: number,
  hasAudio: boolean,
): Promise<Anomalies> {
  let stderr = "";
  try {
    // -vsync 0 keeps the reported frame count equal to what survives the
    // filter, which is what makes the duplicate ratio measurable at all.
    stderr = await ffmpeg(
      ["-i", path, "-vf", "blackdetect=d=0.05:pic_th=0.98,mpdecimate", "-an",
       "-vsync", "0", "-f", "null", "-"],
      10 * 60_000,
    );
  } catch {
    // A decode failure is itself the signal; report it as invalid frame data.
    return { black: 0, silent: 0, duplicate: 0, nanFrames: true };
  }

  const blackSeconds = [...stderr.matchAll(/black_duration:\s*([\d.]+)/g)].reduce(
    (sum, m) => sum + Number(m[1]),
    0,
  );
  const black = durationSeconds > 0 ? Math.min(blackSeconds / durationSeconds, 1) : 0;

  // mpdecimate does not report a drop count, so the frames that came out the
  // far side are counted instead: everything missing was a duplicate.
  const survived = lastFrameCount(stderr);
  const duplicate =
    frameCount > 0 && survived !== null
      ? Math.min(Math.max(frameCount - survived, 0) / frameCount, 1)
      : 0;

  const silent = hasAudio ? await silenceRatio(path, durationSeconds) : 0;

  return {
    black,
    silent,
    duplicate,
    nanFrames: /invalid data|corrupt|error while decoding/i.test(stderr),
  };
}

/** The last `frame=N` ffmpeg prints is its final output count. */
function lastFrameCount(stderr: string): number | null {
  const matches = [...stderr.matchAll(/frame=\s*(\d+)/g)];
  const last = matches[matches.length - 1];
  return last ? Number(last[1]) : null;
}

async function silenceRatio(path: string, totalSeconds: number): Promise<number> {
  if (totalSeconds <= 0) return 0;
  try {
    const stderr = await ffmpeg(
      ["-i", path, "-af", "silencedetect=noise=-50dB:d=0.2", "-vn", "-f", "null", "-"],
      5 * 60_000,
    );
    const silence = [...stderr.matchAll(/silence_duration:\s*([\d.]+)/g)].reduce(
      (sum, m) => sum + Number(m[1]),
      0,
    );
    return Math.min(silence / totalSeconds, 1);
  } catch {
    return 0;
  }
}

function report(
  expect: TechnicalQcExpectation,
  info: ProbeResult,
  findings: Finding[],
  state: {
    exists: boolean;
    frameCount: number;
    black: number;
    silent: number;
    duplicate: number;
    nan?: boolean;
    passed: boolean;
    extraFinding?: Finding;
  },
): TechnicalQcReport {
  if (state.extraFinding) findings.push(state.extraFinding);
  return {
    asset_id: expect.asset_id,
    exists: state.exists,
    container_ok: info.container_ok,
    has_nan_frames: state.nan ?? false,
    frame_count: state.frameCount,
    expected_frame_count: expect.expected_frames ?? null,
    fps_num: info.frame_rate_num,
    fps_den: info.frame_rate_den,
    duration_samples:
      info.audio_sample_rate && expect.expected_fps && state.frameCount
        ? framesToSamples(state.frameCount, expect.expected_fps, info.audio_sample_rate)
        : null,
    width: info.width,
    height: info.height,
    pixel_format: info.pixel_format,
    video_codec: info.video_codec,
    audio_codec: info.audio_codec,
    audio_sample_rate: info.audio_sample_rate,
    audio_channels: info.audio_channels,
    black_frame_ratio: state.black,
    silent_audio_ratio: state.silent,
    duplicate_frame_ratio: state.duplicate,
    findings,
    passed: state.passed,
  };
}
