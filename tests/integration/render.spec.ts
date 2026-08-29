import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Timeline } from "@videoai/contracts";
import { compose, ffmpeg, probe, runTechnicalQc, toSrt, toWebVtt } from "@videoai/render";

/**
 * Real ffmpeg, real files. Technical QC exists to catch broken output, so the
 * fixtures here are deliberately broken in the specific ways generation fails:
 * a black shot, a frozen shot, a silent track, a truncated file.
 */

let dir: string;

const FPS = { num: 24, den: 1 };
const SAMPLE_RATE = 48_000;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "videoai-render-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * A 2 second clip with real motion at the project timebase. Flat colour is not
 * a valid stand-in for a healthy shot: technical QC correctly reads a static
 * frame as frozen, so the fixtures for the passing cases have to move.
 */
async function makeClip(name: string, seconds = 2): Promise<string> {
  const out = path.join(dir, name);
  await ffmpeg([
    "-f", "lavfi",
    "-i", `testsrc2=s=640x360:r=24:d=${seconds}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", out,
  ]);
  return out;
}

/** A static clip, which is what a frozen or black generation looks like. */
async function makeStaticClip(name: string, color: string, seconds = 2): Promise<string> {
  const out = path.join(dir, name);
  await ffmpeg([
    "-f", "lavfi",
    "-i", `color=c=${color}:s=640x360:r=24:d=${seconds}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", out,
  ]);
  return out;
}

async function makeTone(name: string, seconds = 2, frequency = 440): Promise<string> {
  const out = path.join(dir, name);
  await ffmpeg([
    "-f", "lavfi",
    "-i", `sine=frequency=${frequency}:sample_rate=${SAMPLE_RATE}:duration=${seconds}`,
    "-c:a", "aac", out,
  ]);
  return out;
}

describe("technical QC", () => {
  it("passes a well formed clip", async () => {
    const clip = await makeClip("good.mp4");
    const report = await runTechnicalQc(clip, {
      asset_id: "asset-1",
      expected_frames: 48,
      expected_fps: FPS,
      expected_width: 640,
      expected_height: 360,
    });
    expect(report.findings.map((f) => f.code)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.frame_count).toBe(48);
  });

  it("reports a file that does not exist rather than throwing", async () => {
    const report = await runTechnicalQc(path.join(dir, "absent.mp4"), { asset_id: "asset-2" });
    expect(report.exists).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.findings[0]!.code).toBe("unreadable_output");
  });

  it("catches a clip that is shorter than the shot called for", async () => {
    const clip = await makeClip("short.mp4", 1);
    const report = await runTechnicalQc(clip, { asset_id: "asset-3", expected_frames: 48 });
    expect(report.findings.map((f) => f.code)).toContain("frame_count_mismatch");
    expect(report.passed).toBe(false);
  });

  it("catches a black shot", async () => {
    const clip = await makeStaticClip("black.mp4", "black");
    const report = await runTechnicalQc(clip, { asset_id: "asset-4", expected_frames: 48 });
    expect(report.findings.map((f) => f.code)).toContain("black_frames");
    expect(report.black_frame_ratio).toBeGreaterThan(0.5);
  });

  it("catches a frozen shot, which is valid media but a broken generation", async () => {
    const clip = await makeStaticClip("frozen.mp4", "green");
    const report = await runTechnicalQc(clip, { asset_id: "asset-5", expected_frames: 48 });
    // Every frame after the first repeats, which is what a stalled generation
    // produces: a technically valid file with nothing happening in it.
    expect(report.duplicate_frame_ratio).toBeGreaterThan(0.5);
    expect(report.findings.map((f) => f.code)).toContain("duplicate_frames");
  });

  it("catches a missing audio stream when the shot should have one", async () => {
    const clip = await makeClip("mute.mp4");
    const report = await runTechnicalQc(clip, { asset_id: "asset-6", expects_audio: true });
    expect(report.findings.map((f) => f.code)).toContain("missing_audio_stream");
    expect(report.passed).toBe(false);
  });

  it("catches a frame rate that does not match the project timebase", async () => {
    const out = path.join(dir, "wrongfps.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=2",
                  "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
    const report = await runTechnicalQc(out, { asset_id: "asset-7", expected_fps: FPS });
    expect(report.findings.map((f) => f.code)).toContain("frame_rate_mismatch");
  });

  it("treats 24000/1001 as 23.976 rather than a mismatch", async () => {
    const out = path.join(dir, "ntsc.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=24000/1001:d=2",
                  "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
    const report = await runTechnicalQc(out, {
      asset_id: "asset-8",
      expected_fps: { num: 24000, den: 1001 },
    });
    expect(report.findings.map((f) => f.code)).not.toContain("frame_rate_mismatch");
  });
});

describe("composition", () => {
  it("renders a two shot timeline with dialogue onto the project timebase", async () => {
    const shotA = await makeClip("shot-a.mp4");
    const shotB = await makeClip("shot-b.mp4");
    const dialogue = await makeTone("dialogue.m4a", 3);
    const out = path.join(dir, "final.mp4");

    const timeline: Timeline = {
      schema_version: "1.0",
      project_id: "00000000-0000-4000-8000-000000000001",
      timebase: { frame_rate: FPS, audio_sample_rate: SAMPLE_RATE },
      duration_frames: 96,
      loudness_profile: "social",
      tracks: [
        { id: "video", kind: "VIDEO", index: 0, muted: false },
        { id: "dialogue", kind: "DIALOGUE", index: 1, muted: false },
      ],
      events: [
        {
          id: "ev_a", track_id: "video", kind: "video",
          asset: { asset_id: "a" }, shot_id: "shot_01", scene_id: "scene_01",
          start_frame: 0, end_frame: 48, source_start_frame: 0,
        },
        {
          id: "ev_b", track_id: "video", kind: "video",
          asset: { asset_id: "b" }, shot_id: "shot_02", scene_id: "scene_01",
          start_frame: 48, end_frame: 96, source_start_frame: 0,
        },
        {
          id: "ev_d", track_id: "dialogue", kind: "audio",
          asset: { asset_id: "d" }, shot_id: null, scene_id: null,
          start_sample: 0, end_sample: 144_000, source_start_sample: 0,
          gain_db: 0, fade_in_samples: 0, fade_out_samples: 4800, pan: 0,
          ducking_group: "dialogue",
        },
      ],
    };

    await compose({
      timeline,
      assetPaths: { a: shotA, b: shotB, d: dialogue },
      outputPath: out,
      width: 1080,
      height: 1920,
    });

    const info = await probe(out);
    expect(info.container_ok).toBe(true);
    expect(info.width).toBe(1080);
    expect(info.height).toBe(1920);
    expect(info.frame_rate_num! / info.frame_rate_den!).toBeCloseTo(24, 3);
    expect(info.audio_codec).toBe("aac");

    // The render must match the timeline's own duration, not approximately.
    const report = await runTechnicalQc(out, {
      asset_id: "final",
      expected_frames: 96,
      expected_fps: FPS,
      expected_width: 1080,
      expected_height: 1920,
      expects_audio: true,
      expected_sample_rate: SAMPLE_RATE,
    });
    expect(report.findings.map((f) => f.code)).toEqual([]);
    expect(report.passed).toBe(true);
  }, 120_000);

  it("refuses to render a timeline with no video rather than emitting an empty file", async () => {
    await expect(
      compose({
        timeline: {
          schema_version: "1.0",
          project_id: "00000000-0000-4000-8000-000000000001",
          timebase: { frame_rate: FPS, audio_sample_rate: SAMPLE_RATE },
          duration_frames: 48,
          loudness_profile: "social",
          tracks: [{ id: "video", kind: "VIDEO", index: 0, muted: false }],
          events: [],
        },
        assetPaths: {},
        outputPath: path.join(dir, "empty.mp4"),
        width: 1080,
        height: 1920,
      }),
    ).rejects.toThrow(/no video/);
  });

  it("burns captions inside the platform safe area", async () => {
    const shot = await makeClip("captioned-source.mp4", 2);
    const srtPath = path.join(dir, "captions.srt");
    await writeFile(
      srtPath,
      toSrt(
        [{
          id: "c1", track_id: "captions", kind: "caption",
          text: "this is the hook", start_sample: 0, end_sample: 48_000, speaker_id: null,
        }],
        SAMPLE_RATE,
      ),
    );
    const out = path.join(dir, "captioned.mp4");

    await compose({
      timeline: {
        schema_version: "1.0",
        project_id: "00000000-0000-4000-8000-000000000001",
        timebase: { frame_rate: FPS, audio_sample_rate: SAMPLE_RATE },
        duration_frames: 48,
        loudness_profile: "social",
        tracks: [{ id: "video", kind: "VIDEO", index: 0, muted: false }],
        events: [{
          id: "ev_a", track_id: "video", kind: "video",
          asset: { asset_id: "a" }, shot_id: null, scene_id: null,
          start_frame: 0, end_frame: 48, source_start_frame: 0,
        }],
      },
      assetPaths: { a: shot },
      outputPath: out,
      width: 1080,
      height: 1920,
      captionsPath: srtPath,
      burnCaptions: true,
      captionSafeAreaFraction: 0.22,
    });

    expect((await probe(out)).container_ok).toBe(true);
  }, 120_000);
});

describe("caption serialisation", () => {
  const events = [{
    id: "c1", track_id: "captions", kind: "caption" as const,
    text: "hello there", start_sample: 48_000, end_sample: 96_000, speaker_id: null,
  }];

  it("writes SRT timing derived from sample positions", () => {
    expect(toSrt(events, SAMPLE_RATE)).toContain("00:00:01,000 --> 00:00:02,000");
  });

  it("writes WebVTT timing derived from sample positions", () => {
    const vtt = toWebVtt(events, SAMPLE_RATE);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:02.000");
  });

  it("keeps sub-millisecond sample positions from rounding a cue early", () => {
    const odd = [{ ...events[0]!, start_sample: 48_001, end_sample: 96_047 }];
    expect(toSrt(odd, SAMPLE_RATE)).toContain("00:00:01,000 --> 00:00:02,001");
  });
});
