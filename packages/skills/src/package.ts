import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { SkillDescriptor } from "@videoai/contracts";

/**
 * Skill packages (spec section 22).
 *
 * A skill is a directory, not a long prompt string. Making it a versioned
 * package with a schema, tests and an eval is what lets a skill be changed
 * deliberately: you can see what a version altered, measure whether it helped,
 * and roll it back if it did not.
 */

export const SKILL_FILE = "SKILL.md";
export const SCHEMA_FILE = "schema.json";
export const EVAL_FILE = "EVAL.md";

/**
 * Frontmatter is the descriptor. Everything the router and the registry need
 * is here, so neither has to read the body.
 */
export const SkillFrontmatter = SkillDescriptor.omit({ skill_id: true }).extend({
  skill_id: z.string().optional(),
  /** Quality modes this skill applies to. Empty means all of them. */
  modes: z.array(z.string()).default([]),
  /** Generation kinds this skill applies to. Empty means all of them. */
  generation_kinds: z.array(z.string()).default([]),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>;

export interface SkillPackage {
  skill_id: string;
  directory: string;
  descriptor: SkillDescriptor & { modes: string[]; generation_kinds: string[] };
  /** The instruction body, without frontmatter. This is what reaches a model. */
  body: string;
  input_schema: object | null;
  output_schema: object | null;
  /** Eval cases, deliberately kept out of runtime context. */
  eval: string | null;
  package_hash: string;
}

export class SkillPackageError extends Error {
  constructor(directory: string, message: string) {
    super(`${directory}: ${message}`);
    this.name = "SkillPackageError";
  }
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export async function loadSkillPackage(directory: string): Promise<SkillPackage> {
  const skillPath = path.join(directory, SKILL_FILE);
  let raw: string;
  try {
    raw = await readFile(skillPath, "utf8");
  } catch {
    throw new SkillPackageError(directory, `missing ${SKILL_FILE}`);
  }

  const match = FRONTMATTER.exec(raw);
  if (!match) {
    throw new SkillPackageError(directory, `${SKILL_FILE} has no YAML frontmatter`);
  }

  const parsed = SkillFrontmatter.safeParse(parseYaml(match[1]!));
  if (!parsed.success) {
    throw new SkillPackageError(
      directory,
      `frontmatter is invalid:\n${parsed.error.issues.map((i) => `    ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }

  const skillId = parsed.data.skill_id ?? path.basename(directory);
  const body = raw.slice(match[0].length).trim();

  // An active skill with no body would be a skill that claims to do something
  // and does nothing. Catching it here rather than at runtime is the point.
  if (parsed.data.status === "active" && body.length < 40) {
    throw new SkillPackageError(
      directory,
      "is active but has no meaningful content; mark it draft until it is written",
    );
  }

  const inputSchema = await readJson(path.join(directory, SCHEMA_FILE));
  const evalDoc = await readIfPresent(path.join(directory, EVAL_FILE));

  return {
    skill_id: skillId,
    directory,
    descriptor: { ...parsed.data, skill_id: skillId },
    body,
    input_schema: inputSchema?.["input"] ?? inputSchema ?? null,
    output_schema: inputSchema?.["output"] ?? null,
    eval: evalDoc,
    package_hash: await hashDirectory(directory),
  };
}

/**
 * Hash every file in the package except the eval.
 *
 * The eval is excluded on purpose: adding test cases is not a change to the
 * skill's behaviour, and treating it as one would force a version bump every
 * time coverage improved.
 */
export async function hashDirectory(directory: string): Promise<string> {
  const files = await collectFiles(directory);
  const hash = createHash("sha256");

  for (const file of files.sort()) {
    if (path.basename(file) === EVAL_FILE) continue;
    hash.update(path.relative(directory, file));
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

async function collectFiles(directory: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(full, out);
    else out.push(full);
  }
  return out;
}

/** Every skill package under a root, discovered by the presence of SKILL.md. */
export async function discoverSkillPackages(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === SKILL_FILE)) {
      found.push(directory);
      return; // Skills do not nest.
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(directory, entry.name));
    }
  }

  await walk(root);
  return found.sort();
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    await stat(file);
  } catch {
    return null;
  }
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}
