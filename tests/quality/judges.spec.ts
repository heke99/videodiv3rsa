import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ffmpeg } from "@videoai/render";
import {
  audioQualityJudge,
  avSyncJudge,
  evaluate,
  flickerJudge,
  measuredJudges,
  modelJudges,
  motionJudge,
  safeAreaJudge,
  upscaleJudge,
} from "@videoai/quality";

/**
 * Judges against deliberately degraded material.
 *
 * Each fixture is broken in one specific way, and each test asserts both that
 * the right judge catches it and that the others do not. A judge that fires on
 * everything is as useless as one that fires on nothing, and only fixtures
 * make that visible.
 */

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "videoai-judges-"));
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Healthy footage: real motion, steady exposure. */
async function goodClip(name: string, seconds = 3): Promise<string> {
  const out = path.join(dir, name);
  await ffmpeg(["-f", "lavfi", "-i", `testsrc2=s=320x240:r=24:d=${seconds}`,
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", out]);
  return out;
}

/** Brightness oscillating frame to frame with nothing in the scene to explain it. */
async function flickeringClip(name: string, seconds = 3): Promise<string> {
  const out = path.join(dir, name);
  await ffmpeg([
    "-f", "lavfi", "-i", `testsrc2=s=320x240:r=24:d=${seconds}`,
    // Alternate exposure every frame using the frame number.
    "-vf", "geq=lum='lum(X,Y)*(1.0+0.5*mod(N,2))':cb='cb(X,Y)':cr='cr(X,Y)'",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", out,
  ]);
  return out;
}

/** A held frame: technically valid, and a broken generation. */
async function frozenClip(name: string, seconds = 3): Promise<string> {
  const out = path.join(dir, name);
  await ffmpeg(["-f", "lavfi", "-i", `color=c=0x3a6ea5:s=320x240:r=24:d=${seconds}`,
                "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
  return out;
}

async function toneWithVideo(name: string, opts: {
  seconds?: number; volume?: number; delaySeconds?: number;
} = {}): Promise<string> {
  const { seconds = 3, volume = 0.25, delaySeconds = 0 } = opts;
  const out = path.join(dir, name);
  const filter = delaySeconds > 0
    ? `volume=${volume},adelay=${Math.round(delaySeconds * 1000)}|${Math.round(delaySeconds * 1000)}`
    : `volume=${volume}`;
  await ffmpeg([
    "-f", "lavfi", "-i", `testsrc2=s=320x240:r=24:d=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    "-af", filter,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
  ]);
  return out;
}

describe("flicker judge", () => {
  it("passes healthy footage", async () => {
    const result = await flickerJudge.run({ asset_path: await goodClip("flicker-good.mp4") });
    expect(result.findings.map((f) => f.code)).toEqual([]);
    expect(result.status).toBe("pass");
  }, 120_000);

  it("catches oscillating brightness", async () => {
    const result = await flickerJudge.run({ asset_path: await flickeringClip("flicker-bad.mp4") });
    expect(result.findings.map((f) => f.code)).toContain("flicker");
    expect(result.score).toBeLessThan(0.5);
  }, 120_000);

  it("does not fire on a frozen shot, which is a different defect", async () => {
    const result = await flickerJudge.run({ asset_path: await frozenClip("flicker-frozen.mp4") });
    expect(result.findings.map((f) => f.code)).not.toContain("flicker");
  }, 120_000);
});

describe("motion judge", () => {
  it("passes a moving shot that was planned to move", async () => {
    const result = await motionJudge.run({
      asset_path: await goodClip("motion-good.mp4"),
      planned_motion_complexity: 0.6,
    });
    expect(result.findings.map((f) => f.code)).not.toContain("insufficient_motion");
  }, 120_000);

  it("catches a shot that was planned to move and did not", async () => {
    const result = await motionJudge.run({
      asset_path: await frozenClip("motion-frozen.mp4"),
      planned_motion_complexity: 0.8,
    });
    const codes = result.findings.map((f) => f.code);
    expect(codes.some((c) => c === "insufficient_motion" || c === "frozen_segment")).toBe(true);
    expect(result.status).toBe("fail");
  }, 120_000);

  it("does not demand motion from a shot planned to be still", async () => {
    const result = await motionJudge.run({
      asset_path: await frozenClip("motion-still.mp4"),
      planned_motion_complexity: 0.1,
    });
    expect(result.findings.map((f) => f.code)).not.toContain("insufficient_motion");
  }, 120_000);
});

describe("audio quality judge", () => {
  it("catches audio far below its loudness target", async () => {
    const quiet = await toneWithVideo("audio-quiet.mp4", { volume: 0.002 });
    const result = await audioQualityJudge.run({
      asset_path: quiet, loudness_profile: "social", expects_audio: true,
    });
    expect(result.findings.map((f) => f.code)).toContain("loudness_off_target");
  }, 120_000);

  it("catches a missing audio stream when audio was expected", async () => {
    const result = await audioQualityJudge.run({
      asset_path: await goodClip("audio-none.mp4"), expects_audio: true,
    });
    expect(result.findings.map((f) => f.code)).toContain("no_audio");
    expect(result.status).toBe("fail");
  }, 120_000);

  it("does not complain about missing audio when none was expected", async () => {
    const result = await audioQualityJudge.run({
      asset_path: await goodClip("audio-silent-ok.mp4"), expects_audio: false,
    });
    expect(result.status).toBe("pass");
  }, 120_000);
});

describe("av sync judge", () => {
  it("passes audio that starts where the timeline said", async () => {
    const clip = await toneWithVideo("sync-ok.mp4");
    const result = await avSyncJudge.run({
      asset_path: clip, audio_sample_rate: 48_000, expected_first_sound_sample: 0,
    });
    expect(result.status).toBe("pass");
  }, 120_000);

  it("catches audio that arrives a second late", async () => {
    const clip = await toneWithVideo("sync-late.mp4", { delaySeconds: 1 });
    const result = await avSyncJudge.run({
      asset_path: clip, audio_sample_rate: 48_000, expected_first_sound_sample: 0,
    });
    expect(result.findings.map((f) => f.code)).toContain("av_sync");
  }, 120_000);

  it("scopes a sync fault to timing, because regenerating would not fix it", async () => {
    const clip = await toneWithVideo("sync-scope.mp4", { delaySeconds: 1 });
    const result = await avSyncJudge.run({
      asset_path: clip, audio_sample_rate: 48_000, expected_first_sound_sample: 0,
    });
    expect(result.repair_scope).toBe("timing");
  }, 120_000);
});

describe("safe area judge", () => {
  it("catches a caption behind the platform interface", async () => {
    const result = await safeAreaJudge.run({
      asset_path: await goodClip("safe-1.mp4"), platform: "tiktok", caption_bottom_fraction: 0.05,
    });
    expect(result.findings.map((f) => f.code)).toContain("safe_area_violation");
    expect(result.repair_scope).toBe("caption");
  }, 120_000);

  it("passes a caption above it", async () => {
    const result = await safeAreaJudge.run({
      asset_path: await goodClip("safe-2.mp4"), platform: "tiktok", caption_bottom_fraction: 0.3,
    });
    expect(result.status).toBe("pass");
  }, 120_000);
});

describe("upscale judge", () => {
  it("passes an upscale that only changed resolution", async () => {
    const source = await goodClip("upscale-src.mp4", 2);
    const upscaled = path.join(dir, "upscale-ok.mp4");
    await ffmpeg(["-i", source, "-vf", "scale=640:480:flags=lanczos",
                  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", upscaled]);

    const result = await upscaleJudge.run({ asset_path: upscaled, reference_path: source });
    expect(result.findings.map((f) => f.code)).not.toContain("upscale_changed_content");
  }, 180_000);

  it("catches an upscale that changed the content", async () => {
    const source = await goodClip("upscale-src2.mp4", 2);
    const mangled = path.join(dir, "upscale-bad.mp4");
    // Stand-in for an upscaler that hallucinated: same length, different picture.
    await ffmpeg(["-i", source, "-vf", "scale=640:480,hue=h=180:s=3,boxblur=4:2",
                  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", mangled]);

    const result = await upscaleJudge.run({ asset_path: mangled, reference_path: source });
    expect(result.findings.map((f) => f.code)).toContain("upscale_changed_content");
  }, 180_000);
});

describe("the ensemble on real material", () => {
  it("passes healthy footage across every measured judge", async () => {
    const result = await evaluate(
      measuredJudges,
      { asset_path: await goodClip("ensemble-good.mp4"), planned_motion_complexity: 0.6, expects_audio: false },
      { subject_kind: "shot", subject_id: "shot_01", profile: "STANDARD" },
    );
    expect(result.judges.flatMap((j) => j.findings).map((f) => f.code)).toEqual([]);
    expect(result.passed).toBe(true);
  }, 180_000);

  it("fails flickering footage and says which dimension failed", async () => {
    const result = await evaluate(
      measuredJudges,
      { asset_path: await flickeringClip("ensemble-flicker.mp4"), planned_motion_complexity: 0.6, expects_audio: false },
      { subject_kind: "shot", subject_id: "shot_02", profile: "STANDARD" },
    );
    expect(result.passed).toBe(false);
    expect(result.scores.flicker).toBeLessThan(0.6);
  }, 180_000);

  it("reports the dimensions it could not measure rather than passing them", async () => {
    const result = await evaluate(
      [...measuredJudges, ...modelJudges],
      { asset_path: await goodClip("ensemble-coverage.mp4"), planned_motion_complexity: 0.6, expects_audio: false },
      { subject_kind: "shot", subject_id: "shot_03", profile: "REALISTIC" },
    );

    const unmeasured = result.unmeasured.map((u) => u.dimension);
    expect(unmeasured).toContain("identity");
    expect(unmeasured).toContain("hands");
    // The gap must not appear as a score.
    expect(result.scores.identity).toBeUndefined();
    expect(result.unmeasured[0]!.reason).toContain("GPU");
  }, 180_000);
});
