import type { SkillPackage } from "./package.js";

/**
 * Skill dependency resolution (spec section 107).
 *
 * Skills require other skills: a UGC director is meaningless without a script,
 * a creator persona and mobile camera behaviour. Resolving that graph here
 * means a caller asks for one skill and gets a coherent set, in an order where
 * nothing runs before what it depends on.
 */

export class SkillCycleError extends Error {
  constructor(readonly cycle: string[]) {
    super(
      `Skill dependencies form a cycle: ${cycle.join(" -> ")}. ` +
        `A skill cannot require something that requires it back.`,
    );
    this.name = "SkillCycleError";
  }
}

export class MissingSkillError extends Error {
  constructor(
    readonly skillId: string,
    readonly requiredBy: string,
  ) {
    super(`Skill "${requiredBy}" requires "${skillId}", which is not registered.`);
    this.name = "MissingSkillError";
  }
}

/**
 * Expand a set of requested skills to include everything they depend on,
 * ordered so dependencies come first.
 *
 * A draft dependency is a hard error rather than a silent omission: a skill
 * running without something it declared it needs produces output that looks
 * fine and is subtly wrong, which is the worst failure mode available.
 */
export function resolveSkills(
  requested: string[],
  available: Map<string, SkillPackage>,
): SkillPackage[] {
  const ordered: SkillPackage[] = [];
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  function visit(skillId: string, requiredBy: string): void {
    const current = state.get(skillId);
    if (current === "done") return;
    if (current === "visiting") {
      throw new SkillCycleError([...path.slice(path.indexOf(skillId)), skillId]);
    }

    const skill = available.get(skillId);
    if (!skill) throw new MissingSkillError(skillId, requiredBy);

    state.set(skillId, "visiting");
    path.push(skillId);

    for (const dependency of skill.descriptor.requires_skills) {
      visit(dependency, skillId);
    }

    path.pop();
    state.set(skillId, "done");
    ordered.push(skill);
  }

  for (const skillId of requested) visit(skillId, "(requested)");
  return ordered;
}

/** Skills that would be affected by changing this one. */
export function dependents(skillId: string, available: Map<string, SkillPackage>): string[] {
  const affected = new Set<string>();
  const queue = [skillId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [id, skill] of available) {
      if (affected.has(id)) continue;
      if (skill.descriptor.requires_skills.includes(current)) {
        affected.add(id);
        queue.push(id);
      }
    }
  }

  return [...affected].sort();
}
