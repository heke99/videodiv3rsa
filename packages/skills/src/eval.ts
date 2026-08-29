import { queryOne } from "@videoai/database";
import type { SkillPackage } from "./package.js";

/**
 * Skill evaluation and promotion (spec section 86).
 *
 * Version 1.4 does not replace 1.3 because it is newer. It replaces it when an
 * eval says it is better and nothing else got worse. Without this, a skill
 * catalogue drifts: every edit feels like an improvement, and quality quietly
 * declines while the version numbers climb.
 */

export interface EvalCase {
  id: string;
  input: unknown;
  /** What a passing result looks like. */
  expect: Record<string, unknown>;
}

export interface EvalOutcome {
  case_id: string;
  passed: boolean;
  score: number;
  detail: string;
}

export interface EvalReport {
  skill_id: string;
  version: string;
  suite: string;
  outcomes: EvalOutcome[];
  score: number;
  /** Averages over the suite, compared against the incumbent on promotion. */
  latency_ms: number;
  retries: number;
  gpu_seconds: number;
}

/**
 * Parse cases out of EVAL.md.
 *
 * Cases live in fenced json blocks so the file stays readable as prose: the
 * surrounding text explains what the skill is supposed to get right, which is
 * the part a person needs when the eval fails.
 */
export function parseEvalCases(markdown: string): EvalCase[] {
  const blocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/g)];
  const cases: EvalCase[] = [];

  for (const [index, block] of blocks.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1]!);
    } catch {
      throw new Error(`EVAL.md case block ${index + 1} is not valid JSON`);
    }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      const c = entry as Partial<EvalCase>;
      if (!c.id || c.input === undefined || !c.expect) {
        throw new Error(`EVAL.md case block ${index + 1} needs id, input and expect`);
      }
      cases.push(c as EvalCase);
    }
  }

  return cases;
}

export interface PromotionDecision {
  promote: boolean;
  reasons: string[];
}

/**
 * Whether a candidate version should replace the incumbent.
 *
 * Quality has to improve, and cost must not regress meaningfully. The
 * tolerances are deliberately asymmetric: a small quality gain that costs 40%
 * more latency is not an improvement to ship, but a large quality gain that
 * costs a little is.
 */
export function shouldPromote(
  candidate: EvalReport,
  incumbent: EvalReport | null,
  tolerance = { latency: 0.2, gpu: 0.2, retries: 0.1 },
): PromotionDecision {
  const reasons: string[] = [];

  if (!incumbent) {
    // Nothing to compare against, so the bar is simply that the eval passes.
    const ok = candidate.score >= 0.8;
    return {
      promote: ok,
      reasons: [
        ok
          ? `First version; eval scored ${candidate.score.toFixed(2)}.`
          : `First version scored ${candidate.score.toFixed(2)}, below the 0.80 bar.`,
      ],
    };
  }

  if (candidate.score <= incumbent.score) {
    reasons.push(
      `Quality did not improve: ${candidate.score.toFixed(2)} against ` +
        `${incumbent.score.toFixed(2)}.`,
    );
  }

  const regression = (now: number, before: number, allowed: number, label: string) => {
    if (before <= 0) return;
    const delta = (now - before) / before;
    if (delta > allowed) {
      reasons.push(
        `${label} regressed by ${(delta * 100).toFixed(0)}%, over the ` +
          `${(allowed * 100).toFixed(0)}% allowance.`,
      );
    }
  };

  regression(candidate.latency_ms, incumbent.latency_ms, tolerance.latency, "Latency");
  regression(candidate.gpu_seconds, incumbent.gpu_seconds, tolerance.gpu, "GPU time");
  regression(candidate.retries, incumbent.retries, tolerance.retries, "Retry rate");

  return {
    promote: reasons.length === 0,
    reasons: reasons.length === 0
      ? [
          `Quality improved from ${incumbent.score.toFixed(2)} to ` +
            `${candidate.score.toFixed(2)} with no cost regression.`,
        ]
      : reasons,
  };
}

export async function recordEvaluation(report: EvalReport, passed: boolean): Promise<void> {
  await queryOne(
    `insert into public.skill_evaluations
       (skill_id, skill_version, suite, score, retry_delta, latency_delta_ms, gpu_delta_seconds, passed)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [report.skill_id, report.version, report.suite, report.score,
     report.retries, report.latency_ms, report.gpu_seconds, passed],
  );
}

/** Cases for a package, or none if it has no eval yet. */
export function evalCasesFor(skill: SkillPackage): EvalCase[] {
  return skill.eval ? parseEvalCases(skill.eval) : [];
}
