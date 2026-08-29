import { SkillRunResult } from "@videoai/contracts";
import type { SkillPackage } from "./package.js";
import { recordSkillRun } from "./registry.js";

/**
 * Skill execution contract (spec section 23).
 *
 * Every skill returns the same shape whatever it does, so the caller never
 * branches on which skill ran. Timeout and retry come from the skill's own
 * descriptor rather than the caller, because how long a skill needs is a
 * property of the skill.
 */

export type SkillHandler = (input: unknown) => Promise<unknown>;

export interface RunContext {
  organization_id?: string | null;
  job_id?: string | null;
  /** Set false in tests and tools that should not write run history. */
  record?: boolean;
}

export class SkillTimeoutError extends Error {
  constructor(skillId: string, seconds: number) {
    super(`Skill "${skillId}" exceeded its ${seconds}s timeout`);
    this.name = "SkillTimeoutError";
  }
}

export async function runSkill(
  skill: SkillPackage,
  handler: SkillHandler,
  input: unknown,
  context: RunContext = {},
): Promise<SkillRunResult> {
  const { timeout_seconds, max_retries } = skill.descriptor;
  const started = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= max_retries; attempt++) {
    try {
      const raw = await withTimeout(handler(input), timeout_seconds, skill.skill_id);
      // A skill that returns a malformed result is a failed skill, not a
      // successful one whose output the caller has to guess at.
      const parsed = SkillRunResult.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `returned a result that does not satisfy the skill contract: ` +
            parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
      }

      await record(skill, context, parsed.data.status, parsed.data.confidence, started, parsed.data);
      return parsed.data;
    } catch (error) {
      lastError = error;
      // A timeout will not resolve by trying again within the same budget.
      if (error instanceof SkillTimeoutError) break;
    }
  }

  const failure: SkillRunResult = {
    status: "error",
    confidence: 0,
    findings: [
      {
        code: "skill_error",
        severity: "high",
        message: `${skill.skill_id} ${(lastError as Error)?.message ?? "failed"}`,
        frames: [],
        entity_ref: null,
      },
    ],
    recommended_actions: [],
    metrics: {},
  };

  await record(skill, context, "error", 0, started, failure);
  return failure;
}

async function record(
  skill: SkillPackage,
  context: RunContext,
  status: SkillRunResult["status"],
  confidence: number,
  started: number,
  result: unknown,
): Promise<void> {
  if (context.record === false) return;
  await recordSkillRun({
    organization_id: context.organization_id ?? null,
    job_id: context.job_id ?? null,
    skill_id: skill.skill_id,
    skill_version: skill.descriptor.version,
    status,
    confidence,
    latency_ms: Date.now() - started,
    result,
  });
}

function withTimeout<T>(promise: Promise<T>, seconds: number, skillId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SkillTimeoutError(skillId, seconds)), seconds * 1000);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
