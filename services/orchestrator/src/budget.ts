import type { BudgetSpend, RetryBudget } from "@videoai/contracts";

/**
 * Retry budgets (spec section 36).
 *
 * No regeneration loop may be unbounded. When a budget is exhausted the job
 * becomes needs_review, which is a worse outcome for the user than a good
 * video and a far better one than an invisible pile of GPU spend.
 */

export class BudgetExhaustedError extends Error {
  constructor(
    readonly dimension: keyof BudgetSpend,
    readonly limit: number,
    readonly spent: number,
  ) {
    super(
      `Retry budget exhausted on ${dimension}: spent ${spent} against a limit of ${limit}. ` +
        `Handing this to review rather than retrying again.`,
    );
    this.name = "BudgetExhaustedError";
  }
}

export interface BudgetCheck {
  ok: boolean;
  dimension?: keyof BudgetSpend;
  limit?: number;
  spent?: number;
}

export function checkBudget(budget: RetryBudget, spend: BudgetSpend): BudgetCheck {
  const limits: Array<[keyof BudgetSpend, number, number]> = [
    ["generation_attempts", budget.max_generation_attempts, spend.generation_attempts],
    ["repair_attempts", budget.max_repair_attempts, spend.repair_attempts],
    ["gpu_seconds", budget.max_gpu_seconds, spend.gpu_seconds],
    ["cost_units", budget.max_cost_units, spend.cost_units],
  ];

  for (const [dimension, limit, spent] of limits) {
    if (spent >= limit) return { ok: false, dimension, limit, spent };
  }
  return { ok: true };
}

export function spend(current: BudgetSpend, delta: Partial<BudgetSpend>): BudgetSpend {
  return {
    generation_attempts: current.generation_attempts + (delta.generation_attempts ?? 0),
    repair_attempts: current.repair_attempts + (delta.repair_attempts ?? 0),
    gpu_seconds: current.gpu_seconds + (delta.gpu_seconds ?? 0),
    cost_units: current.cost_units + (delta.cost_units ?? 0),
  };
}

/**
 * Default budgets per quality mode. Ultra buys more attempts and more QC, not
 * a different model (spec section 44).
 */
export const DEFAULT_BUDGETS: Record<string, RetryBudget> = {
  PREVIEW: { max_generation_attempts: 1, max_repair_attempts: 0, max_gpu_seconds: 300, max_cost_units: 50 },
  STANDARD: {
    max_generation_attempts: 3,
    max_repair_attempts: 2,
    max_gpu_seconds: 3600,
    max_cost_units: 500,
  },
  REALISTIC: {
    max_generation_attempts: 4,
    max_repair_attempts: 3,
    max_gpu_seconds: 5400,
    max_cost_units: 800,
  },
  UGC: { max_generation_attempts: 3, max_repair_attempts: 2, max_gpu_seconds: 3600, max_cost_units: 500 },
  CINEMATIC: {
    max_generation_attempts: 4,
    max_repair_attempts: 3,
    max_gpu_seconds: 7200,
    max_cost_units: 1000,
  },
  PRODUCT: { max_generation_attempts: 4, max_repair_attempts: 3, max_gpu_seconds: 5400, max_cost_units: 800 },
  AVATAR: { max_generation_attempts: 3, max_repair_attempts: 3, max_gpu_seconds: 3600, max_cost_units: 600 },
  ULTRA: {
    max_generation_attempts: 6,
    max_repair_attempts: 4,
    max_gpu_seconds: 14_400,
    max_cost_units: 2000,
  },
};

export function budgetFor(qualityMode: string): RetryBudget {
  return DEFAULT_BUDGETS[qualityMode] ?? DEFAULT_BUDGETS["STANDARD"]!;
}

export const ZERO_SPEND: BudgetSpend = {
  generation_attempts: 0,
  repair_attempts: 0,
  gpu_seconds: 0,
  cost_units: 0,
};
