import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Shot, ShotPlan } from "@videoai/contracts";
import { assembleTimeline } from "@videoai/timeline";
import { compose, ffmpeg, probe, runTechnicalQc } from "@videoai/render";
import { coverage, evaluate, measuredJudges, QUALITY_PROFILES } from "@videoai/quality";

/**
 * The delivery half of the pipeline, end to end on real files.
 *
 * Each stage is covered by its own tests; what this one asserts is that they
 * fit together -- that a plan becomes a timeline whose events point at assets
 * the compositor can find, that the file it writes matches what the timeline
 * said it would be, and that the judges score it and say how much of the
 * profile they were able to check. Every stage here runs on CPU.
 */

let dir: string;
const PROJECT = "00000000-0000-4000-8000-000000000001";
const timebase = { frame_rate: { num: 24, den: 1 }, audio_sample_rate: 48_000 as const };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "videoai-pipeline-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function shot(id: string, index: number, frames: number, dialogue: string[] = []): Shot {
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
    dialogue_line_ids: dialogue,
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

async function speech(name: string, seconds: number): Promise<string> {
  const out = path.join(dir, name);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    "-af",
    "volume=0.2",
    "-c:a",
    "pcm_s16le",
    out,
  ]);
  return out;
}

describe("plan to delivered file", () => {
  it("assembles, composes, measures and judges without a GPU", async () => {
    const first = await clip("pipe-a.mp4", 3);
    const second = await clip("pipe-b.mp4", 3);
    const line = await speech("pipe-line.wav", 2);
    const output = path.join(dir, "pipe-master.mp4");

    // 48 frames each at 24fps, but the first shot's dialogue runs 2 seconds,
    // so assembly has to lengthen it rather than clip the speech.
    const shots = [shot("shot_01", 0, 24, ["line_1"]), shot("shot_02", 1, 48)];

    const { timeline, extended_shots } = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan(shots),
      shot_assets: { shot_01: "asset_a", shot_02: "asset_b" },
      dialogue: [
        {
          dialogue_line_id: "line_1",
          shot_id: "shot_01",
          asset_id: "asset_line",
          length_samples: 96_000,
          pause_before_samples: 0,
          pause_after_samples: 0,
        },
      ],
      loudness_profile: "social",
    });

    expect(extended_shots).toEqual([{ shot_id: "shot_01", from_frames: 24, to_frames: 48 }]);
    expect(timeline.duration_frames).toBe(96);

    // Every asset the timeline references must be one the caller can resolve;
    // a dangling id here is the failure mode that only shows up at render time.
    const paths: Record<string, string> = { asset_a: first, asset_b: second, asset_line: line };
    for (const event of timeline.events) {
      if (event.kind === "caption") continue;
      expect(Object.keys(paths)).toContain(event.asset.asset_id);
    }

    await compose({ timeline, assetPaths: paths, outputPath: output, width: 1080, height: 1920 });

    const info = await probe(output);
    expect(info.container_ok).toBe(true);
    expect(info.width).toBe(1080);
    expect(info.height).toBe(1920);

    // The file the compositor wrote must satisfy the technical QC the
    // orchestrator runs on it, against the same timeline it was built from.
    const report = await runTechnicalQc(output, {
      asset_id: "render",
      expected_frames: timeline.duration_frames,
      expected_fps: timebase.frame_rate,
      expected_width: 1080,
      expected_height: 1920,
      expects_audio: true,
      expected_sample_rate: timebase.audio_sample_rate,
    });
    expect(report.passed).toBe(true);
    expect(report.findings).toEqual([]);

    const evaluation = await evaluate(
      measuredJudges,
      {
        asset_path: output,
        planned_motion_complexity: 0.5,
        loudness_profile: "social",
        audio_sample_rate: timebase.audio_sample_rate,
        expects_audio: true,
      },
      { subject_kind: "final", subject_id: "render", profile: "STANDARD" },
    );

    expect(evaluation.judges).toHaveLength(measuredJudges.length);
    expect(evaluation.overall).toBeGreaterThan(0);

    // The honest part: the measured panel does not cover a whole profile, and
    // the number says so rather than the result implying a full check.
    const covered = coverage(evaluation, "STANDARD");
    const gated = Object.keys(QUALITY_PROFILES.STANDARD.dimensions).length;
    expect(covered).toBeGreaterThan(0);
    expect(covered).toBeLessThanOrEqual(1);
    expect(Math.round(covered * gated)).toBe(
      Object.keys(QUALITY_PROFILES.STANDARD.dimensions).filter(
        (d) => evaluation.scores[d as keyof typeof evaluation.scores] !== undefined,
      ).length,
    );
  }, 300_000);
});
