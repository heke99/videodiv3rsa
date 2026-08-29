import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import { CreativeBrief } from "./brief.js";
import { SceneBible } from "./scene-bible.js";
import { Script, ShotPlan } from "./story.js";
import { RepairPlan } from "./quality.js";

/**
 * The Director is constrained by JSON Schema generated from the very same Zod
 * definitions we validate against, so the model's output format and our
 * runtime validation can never drift apart (spec section 9).
 */
export const DIRECTOR_OUTPUT_SCHEMAS: Record<string, ZodTypeAny> = {
  creative_brief: CreativeBrief,
  scene_bible: SceneBible,
  script: Script,
  shot_plan: ShotPlan,
  repair_plan: RepairPlan,
};

export type DirectorOutputName = keyof typeof DIRECTOR_OUTPUT_SCHEMAS;

export function directorJsonSchema(name: string): object {
  const schema = DIRECTOR_OUTPUT_SCHEMAS[name];
  if (!schema) {
    throw new Error(
      `Unknown Director output schema "${name}". Known: ${Object.keys(DIRECTOR_OUTPUT_SCHEMAS).join(", ")}`,
    );
  }
  return zodToJsonSchema(schema, { name, target: "jsonSchema7" });
}
