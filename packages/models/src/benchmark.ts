import type { GenerationKind, QualityDimension } from "@videoai/contracts";

/**
 * The golden benchmark suite (spec section 84).
 *
 * Eighteen prompts chosen because each one isolates a way video generation
 * fails. A model that scores well on pretty landscapes and badly on hands is
 * not a good model; it is a model that has not been asked the hard question.
 *
 * The cases are data rather than code so a new model is benchmarked against
 * exactly what its predecessor was, which is the only way the comparison means
 * anything.
 */

export interface GoldenCase {
  id: string;
  prompt: string;
  generation_kind: GenerationKind;
  duration_frames: number;
  /** What this case exists to measure. Scored more heavily than the rest. */
  focus: QualityDimension[];
  /** Why this case is in the suite at all. */
  rationale: string;
  requires_reference?: boolean;
  requires_audio?: boolean;
}

export const GOLDEN_SUITE: GoldenCase[] = [
  {
    id: "single-human-walking",
    prompt: "A woman walks across a sunlit kitchen, her weight settling onto each step",
    generation_kind: "text_to_video",
    duration_frames: 96,
    focus: ["motion", "physics", "anatomy"],
    rationale: "Walking is the motion everyone can judge, and the one generators slide through.",
  },
  {
    id: "face-closeup",
    prompt: "Close on a woman's face as she realises something, fine lines at the corners of her eyes",
    generation_kind: "text_to_video",
    duration_frames: 72,
    focus: ["face", "realism", "identity"],
    rationale: "The waxy face is the most recognisable failure in generated humans.",
  },
  {
    id: "hands-detail",
    prompt: "Close on two hands unscrewing the lid of a glass jar",
    generation_kind: "text_to_video",
    duration_frames: 72,
    focus: ["hands", "anatomy", "interaction"],
    rationale: "Hands in contact with an object are the hardest thing this technology does.",
  },
  {
    id: "product-interaction",
    prompt: "A hand lifts a frosted glass bottle from a marble counter and turns it toward camera",
    generation_kind: "image_to_video",
    duration_frames: 72,
    focus: ["product", "hands", "interaction"],
    rationale: "Product plus hand is the pairing every commercial needs and most models fail.",
    requires_reference: true,
  },
  {
    id: "text-and-logo",
    prompt: "A product bottle held steady, its label facing camera and fully legible",
    generation_kind: "image_to_video",
    duration_frames: 48,
    focus: ["text_preservation", "logo", "product"],
    rationale: "Garbled pack text reads as counterfeit and no repair recovers it.",
    requires_reference: true,
  },
  {
    id: "two-humans",
    prompt: "Two people sit across a table from each other, one leaning in to listen",
    generation_kind: "text_to_video",
    duration_frames: 96,
    focus: ["anatomy", "interaction", "identity"],
    rationale: "Multiple people is where merged bodies and extra limbs appear.",
  },
  {
    id: "dialogue-to-camera",
    prompt: "A creator speaks to camera in a bright bedroom, glancing away and back once",
    generation_kind: "speech_to_video",
    duration_frames: 120,
    focus: ["lip_sync", "av_sync", "face"],
    rationale: "The talking shot the product exists to make.",
    requires_audio: true,
    requires_reference: true,
  },
  {
    id: "car-departure",
    prompt: "A car pulls away from a kerb and out of frame on a quiet street",
    generation_kind: "text_to_video",
    duration_frames: 96,
    focus: ["physics", "motion", "temporal_consistency"],
    rationale: "Rigid bodies in motion expose physics failures that soft subjects hide.",
  },
  {
    id: "night-interior",
    prompt: "A dim living room lit only by a table lamp, warm light falling off across the wall",
    generation_kind: "text_to_video",
    duration_frames: 72,
    focus: ["lighting", "exposure", "realism"],
    rationale: "Low light is where noise, banding and flat illumination show up.",
  },
  {
    id: "water",
    prompt: "Water pours from a jug into a glass, filling it",
    generation_kind: "text_to_video",
    duration_frames: 72,
    focus: ["physics", "temporal_consistency", "motion"],
    rationale: "Fluid is unforgiving: wrong physics is obvious to everyone.",
  },
  {
    id: "animal",
    prompt: "A dog turns its head toward the camera and blinks",
    generation_kind: "text_to_video",
    duration_frames: 60,
    focus: ["anatomy", "motion", "realism"],
    rationale: "Animals have anatomy people know well and models are trained on less of.",
  },
  {
    id: "camera-dolly",
    prompt: "The camera moves steadily closer to a woman standing at a window",
    generation_kind: "text_to_video",
    duration_frames: 96,
    focus: ["camera", "temporal_consistency", "background"],
    rationale: "A moving camera is where warping backgrounds and morphing geometry appear.",
  },
  {
    id: "handheld",
    prompt: "Handheld shot following a person through a doorway, the frame drifting and settling",
    generation_kind: "text_to_video",
    duration_frames: 96,
    focus: ["camera", "motion", "realism"],
    rationale: "Handheld is a realism cue that reads as fake when overdone.",
  },
  {
    id: "product-rotation",
    prompt: "A bottle rotates slowly on a turntable, its label passing the camera",
    generation_kind: "image_to_video",
    duration_frames: 96,
    focus: ["product", "text_preservation", "temporal_consistency"],
    rationale: "Rotation tests whether product detail survives changing angle.",
    requires_reference: true,
  },
  {
    id: "character-persistence",
    prompt: "The same woman, now seated, picking up a cup",
    generation_kind: "image_to_video",
    duration_frames: 72,
    focus: ["identity", "face", "background"],
    rationale: "The second shot of a character is where identity drift first shows.",
    requires_reference: true,
  },
  {
    id: "multi-shot-continuity",
    prompt: "A reverse angle of the same conversation, matching light and wardrobe",
    generation_kind: "image_to_video",
    duration_frames: 72,
    focus: ["continuity", "lighting", "identity"],
    rationale: "Continuity across a cut is what makes shots into a scene.",
    requires_reference: true,
  },
  {
    id: "ugc-creator",
    prompt: "A creator holds a product up to a phone camera in an ordinary bathroom",
    generation_kind: "speech_to_video",
    duration_frames: 120,
    focus: ["realism", "product", "lip_sync"],
    rationale: "The UGC look has to be imperfect without being defective.",
    requires_audio: true,
    requires_reference: true,
  },
  {
    id: "complex-physics",
    prompt: "A stack of books topples onto a table",
    generation_kind: "text_to_video",
    duration_frames: 72,
    focus: ["physics", "object_persistence", "motion"],
    rationale: "Multi-body physics is the limit of what current models handle.",
  },
];

export interface BenchmarkMeasurement {
  case_id: string;
  scores: Partial<Record<QualityDimension, number>>;
  runtime_ms: number;
  peak_vram_bytes: number;
  repair_attempts: number;
  gpu_seconds: number;
  /** Dimensions no available judge could measure. */
  unmeasured: QualityDimension[];
}

export interface BenchmarkResult {
  model_id: string;
  model_version: string;
  suite: string;
  measurements: BenchmarkMeasurement[];
  /** Focus dimensions weigh double: a case exists for what it isolates. */
  overall: number;
  coverage: number;
  runtime_ms_total: number;
  gpu_seconds_total: number;
}

export function summarise(
  modelId: string,
  modelVersion: string,
  measurements: BenchmarkMeasurement[],
): BenchmarkResult {
  const byId = new Map(GOLDEN_SUITE.map((c) => [c.id, c]));

  let weighted = 0;
  let weight = 0;
  let measured = 0;
  let expected = 0;

  for (const measurement of measurements) {
    const golden = byId.get(measurement.case_id);
    if (!golden) continue;

    expected += golden.focus.length;
    for (const [dimension, score] of Object.entries(measurement.scores) as Array<[QualityDimension, number]>) {
      const isFocus = golden.focus.includes(dimension);
      if (isFocus) measured += 1;
      const w = isFocus ? 2 : 1;
      weighted += score * w;
      weight += w;
    }
  }

  return {
    model_id: modelId,
    model_version: modelVersion,
    suite: "golden-v1",
    measurements,
    overall: weight === 0 ? 0 : weighted / weight,
    // Coverage matters as much as the score while the vision judges are
    // unavailable: a high score over a third of the dimensions is not a pass.
    coverage: expected === 0 ? 0 : measured / expected,
    runtime_ms_total: measurements.reduce((s, m) => s + m.runtime_ms, 0),
    gpu_seconds_total: measurements.reduce((s, m) => s + m.gpu_seconds, 0),
  };
}

export interface RegressionVerdict {
  passed: boolean;
  reasons: string[];
  regressions: Array<{ case_id: string; dimension: string; before: number; after: number }>;
}

/**
 * Compare a candidate against the incumbent (spec section 112).
 *
 * A single case regressing badly blocks promotion even when the average
 * improved, because an average is exactly how a specific new failure gets
 * hidden.
 */
export function compareToBaseline(
  candidate: BenchmarkResult,
  baseline: BenchmarkResult,
  tolerance = { perCase: 0.1, overall: 0, runtime: 0.5 },
): RegressionVerdict {
  const reasons: string[] = [];
  const regressions: RegressionVerdict["regressions"] = [];

  const baselineById = new Map(baseline.measurements.map((m) => [m.case_id, m]));

  for (const measurement of candidate.measurements) {
    const before = baselineById.get(measurement.case_id);
    if (!before) continue;

    for (const [dimension, after] of Object.entries(measurement.scores) as Array<[QualityDimension, number]>) {
      const previous = before.scores[dimension];
      if (previous === undefined) continue;
      if (previous - after > tolerance.perCase) {
        regressions.push({ case_id: measurement.case_id, dimension, before: previous, after });
      }
    }
  }

  if (regressions.length > 0) {
    reasons.push(
      `${regressions.length} case/dimension pair(s) regressed by more than ` +
        `${(tolerance.perCase * 100).toFixed(0)}%: ` +
        regressions.map((r) => `${r.case_id}/${r.dimension}`).join(", "),
    );
  }

  if (candidate.overall < baseline.overall - tolerance.overall) {
    reasons.push(
      `Overall fell from ${baseline.overall.toFixed(3)} to ${candidate.overall.toFixed(3)}.`,
    );
  }

  if (
    baseline.runtime_ms_total > 0 &&
    candidate.runtime_ms_total > baseline.runtime_ms_total * (1 + tolerance.runtime)
  ) {
    reasons.push(
      `Runtime rose by ${(((candidate.runtime_ms_total / baseline.runtime_ms_total) - 1) * 100).toFixed(0)}%.`,
    );
  }

  if (candidate.coverage < baseline.coverage) {
    // Fewer dimensions measured is not a better result; it is less evidence.
    reasons.push(
      `Coverage fell from ${(baseline.coverage * 100).toFixed(0)}% to ` +
        `${(candidate.coverage * 100).toFixed(0)}%.`,
    );
  }

  return { passed: reasons.length === 0, reasons, regressions };
}
