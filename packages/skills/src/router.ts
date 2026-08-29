import type { SkillPackage } from "./package.js";
import { resolveSkills } from "./graph.js";

/**
 * Skill routing (spec section 106).
 *
 * The catalogue has hundreds of skills and the Director's context has room for
 * a handful. Loading everything would not merely be wasteful; it would bury the
 * instructions that matter for this shot under instructions for shots that do
 * not exist. So the router selects, and the selection is narrow on purpose.
 */

export interface SkillSelection {
  quality_mode: string;
  generation_kind?: string | null;
  /** Skills the routing decision named. These are always included. */
  required?: string[];
  /** Shot characteristics that pull in specialist skills. */
  has_dialogue?: boolean;
  has_humans?: boolean;
  has_product?: boolean;
  requires_identity_lock?: boolean;
  /** Cap on how many skills reach the model at once. */
  limit?: number;
}

/** Skills that apply to every generation regardless of mode. */
const ALWAYS: string[] = ["prompt-normalizer", "negative-instruction-builder", "seed-planner"];

/** The spine of each quality mode, in the order they should be applied. */
const MODE_SKILLS: Record<string, string[]> = {
  PREVIEW: [],
  STANDARD: ["realism-director"],
  REALISTIC: ["realism-director", "anti-ai-look", "natural-motion", "practical-lighting"],
  UGC: ["ugc-director", "creator-persona", "mobile-camera", "natural-speech", "informal-pacing"],
  CINEMATIC: ["camera-director", "lens-director", "lighting-director", "composition-director", "color-director"],
  PRODUCT: ["product-identity", "product-logo-preservation", "product-text-preservation", "product-handling"],
  AVATAR: ["creator-eye-contact", "facial-expression", "lip-sync-planner"],
  ULTRA: ["realism-director", "anti-ai-look", "natural-motion", "practical-lighting", "camera-director"],
};

/** Specialists pulled in by what the shot actually contains. */
const CONDITIONAL: Array<{ when: (s: SkillSelection) => boolean; skills: string[] }> = [
  { when: (s) => Boolean(s.requires_identity_lock), skills: ["character-identity-lock", "face-consistency"] },
  { when: (s) => Boolean(s.has_product), skills: ["product-identity", "product-logo-preservation"] },
  { when: (s) => Boolean(s.has_dialogue), skills: ["speech-director", "dialogue-timing"] },
  { when: (s) => Boolean(s.has_humans), skills: ["human-motion-director", "body-language"] },
];

export function selectSkills(
  selection: SkillSelection,
  available: Map<string, SkillPackage>,
): SkillPackage[] {
  const conditional = CONDITIONAL.filter((c) => c.when(selection)).flatMap((c) => c.skills);
  const wanted: string[] = [
    ...ALWAYS,
    ...(MODE_SKILLS[selection.quality_mode] ?? MODE_SKILLS["STANDARD"]!),
    ...conditional,
    ...(selection.required ?? []),
  ];

  // Only skills that exist and are active can be selected. A draft skill is
  // registered so the catalogue is complete, but it must never reach a model.
  const selectable = new Map(
    [...available].filter(([, skill]) => skill.descriptor.status === "active"),
  );

  const present = [...new Set(wanted)].filter((id) => {
    const skill = selectable.get(id);
    if (!skill) return false;
    return applies(skill, selection);
  });

  // Dependencies are resolved against active skills only, so a required
  // dependency that is still draft surfaces as an error rather than silently
  // dropping out of the set.
  const resolved = resolveSkills(present, selectable);

  const limit = selection.limit ?? 12;
  if (resolved.length <= limit) return resolved;

  // When over budget, keep what this shot specifically needs before what its
  // mode generally prefers: the skills the routing decision named, and the
  // specialists the shot's own contents pulled in. A dialogue shot that loses
  // its speech skills to five cinematography skills is the wrong trade, and it
  // is the trade a flat cut makes, because the mode spine comes first in order.
  const priorityIds = new Set([...(selection.required ?? []), ...conditional]);
  const priority = resolved.filter((s) => priorityIds.has(s.skill_id));
  const filler = resolved.filter((s) => !priorityIds.has(s.skill_id));
  return [...priority, ...filler].slice(0, limit);
}

function applies(skill: SkillPackage, selection: SkillSelection): boolean {
  const { modes, generation_kinds } = skill.descriptor;
  if (modes.length > 0 && !modes.includes(selection.quality_mode)) return false;
  if (
    generation_kinds.length > 0 &&
    selection.generation_kind &&
    !generation_kinds.includes(selection.generation_kind)
  ) {
    return false;
  }
  return true;
}

/**
 * The instruction text handed to the Director for a selection.
 *
 * Eval content is never included: it exists to test the skill, and putting
 * test cases in a production prompt teaches the model to reproduce them
 * (spec section 22).
 */
export function composeInstructions(skills: SkillPackage[]): string {
  return skills
    .map((skill) => `## ${skill.descriptor.name}\n\n${skill.body}`)
    .join("\n\n");
}
