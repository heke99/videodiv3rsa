import { describe, expect, it } from "vitest";
import type { RetryBudget } from "@videoai/contracts";
import { budgetFor, checkBudget, idempotencyKey, spend, ZERO_SPEND } from "@videoai/orchestrator";

/**
 * Retry budgets are the thing standing between a bad shot and an unbounded
 * GPU bill (spec section 36), so what is tested here is that every dimension
 * actually stops the loop and that nothing silently exceeds a limit.
 */

const budget: RetryBudget = {
  max_generation_attempts: 3,
  max_repair_attempts: 2,
  max_gpu_seconds: 600,
  max_cost_units: 100,
};

describe("retry budget", () => {
  it("allows work while every dimension has room", () => {
    expect(checkBudget(budget, ZERO_SPEND).ok).toBe(true);
  });

  it("stops on generation attempts", () => {
    const check = checkBudget(budget, { ...ZERO_SPEND, generation_attempts: 3 });
    expect(check.ok).toBe(false);
    expect(check.dimension).toBe("generation_attempts");
  });

  it("stops on repair attempts", () => {
    expect(checkBudget(budget, { ...ZERO_SPEND, repair_attempts: 2 }).dimension).toBe("repair_attempts");
  });

  it("stops on GPU seconds even when attempts remain", () => {
    // An expensive first attempt must end the loop; attempts alone are not a
    // sufficient bound when one shot can cost ten minutes.
    const check = checkBudget(budget, { ...ZERO_SPEND, generation_attempts: 1, gpu_seconds: 700 });
    expect(check.ok).toBe(false);
    expect(check.dimension).toBe("gpu_seconds");
  });

  it("stops on cost units", () => {
    expect(checkBudget(budget, { ...ZERO_SPEND, cost_units: 100 }).dimension).toBe("cost_units");
  });

  it("reports the first dimension that ran out, so the reason is specific", () => {
    const check = checkBudget(budget, {
      generation_attempts: 5,
      repair_attempts: 5,
      gpu_seconds: 5000,
      cost_units: 5000,
    });
    expect(check.dimension).toBe("generation_attempts");
    expect(check.limit).toBe(3);
    expect(check.spent).toBe(5);
  });
});

describe("spend accumulation", () => {
  it("adds only the dimensions given", () => {
    const after = spend(ZERO_SPEND, { gpu_seconds: 12.5, generation_attempts: 1 });
    expect(after).toEqual({
      generation_attempts: 1,
      repair_attempts: 0,
      gpu_seconds: 12.5,
      cost_units: 0,
    });
  });

  it("accumulates across calls", () => {
    const a = spend(ZERO_SPEND, { gpu_seconds: 10, cost_units: 4 });
    const b = spend(a, { gpu_seconds: 15, repair_attempts: 1 });
    expect(b.gpu_seconds).toBe(25);
    expect(b.cost_units).toBe(4);
    expect(b.repair_attempts).toBe(1);
  });
});

describe("budget defaults per quality mode", () => {
  it("gives preview a single attempt and no repairs", () => {
    const preview = budgetFor("PREVIEW");
    expect(preview.max_generation_attempts).toBe(1);
    expect(preview.max_repair_attempts).toBe(0);
  });

  it("gives ultra more attempts and QC rather than a different model", () => {
    const ultra = budgetFor("ULTRA");
    const standard = budgetFor("STANDARD");
    expect(ultra.max_generation_attempts).toBeGreaterThan(standard.max_generation_attempts);
    expect(ultra.max_repair_attempts).toBeGreaterThan(standard.max_repair_attempts);
    expect(ultra.max_gpu_seconds).toBeGreaterThan(standard.max_gpu_seconds);
  });

  it("falls back to standard for an unknown mode rather than an unbounded one", () => {
    expect(budgetFor("SOMETHING_NEW")).toEqual(budgetFor("STANDARD"));
  });
});

describe("idempotency keys", () => {
  const base = {
    job_id: "job-1",
    shot_id: "shot_03",
    attempt: 1,
    model_id: "wan2.2-i2v-a14b",
    model_version: "2.2.0",
    prompt_hash: "abc",
  };

  it("is stable for identical work, so a replay reuses the first result", () => {
    expect(idempotencyKey(base)).toBe(idempotencyKey({ ...base }));
  });

  it("changes on a new attempt, so a real regeneration is not deduplicated", () => {
    expect(idempotencyKey({ ...base, attempt: 2 })).not.toBe(idempotencyKey(base));
  });

  it("changes when the prompt changes, so a repaired prompt regenerates", () => {
    expect(idempotencyKey({ ...base, prompt_hash: "def" })).not.toBe(idempotencyKey(base));
  });

  it("changes when the model version changes", () => {
    expect(idempotencyKey({ ...base, model_version: "2.3.0" })).not.toBe(idempotencyKey(base));
  });

  it("differs between shots in the same job", () => {
    expect(idempotencyKey({ ...base, shot_id: "shot_04" })).not.toBe(idempotencyKey(base));
  });
});
