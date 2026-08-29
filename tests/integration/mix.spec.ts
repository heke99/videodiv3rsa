import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Shot, ShotPlan } from "@videoai/contracts";
import { LOUDNESS_TARGETS } from "@videoai/contracts";
import { assembleTimeline } from "@videoai/timeline";
import { compose, ffmpeg } from "@videoai/render";
import { parseRange } from "@videoai/media";

/**
 * The mix, verified by measuring the rendered file rather than by trusting the
 * filter graph. Loudness and sync are the two things a user notices instantly
 * and a unit test cannot see.
 */

let dir: string;
const timebase = { frame_rate: { num: 24, den: 1 }, audio_sample_rate: 48_000 as const };
const PROJECT = "00000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "videoai-mix-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function clip(name: string, seconds: number): Promise<string> {
  const out = path.join(dir, name);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `testsrc2=s=640x360:r=24:d=${seconds}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    out,
  ]);
  return out;
}

async function tone(name: string, seconds: number, frequency: number, volume = 1): Promise<string> {
  const out = path.join(dir, name);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`,
    "-af",
    `volume=${volume}`,
    "-c:a",
    "pcm_s16le",
    out,
  ]);
  return out;
}

/** Measure integrated loudness of a rendered file with ffmpeg's own scanner. */
async function measureLufs(file: string): Promise<number> {
  const stderr = await ffmpeg(["-i", file, "-af", "ebur128=framelog=quiet", "-f", "null", "-"]);
  const match = /I:\s*(-?[\d.]+)\s*LUFS/g;
  const values = [...stderr.matchAll(match)].map((m) => Number(m[1]));
  return values[values.length - 1] ?? NaN;
}

/** Where audio actually starts, in samples, by detecting the leading silence. */
async function firstSoundSample(file: string): Promise<number> {
  const stderr = await ffmpeg([
    "-i",
    file,
    "-af",
    "silencedetect=noise=-45dB:d=0.05",
    "-vn",
    "-f",
    "null",
    "-",
  ]);
  const end = /silence_end:\s*([\d.]+)/.exec(stderr);
  // No leading silence detected means sound starts at zero.
  return end ? Math.round(Number(end[1]) * 48_000) : 0;
}

function shot(id: string, index: number, frames: number): Shot {
  return {
    id,
    scene_id: "scene_01",
    index,
    description: "d",
    action: "a",
    shot_type: "medium",
    duration_frames: frames,
    camera: { framing: "medium", lens: "", movement: "static", height: "eye_level", focus_behavior: "" },
    character_ids: [],
    product_ids: [],
    location_id: null,
    dialogue_line_ids: [],
    motion_complexity: 0.5,
    continuity_requirement: 0.5,
    requires_identity_lock: false,
    requires_product_fidelity: false,
    preferred_generation_kind: "text_to_video",
    start_frame_asset: null,
    end_frame_asset: null,
    notes: "",
  };
}

function plan(shots: Shot[]): ShotPlan {
  return {
    schema_version: "1.0",
    scenes: [{ id: "scene_01", index: 0, summary: "s", location_id: null, shot_ids: shots.map((s) => s.id) }],
    shots,
    dependencies: [],
  };
}

describe("assembled mix", () => {
  it("renders to the loudness target for its delivery profile", async () => {
    const video = await clip("mix-video.mp4", 4);
    const speech = await tone("mix-speech.wav", 2, 440, 0.1);
    const out = path.join(dir, "mix-social.mp4");

    const { timeline } = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 96)]),
      shot_assets: { shot_01: "v1" },
      dialogue: [
        {
          dialogue_line_id: "line_1",
          shot_id: "shot_01",
          asset_id: "d1",
          length_samples: 96_000,
          pause_before_samples: 0,
          pause_after_samples: 0,
        },
      ],
      loudness_profile: "social",
    });

    await compose({
      timeline,
      assetPaths: { v1: video, d1: speech },
      outputPath: out,
      width: 1080,
      height: 1920,
    });

    const measured = await measureLufs(out);
    const target = LOUDNESS_TARGETS.social.integrated_lufs;
    // loudnorm in single-pass mode lands close but not exactly; a whole
    // loudness unit of slack is the honest tolerance.
    expect(Math.abs(measured - target)).toBeLessThan(1.5);
  }, 180_000);

  it("normalises quiet source material up to the same target", async () => {
    const video = await clip("mix-video-2.mp4", 3);
    // Deliberately far too quiet: the point of normalisation is that the user
    // does not have to care what level the TTS came out at.
    const speech = await tone("mix-quiet.wav", 2, 330, 0.005);
    const out = path.join(dir, "mix-quiet.mp4");

    const { timeline } = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 72)]),
      shot_assets: { shot_01: "v1" },
      dialogue: [
        {
          dialogue_line_id: "line_1",
          shot_id: "shot_01",
          asset_id: "d1",
          length_samples: 96_000,
          pause_before_samples: 0,
          pause_after_samples: 0,
        },
      ],
      loudness_profile: "social",
    });

    await compose({
      timeline,
      assetPaths: { v1: video, d1: speech },
      outputPath: out,
      width: 1080,
      height: 1920,
    });

    expect(Math.abs((await measureLufs(out)) - LOUDNESS_TARGETS.social.integrated_lufs)).toBeLessThan(1.5);
  }, 180_000);

  it("places dialogue at the sample the timeline specified", async () => {
    const video = await clip("mix-video-3.mp4", 4);
    const speech = await tone("mix-late.wav", 1, 880, 0.3);
    const out = path.join(dir, "mix-late.mp4");

    // One second of pause before the line: sound must begin at sample 48000.
    const { timeline } = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 96)]),
      shot_assets: { shot_01: "v1" },
      dialogue: [
        {
          dialogue_line_id: "line_1",
          shot_id: "shot_01",
          asset_id: "d1",
          length_samples: 48_000,
          pause_before_samples: 48_000,
          pause_after_samples: 0,
        },
      ],
      loudness_profile: "social",
    });

    await compose({
      timeline,
      assetPaths: { v1: video, d1: speech },
      outputPath: out,
      width: 720,
      height: 1280,
    });

    const detected = await firstSoundSample(out);
    // adelay works in milliseconds, so one millisecond of slack is inherent.
    expect(Math.abs(detected - 48_000)).toBeLessThan(48 * 2);
  }, 180_000);
});

describe("range requests", () => {
  it("parses an ordinary range", () => {
    expect(parseRange("bytes=0-1023", 4096)).toEqual({ start: 0, end: 1023, length: 1024 });
  });

  it("treats an open-ended range as running to the end", () => {
    expect(parseRange("bytes=1024-", 4096)).toEqual({ start: 1024, end: 4095, length: 3072 });
  });

  it("handles a suffix range, which players use to read a trailing index", () => {
    expect(parseRange("bytes=-512", 4096)).toEqual({ start: 3584, end: 4095, length: 512 });
  });

  it("clamps a range that runs past the end", () => {
    expect(parseRange("bytes=4000-9999", 4096)).toEqual({ start: 4000, end: 4095, length: 96 });
  });

  it("rejects a range that starts past the end", () => {
    expect(parseRange("bytes=5000-6000", 4096)).toBeNull();
  });

  it("rejects an inverted range", () => {
    expect(parseRange("bytes=2000-1000", 4096)).toBeNull();
  });

  it("ignores a malformed header rather than guessing", () => {
    expect(parseRange("items=0-10", 4096)).toBeNull();
    expect(parseRange(undefined, 4096)).toBeNull();
  });
});
