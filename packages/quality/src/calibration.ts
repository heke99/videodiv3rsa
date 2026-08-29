import type { QualityDimension } from "@videoai/contracts";

/**
 * Judge calibration (spec section 34).
 *
 * A judge's score is an opinion until it has been shown to agree with people.
 * This module measures that agreement and recommends thresholds, so the
 * numbers the pipeline gates on are chosen from evidence rather than picked.
 */

export interface CalibrationSample {
  asset_id: string;
  /** What the judge said, 0 to 1. */
  judge_score: number;
  /** What a person said, on the same scale. */
  human_score: number;
  /** What the person said was wrong, if anything. */
  failure_labels: string[];
}

export interface CalibrationReport {
  dimension: QualityDimension;
  samples: number;
  /** Pearson correlation between judge and human scores. */
  correlation: number;
  /** At the current threshold: judge failed, human passed. */
  false_positive_rate: number;
  /** At the current threshold: judge passed, human failed. */
  false_negative_rate: number;
  current_threshold: number;
  recommended_threshold: number;
  /** Whether the judge is trustworthy enough to gate on. */
  usable: boolean;
  notes: string[];
}

/** Below this correlation a judge is not measuring what people perceive. */
const MINIMUM_CORRELATION = 0.5;
const MINIMUM_SAMPLES = 20;

export function calibrate(
  dimension: QualityDimension,
  samples: CalibrationSample[],
  currentThreshold: number,
  humanPassMark = 0.7,
): CalibrationReport {
  const notes: string[] = [];

  if (samples.length < MINIMUM_SAMPLES) {
    notes.push(
      `Only ${samples.length} rated samples; at least ${MINIMUM_SAMPLES} are needed before ` +
        `a threshold recommendation means anything.`,
    );
  }

  const correlation = pearson(
    samples.map((s) => s.judge_score),
    samples.map((s) => s.human_score),
  );

  const rates = errorRates(samples, currentThreshold, humanPassMark);
  const recommended = recommendThreshold(samples, humanPassMark);

  if (correlation < MINIMUM_CORRELATION) {
    notes.push(
      `Correlation with human rating is ${correlation.toFixed(2)}, below ${MINIMUM_CORRELATION}. ` +
        `This judge should not gate: it is not measuring what people notice.`,
    );
  }
  if (rates.false_positive_rate > 0.2) {
    notes.push(
      `${(rates.false_positive_rate * 100).toFixed(0)}% of failures are shots people found acceptable, ` +
        `which spends GPU on repairs nobody needed.`,
    );
  }
  if (rates.false_negative_rate > 0.1) {
    notes.push(
      `${(rates.false_negative_rate * 100).toFixed(0)}% of passes are shots people rejected. ` +
        `Raising the threshold would catch them.`,
    );
  }

  return {
    dimension,
    samples: samples.length,
    correlation,
    ...rates,
    current_threshold: currentThreshold,
    recommended_threshold: recommended,
    usable: correlation >= MINIMUM_CORRELATION && samples.length >= MINIMUM_SAMPLES,
    notes,
  };
}

export function errorRates(
  samples: CalibrationSample[],
  threshold: number,
  humanPassMark: number,
): { false_positive_rate: number; false_negative_rate: number } {
  let judgeFailed = 0;
  let falsePositives = 0;
  let judgePassed = 0;
  let falseNegatives = 0;

  for (const sample of samples) {
    const judgeSaysPass = sample.judge_score >= threshold;
    const humanSaysPass = sample.human_score >= humanPassMark;

    if (judgeSaysPass) {
      judgePassed += 1;
      if (!humanSaysPass) falseNegatives += 1;
    } else {
      judgeFailed += 1;
      if (humanSaysPass) falsePositives += 1;
    }
  }

  return {
    false_positive_rate: judgeFailed === 0 ? 0 : falsePositives / judgeFailed,
    false_negative_rate: judgePassed === 0 ? 0 : falseNegatives / judgePassed,
  };
}

/**
 * Sweep candidate thresholds and pick the one that minimises total error,
 * weighting missed defects more heavily than unnecessary repairs.
 *
 * The asymmetry is deliberate: shipping a bad shot costs the user's trust,
 * while a needless repair costs GPU time, and those are not equivalent.
 */
export function recommendThreshold(
  samples: CalibrationSample[],
  humanPassMark = 0.7,
  falseNegativeWeight = 3,
): number {
  if (samples.length === 0) return 0.7;

  let best = 0.7;
  let bestCost = Number.POSITIVE_INFINITY;

  // Step over integers and derive the threshold, so the value returned is
  // exactly the value that was evaluated. Accumulating 0.01 in a float gives a
  // candidate that behaves like 0.56 and formats as 0.55.
  for (let step = 30; step <= 95; step++) {
    const threshold = step / 100;
    const rates = errorRates(samples, threshold, humanPassMark);
    const cost = rates.false_positive_rate + rates.false_negative_rate * falseNegativeWeight;
    if (cost < bestCost) {
      bestCost = cost;
      best = threshold;
    }
  }

  return best;
}

export function pearson(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 2) return 0;

  const meanA = a.reduce((x, y) => x + y, 0) / a.length;
  const meanB = b.reduce((x, y) => x + y, 0) / b.length;

  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;

  for (let i = 0; i < a.length; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }

  const denominator = Math.sqrt(varianceA * varianceB);
  // No variance in either series means correlation is undefined; reporting
  // zero is more honest than reporting a spurious 1.
  return denominator === 0 ? 0 : covariance / denominator;
}

/**
 * Which failure labels a judge misses entirely.
 *
 * A judge can correlate well overall and still be blind to one defect class,
 * which is exactly the gap that lets a specific failure ship repeatedly.
 */
export function blindSpots(samples: CalibrationSample[], threshold: number): string[] {
  const missed = new Map<string, number>();
  const total = new Map<string, number>();

  for (const sample of samples) {
    for (const label of sample.failure_labels) {
      total.set(label, (total.get(label) ?? 0) + 1);
      if (sample.judge_score >= threshold) missed.set(label, (missed.get(label) ?? 0) + 1);
    }
  }

  return [...total.entries()]
    .filter(([label, count]) => (missed.get(label) ?? 0) / count > 0.5)
    .map(([label]) => label)
    .sort();
}
