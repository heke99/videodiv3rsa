import { describe, expect, it } from "vitest";
import {
  COMMON_FRAME_RATES,
  framesToDisplaySeconds,
  framesToSamples,
  framesToTicks,
  samplesToFrames,
  secondsToFrames,
  ticksToFrames,
} from "@videoai/timeline";

/**
 * The timebase is the one thing every model has to agree on, so these tests
 * assert exactness rather than closeness (spec section 18).
 */

describe("rational timebase", () => {
  it("round-trips frames through ticks with no drift at 24 fps", () => {
    const fps = COMMON_FRAME_RATES["24"];
    for (const frames of [0, 1, 24, 1000, 86_400]) {
      expect(ticksToFrames(framesToTicks(frames, fps), fps)).toBe(frames);
    }
  });

  it("round-trips frames through ticks at broadcast 23.976", () => {
    const fps = COMMON_FRAME_RATES["23.976"];
    // 1001/24000 does not divide evenly into microseconds, which is exactly the
    // case where float seconds accumulate error.
    for (const frames of [1, 7, 24, 2999, 100_000]) {
      expect(ticksToFrames(framesToTicks(frames, fps), fps)).toBe(frames);
    }
  });

  it("converts frames to samples exactly at 24 fps / 48 kHz", () => {
    const fps = COMMON_FRAME_RATES["24"];
    expect(framesToSamples(1, fps, 48_000)).toBe(2000);
    expect(framesToSamples(24, fps, 48_000)).toBe(48_000);
    expect(framesToSamples(720, fps, 48_000)).toBe(1_440_000);
  });

  it("round-trips frames through samples at 29.97", () => {
    const fps = COMMON_FRAME_RATES["29.97"];
    for (const frames of [1, 30, 1798, 108_000]) {
      expect(samplesToFrames(framesToSamples(frames, fps, 48_000), fps, 48_000)).toBe(frames);
    }
  });

  it("stays exact over a long project where float seconds would drift", () => {
    const fps = COMMON_FRAME_RATES["23.976"];
    // Three hours. Accumulating 1/23.976 in floats loses whole samples here.
    const frames = 24 * 60 * 60 * 3;
    const samples = framesToSamples(frames, fps, 48_000);
    expect(samplesToFrames(samples, fps, 48_000)).toBe(frames);
    expect(Number.isInteger(samples)).toBe(true);
  });

  it("quantises a user's seconds to whole frames once, at the boundary", () => {
    const fps = COMMON_FRAME_RATES["24"];
    expect(secondsToFrames(30, fps)).toBe(720);
    expect(secondsToFrames(4.9999997, fps)).toBe(120);
    expect(Number.isInteger(secondsToFrames(7.3, fps))).toBe(true);
  });

  it("rejects non-integer frame positions rather than rounding silently", () => {
    const fps = COMMON_FRAME_RATES["24"];
    expect(() => framesToSamples(1.5, fps, 48_000)).toThrow(/must be an integer/);
  });

  it("exposes seconds only as a derived display value", () => {
    const fps = COMMON_FRAME_RATES["23.976"];
    // Deliberately not exact: this is why it is display-only.
    expect(framesToDisplaySeconds(24, fps)).toBeCloseTo(1.001, 6);
  });
});
