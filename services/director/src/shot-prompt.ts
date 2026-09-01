import { createHash } from "node:crypto";
import type { Character, Location, Product, SceneBible, Shot } from "@videoai/contracts";
import { composeInstructions, selectSkills, type SkillPackage } from "@videoai/skills";

/**
 * The prompt a generation model is actually given (spec sections 21, 22, 64).
 *
 * Deterministic assembly, with no model call in it, for three reasons that all
 * point the same way. The Scene Bible's descriptions have to reach the model
 * word for word, or the same character comes out as a different person in shot
 * four. `GenerationProvenance` records the prompt and the skill versions
 * so a frame can be reproduced, which a model in this path would break. And a
 * reasoning call before every shot is latency spent on something the skills
 * already specify.
 *
 * The Director does rewrite a prompt -- on `prompt_repair`, after QC has said
 * what went wrong. That is where judgement belongs, and it is already wired.
 */

export interface ShotPromptInput {
  shot: Shot;
  bible: SceneBible;
  quality_mode: string;
  /** Skills the routing decision named for this model. */
  required_skills?: string[];
  skills?: Map<string, SkillPackage>;
  /**
   * Stable per unit of work. The seed derives from it, so a replayed activity
   * reproduces the same frame and a genuine regeneration produces a new one.
   */
  idempotency_key: string;
}

export interface ShotPrompt {
  prompt: string;
  negative_prompt: string;
  seed: number;
  /** Which skill versions shaped this, recorded in provenance. */
  skill_versions: Record<string, string>;
}

/**
 * Things we always say we do not want.
 *
 * Kept short and concrete. A negative prompt that lists forty adjectives stops
 * steering anything, and the model-specific ones belong in the skill packages
 * where they can be versioned per family.
 */
const BASE_NEGATIVE = [
  "extra fingers",
  "deformed hands",
  "warped face",
  "text artefacts",
  "watermark",
  "duplicated limbs",
  "flickering",
];

export function compileShotPrompt(input: ShotPromptInput): ShotPrompt {
  const { shot, bible } = input;

  const selected = input.skills
    ? selectSkills(
        {
          quality_mode: input.quality_mode,
          generation_kind: shot.preferred_generation_kind,
          required: input.required_skills,
          has_dialogue: shot.dialogue_line_ids.length > 0,
          has_humans: shot.character_ids.length > 0,
          has_product: shot.product_ids.length > 0,
          requires_identity_lock: shot.requires_identity_lock,
        },
        input.skills,
      )
    : [];

  const sections: string[] = [];

  // The action first: it is what the shot is, and a model reading a long
  // preamble before the subject weights the preamble.
  sections.push(shot.description.trim());
  sections.push(shot.action.trim());

  for (const character of bible.characters.filter((c) => shot.character_ids.includes(c.id))) {
    sections.push(describeCharacter(character));
  }
  for (const product of bible.products.filter((p) => shot.product_ids.includes(p.id))) {
    sections.push(describeProduct(product));
  }
  const location = bible.locations.find((l) => l.id === shot.location_id);
  if (location) sections.push(describeLocation(location));

  sections.push(describeCamera(shot));
  sections.push(describeStyle(bible.style));

  // Skill guidance last: it shapes how the above is rendered rather than what
  // is in the shot, and putting it first would bury the subject.
  const instructions = composeInstructions(selected);
  if (instructions) sections.push(instructions);

  const negatives = [...BASE_NEGATIVE];
  if (shot.requires_product_fidelity) {
    negatives.push("altered packaging", "misspelled brand text", "changed logo");
  }
  if (shot.requires_identity_lock) {
    negatives.push("different face", "changed hairline", "altered eye colour");
  }

  return {
    prompt: sections.filter((s) => s.trim().length > 0).join("\n\n"),
    negative_prompt: negatives.join(", "),
    seed: seedFrom(input.idempotency_key),
    skill_versions: Object.fromEntries(selected.map((s) => [s.skill_id, s.descriptor.version])),
  };
}

/**
 * A seed the same work always produces and different work never does.
 *
 * Taken from the idempotency key, which already covers the job, shot, attempt,
 * model and prompt hash. Truncated to 31 bits because model runtimes differ on
 * what they accept and every one of them takes a positive 32-bit integer.
 */
export function seedFrom(idempotencyKey: string): number {
  const digest = createHash("sha256").update(idempotencyKey).digest();
  return digest.readUInt32BE(0) & 0x7fffffff;
}

function describeCharacter(character: Character): string {
  // The Scene Bible's own words verbatim, then the appearance fields, because
  // repeating them identically is what keeps a character the same person from
  // shot to shot (spec section 12).
  const parts = [
    label(character.label, character.notes),
    joinNonEmpty([
      character.appearance.hair && `hair ${character.appearance.hair}`,
      character.appearance.eyes && `eyes ${character.appearance.eyes}`,
      character.appearance.skin && `skin ${character.appearance.skin}`,
      character.appearance.build && `build ${character.appearance.build}`,
      ...character.appearance.distinctive_features,
    ]),
    joinNonEmpty([character.wardrobe.clothes, character.wardrobe.shoes, ...character.wardrobe.accessories]),
    // What the pipeline is forbidden to drift on, said to the model rather than
    // only checked afterwards by a judge that cannot run yet.
    unchanging(character.forbidden_changes),
  ];
  return parts.filter(Boolean).join(". ");
}

function describeProduct(product: Product): string {
  return [
    label(product.label, product.notes),
    joinNonEmpty([product.physical.material, product.physical.shape, product.physical.colors.join(" and ")]),
    // On-pack text is quoted so a model treats it as a string to render rather
    // than as more description; product QC checks it survives.
    product.branding.on_pack_text.length > 0
      ? `packaging reads ${product.branding.on_pack_text.map((t) => `"${t}"`).join(", ")}`
      : "",
    joinNonEmpty(product.critical_features),
    unchanging(product.forbidden_changes),
  ]
    .filter(Boolean)
    .join(". ");
}

function describeLocation(location: Location): string {
  return [
    label(location.label, location.notes),
    joinNonEmpty([
      location.architecture,
      location.layout,
      location.lighting,
      location.time_of_day,
      location.weather,
      location.background,
      ...location.persistent_objects,
    ]),
    unchanging(location.forbidden_changes),
  ]
    .filter(Boolean)
    .join(". ");
}

function describeCamera(shot: Shot): string {
  return joinNonEmpty([
    shot.camera.framing && `${shot.camera.framing} shot`,
    shot.camera.lens,
    shot.camera.movement && `camera ${shot.camera.movement}`,
    shot.camera.height,
    shot.camera.focus_behavior,
  ]);
}

function describeStyle(style: SceneBible["style"]): string {
  return joinNonEmpty([
    style.camera_style,
    style.lens_language,
    style.lighting,
    style.exposure,
    style.contrast,
    style.grain,
    style.motion_style,
    style.color_grade,
    style.realism_profile,
  ]);
}

function label(name: string, notes: string): string {
  return notes.trim() ? `${name}: ${notes.trim()}` : name;
}

/** Attributes the Scene Bible forbids drifting on, stated positively. */
function unchanging(forbidden: string[]): string {
  if (forbidden.length === 0) return "";
  return `keep unchanged: ${forbidden.join(", ")}`;
}

function joinNonEmpty(parts: Array<string | false | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(", ");
}
