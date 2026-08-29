import { describe, expect, it } from "vitest";
import type { Shot, ShotPlan } from "@videoai/contracts";
import { DUCKING, applyDucking, assembleTimeline, diffTimelines, summariseDiff } from "@videoai/timeline";

/**
 * Timeline assembly is where the video clock and the audio clock have to agree
 * (spec sections 18, 19, 20). The cases below are the ones where they don't
 * naturally: speech longer than its shot, music under dialogue, and a
 * regenerated shot changing what was there.
 */

const timebase = { frame_rate: { num: 24, den: 1 }, audio_sample_rate: 48_000 as const };
const PROJECT = "00000000-0000-4000-8000-000000000001";

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

describe("timeline assembly", () => {
  it("lays shots end to end on the video track", () => {
    const { timeline } = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 48), shot("shot_02", 1, 72)]),
      shot_assets: { shot_01: "a1", shot_02: "a2" },
    });

    const video = timeline.events.filter((e) => e.kind === "video");
    expect(video.map((e) => [e.start_frame, e.end_frame])).toEqual([
      [0, 48],
      [48, 120],
    ]);
    expect(timeline.duration_frames).toBe(120);
  });

  it("extends a shot whose dialogue does not fit, rather than clipping speech", () => {
    // 2.5 seconds of speech in a 1 second shot.
    const { timeline, extended_shots } = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 24)]),
      shot_assets: { shot_01: "a1" },
      dialogue: [
        {
          dialogue_line_id: "line_1",
          shot_id: "shot_01",
          asset_id: "d1",
          length_samples: 120_000,
          pause_before_samples: 0,
          pause_after_samples: 0,
        },
      ],
    });

    expect(extended_shots).toEqual([{ shot_id: "shot_01", from_frames: 24, to_frames: 60 }]);
    expect(timeline.duration_frames).toBe(60);

    // The whole line still fits inside the picture it belongs to.
    const line = timeline.events.find((e) => e.id === "ev_line_1")!;
    expect(line.kind).toBe("audio");
    if (line.kind === "audio") expect(line.end_sample).toBeLessThanOrEqual(120_000);
  });

  it("rounds an extension up to a whole frame so the cut stays clean", () => {
    const { extended_shots } = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 24)]),
      shot_assets: { shot_01: "a1" },
      // 50001 samples is a hair over 25 frames.
      dialogue: [
        {
          dialogue_line_id: "line_1",
          shot_id: "shot_01",
          asset_id: "d1",
          length_samples: 50_001,
          pause_before_samples: 0,
          pause_after_samples: 0,
        },
      ],
    });
    expect(extended_shots[0]!.to_frames).toBe(26);
  });

  it("leaves a shot alone when its dialogue already fits", () => {
    const { extended_shots } = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 48)]),
      shot_assets: { shot_01: "a1" },
      dialogue: [
        {
          dialogue_line_id: "line_1",
          shot_id: "shot_01",
          asset_id: "d1",
          length_samples: 48_000,
          pause_before_samples: 0,
          pause_after_samples: 0,
        },
      ],
    });
    expect(extended_shots).toEqual([]);
  });

  it("places dialogue against its own shot, not end to end", () => {
    const { timeline } = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 48), shot("shot_02", 1, 48)]),
      shot_assets: { shot_01: "a1", shot_02: "a2" },
      dialogue: [
        {
          dialogue_line_id: "line_2",
          shot_id: "shot_02",
          asset_id: "d2",
          length_samples: 24_000,
          pause_before_samples: 0,
          pause_after_samples: 0,
        },
      ],
    });

    const line = timeline.events.find((e) => e.id === "ev_line_2")!;
    // Shot two starts at frame 48, which is sample 96000 at 24fps / 48kHz.
    if (line.kind === "audio") expect(line.start_sample).toBe(96_000);
  });

  it("honours explicit pauses, which the planner set for a reason", () => {
    const { timeline } = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 120)]),
      shot_assets: { shot_01: "a1" },
      dialogue: [
        {
          dialogue_line_id: "line_1",
          shot_id: "shot_01",
          asset_id: "d1",
          length_samples: 24_000,
          pause_before_samples: 12_000,
          pause_after_samples: 0,
        },
      ],
    });
    const line = timeline.events.find((e) => e.id === "ev_line_1")!;
    if (line.kind === "audio") expect(line.start_sample).toBe(12_000);
  });

  it("builds captions from alignment, offset to where the audio actually sits", () => {
    const { timeline } = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 48), shot("shot_02", 1, 48)]),
      shot_assets: { shot_01: "a1", shot_02: "a2" },
      dialogue: [
        {
          dialogue_line_id: "line_2",
          shot_id: "shot_02",
          asset_id: "d2",
          length_samples: 24_000,
          pause_before_samples: 0,
          pause_after_samples: 0,
          alignment: {
            dialogue_line_id: "line_2",
            asset: { asset_id: "d2" },
            sample_rate: 48_000,
            words: [
              { word: "hello", start_sample: 0, end_sample: 12_000, confidence: 1 },
              { word: "there", start_sample: 12_000, end_sample: 24_000, confidence: 1 },
            ],
            phonemes: [],
          },
        },
      ],
    });

    const caption = timeline.events.find((e) => e.kind === "caption")!;
    // Alignment timings are relative to the WAV; the caption must carry the
    // same offset the audio got, or subtitles drift by a whole shot.
    if (caption.kind === "caption") {
      expect(caption.start_sample).toBe(96_000);
      expect(caption.text).toBe("hello there");
    }
  });

  it("produces a timeline that passes its own validation", async () => {
    const { validateTimeline } = await import("@videoai/timeline");
    const { timeline } = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 48), shot("shot_02", 1, 48)]),
      shot_assets: { shot_01: "a1", shot_02: "a2" },
      dialogue: [
        {
          dialogue_line_id: "line_1",
          shot_id: "shot_01",
          asset_id: "d1",
          length_samples: 24_000,
          pause_before_samples: 0,
          pause_after_samples: 0,
        },
      ],
      beds: [{ kind: "MUSIC", asset_id: "m1", start_sample: 0, length_samples: 192_000 }],
    });
    expect(validateTimeline(timeline)).toEqual([]);
  });
});

describe("ducking", () => {
  const music = {
    id: "ev_music",
    track_id: "music",
    kind: "audio" as const,
    asset: { asset_id: "m1" },
    shot_id: null,
    scene_id: null,
    start_sample: 0,
    end_sample: 480_000,
    source_start_sample: 0,
    gain_db: -6,
    fade_in_samples: 0,
    fade_out_samples: 0,
    pan: 0,
    ducking_group: "music" as const,
  };

  const speech = {
    id: "ev_line",
    track_id: "dialogue",
    kind: "audio" as const,
    asset: { asset_id: "d1" },
    shot_id: null,
    scene_id: null,
    start_sample: 96_000,
    end_sample: 192_000,
    source_start_sample: 0,
    gain_db: 0,
    fade_in_samples: 0,
    fade_out_samples: 0,
    pan: 0,
    ducking_group: "dialogue" as const,
  };

  it("leaves music alone when nothing is being said", () => {
    expect(applyDucking([music], [], 48_000)).toEqual([music]);
  });

  it("splits music into unducked, ducked and unducked around speech", () => {
    const result = applyDucking([music], [speech], 48_000);
    expect(result).toHaveLength(3);
    expect(result[1]!.gain_db).toBe(-6 + DUCKING.attenuation_db);
    expect(result[0]!.gain_db).toBe(-6);
    expect(result[2]!.gain_db).toBe(-6);
  });

  it("ducks slightly ahead of speech and recovers after it", () => {
    const result = applyDucking([music], [speech], 48_000);
    const attack = Math.round((DUCKING.attack_ms * 48_000) / 1000);
    const release = Math.round((DUCKING.release_ms * 48_000) / 1000);
    expect(result[1]!.start_sample).toBe(96_000 - attack);
    expect(result[1]!.end_sample).toBe(192_000 + release);
  });

  it("keeps reading the same source, so ducking never restarts the music", () => {
    const result = applyDucking([music], [speech], 48_000);
    for (const piece of result) {
      expect(piece.source_start_sample).toBe(piece.start_sample - music.start_sample);
    }
  });

  it("covers the whole original span with no gap or overlap", () => {
    const result = applyDucking([music], [speech], 48_000);
    expect(result[0]!.start_sample).toBe(music.start_sample);
    expect(result[result.length - 1]!.end_sample).toBe(music.end_sample);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.start_sample).toBe(result[i - 1]!.end_sample);
    }
  });

  it("merges overlapping speech into one duck rather than pumping", () => {
    const second = { ...speech, id: "ev_line2", start_sample: 180_000, end_sample: 240_000 };
    const result = applyDucking([music], [speech, second], 48_000);
    // Two lines that touch produce one continuous dip, not two.
    expect(result.filter((r) => r.gain_db < -6)).toHaveLength(1);
  });

  it("does not duck tracks that are not in the music group", () => {
    const sfx = { ...music, id: "ev_sfx", track_id: "sfx", ducking_group: null };
    expect(applyDucking([sfx], [speech], 48_000)).toEqual([sfx]);
  });
});

describe("timeline diff", () => {
  const base = assembleTimeline({
    project_id: PROJECT,
    timebase,
    plan: plan([shot("shot_01", 0, 48), shot("shot_02", 1, 48)]),
    shot_assets: { shot_01: "a1", shot_02: "a2" },
  }).timeline;

  it("reports nothing when nothing changed", () => {
    const diff = diffTimelines(base, base);
    expect(diff.identical).toBe(true);
    expect(summariseDiff(diff)).toBe("No change");
  });

  it("reports a regenerated shot as a replaced asset", () => {
    const after = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 48), shot("shot_02", 1, 48)]),
      shot_assets: { shot_01: "a1", shot_02: "a2-take-2" },
    }).timeline;

    const diff = diffTimelines(base, after);
    expect(diff.changes).toContainEqual(
      expect.objectContaining({ kind: "replaced", event_id: "ev_shot_02" }),
    );
  });

  it("reports the knock-on move when an earlier shot gets longer", () => {
    const after = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 72), shot("shot_02", 1, 48)]),
      shot_assets: { shot_01: "a1", shot_02: "a2" },
    }).timeline;

    const diff = diffTimelines(base, after);
    expect(diff.changes).toContainEqual(expect.objectContaining({ kind: "retimed", event_id: "ev_shot_01" }));
    expect(diff.changes).toContainEqual(expect.objectContaining({ kind: "moved", event_id: "ev_shot_02" }));
    expect(diff.duration_frames_after).toBe(120);
  });

  it("summarises in a sentence a person can read", () => {
    const after = assembleTimeline({
      project_id: PROJECT,
      timebase,
      plan: plan([shot("shot_01", 0, 72), shot("shot_02", 1, 48)]),
      shot_assets: { shot_01: "a1", shot_02: "a2" },
    }).timeline;
    expect(summariseDiff(diffTimelines(base, after))).toContain("duration 96 to 120 frames");
  });
});
