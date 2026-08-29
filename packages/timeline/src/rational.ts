/**
 * Exact rational arithmetic for the master timebase (spec section 18).
 *
 * Every conversion between frames, samples and ticks goes through integer maths
 * so that 4.9999997 seconds can never become a canonical value. Intermediate
 * products use bigint because frame_count * sample_rate * fps_den overflows
 * double precision on long projects at high sample rates.
 */

export interface Rational {
  num: number;
  den: number;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    [x, y] = [y, x % y];
  }
  return x;
}

export function normalizeRational(r: Rational): Rational {
  if (!Number.isInteger(r.num) || !Number.isInteger(r.den)) {
    throw new Error(`Rational components must be integers, got ${r.num}/${r.den}`);
  }
  if (r.den <= 0 || r.num <= 0) {
    throw new Error(`Rational must be positive, got ${r.num}/${r.den}`);
  }
  const g = gcd(BigInt(r.num), BigInt(r.den));
  return { num: Number(BigInt(r.num) / g), den: Number(BigInt(r.den) / g) };
}

export function rationalEquals(a: Rational, b: Rational): boolean {
  return BigInt(a.num) * BigInt(b.den) === BigInt(b.num) * BigInt(a.den);
}

/**
 * Interop timebase: 1/1000000 second ticks. Integer, monotonic, and lossless
 * for every frame rate and sample rate we support.
 */
export const MASTER_TICKS_PER_SECOND = 1_000_000n;

export type RoundingMode = "floor" | "ceil" | "nearest";

function divide(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) throw new Error("Division by zero in timebase conversion");
  const q = numerator / denominator;
  const r = numerator % denominator;
  if (r === 0n) return q;
  switch (mode) {
    case "floor":
      return numerator < 0n ? q - 1n : q;
    case "ceil":
      return numerator < 0n ? q : q + 1n;
    case "nearest": {
      const twice = (r < 0n ? -r : r) * 2n;
      const roundAway = twice >= (denominator < 0n ? -denominator : denominator);
      if (!roundAway) return q;
      return numerator < 0n ? q - 1n : q + 1n;
    }
  }
}

function toSafeNumber(value: bigint, what: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${what} exceeds safe integer range: ${value}`);
  }
  return Number(value);
}

/** frames -> ticks. Exact: frames * ticksPerSecond * den / num. */
export function framesToTicks(frames: number, fps: Rational, mode: RoundingMode = "nearest"): number {
  assertInteger(frames, "frames");
  const f = normalizeRational(fps);
  const ticks = divide(BigInt(frames) * MASTER_TICKS_PER_SECOND * BigInt(f.den), BigInt(f.num), mode);
  return toSafeNumber(ticks, "ticks");
}

export function ticksToFrames(ticks: number, fps: Rational, mode: RoundingMode = "nearest"): number {
  assertInteger(ticks, "ticks");
  const f = normalizeRational(fps);
  const frames = divide(BigInt(ticks) * BigInt(f.num), MASTER_TICKS_PER_SECOND * BigInt(f.den), mode);
  return toSafeNumber(frames, "frames");
}

export function samplesToTicks(samples: number, sampleRate: number, mode: RoundingMode = "nearest"): number {
  assertInteger(samples, "samples");
  assertInteger(sampleRate, "sampleRate");
  const ticks = divide(BigInt(samples) * MASTER_TICKS_PER_SECOND, BigInt(sampleRate), mode);
  return toSafeNumber(ticks, "ticks");
}

export function ticksToSamples(ticks: number, sampleRate: number, mode: RoundingMode = "nearest"): number {
  assertInteger(ticks, "ticks");
  const samples = divide(BigInt(ticks) * BigInt(sampleRate), MASTER_TICKS_PER_SECOND, mode);
  return toSafeNumber(samples, "samples");
}

/**
 * frames -> samples without going through ticks, so no rounding is introduced
 * in the middle. This is the conversion the mixer and lip sync depend on.
 */
export function framesToSamples(
  frames: number,
  fps: Rational,
  sampleRate: number,
  mode: RoundingMode = "nearest",
): number {
  assertInteger(frames, "frames");
  const f = normalizeRational(fps);
  const samples = divide(BigInt(frames) * BigInt(f.den) * BigInt(sampleRate), BigInt(f.num), mode);
  return toSafeNumber(samples, "samples");
}

export function samplesToFrames(
  samples: number,
  fps: Rational,
  sampleRate: number,
  mode: RoundingMode = "nearest",
): number {
  assertInteger(samples, "samples");
  const f = normalizeRational(fps);
  const frames = divide(BigInt(samples) * BigInt(f.num), BigInt(f.den) * BigInt(sampleRate), mode);
  return toSafeNumber(frames, "frames");
}

/**
 * Display only. Never store this value, never compare against it, never send it
 * to a generator as timing truth.
 */
export function framesToDisplaySeconds(frames: number, fps: Rational): number {
  const f = normalizeRational(fps);
  return (frames * f.den) / f.num;
}

/**
 * Convert a user-facing duration in seconds into a whole number of frames.
 * This is the only place seconds are allowed to enter the system.
 */
export function secondsToFrames(seconds: number, fps: Rational, mode: RoundingMode = "nearest"): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`Duration must be a finite non-negative number, got ${seconds}`);
  }
  const f = normalizeRational(fps);
  // Route through microsecond ticks so float seconds are quantised exactly once.
  const ticks = BigInt(Math.round(seconds * Number(MASTER_TICKS_PER_SECOND)));
  const frames = divide(ticks * BigInt(f.num), MASTER_TICKS_PER_SECOND * BigInt(f.den), mode);
  return toSafeNumber(frames, "frames");
}

function assertInteger(value: number, what: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${what} must be an integer, got ${value}`);
  }
}

export const COMMON_FRAME_RATES = {
  "24": { num: 24, den: 1 },
  "25": { num: 25, den: 1 },
  "30": { num: 30, den: 1 },
  "50": { num: 50, den: 1 },
  "60": { num: 60, den: 1 },
  /** Broadcast-compatible drop rates, kept rational rather than 23.976. */
  "23.976": { num: 24000, den: 1001 },
  "29.97": { num: 30000, den: 1001 },
  "59.94": { num: 60000, den: 1001 },
} as const satisfies Record<string, Rational>;
