import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MissingSkillError,
  SkillCycleError,
  SkillPackageError,
  composeInstructions,
  dependents,
  discoverSkillPackages,
  hashDirectory,
  loadCatalogue,
  loadSkillPackage,
  parseEvalCases,
  resolveSkills,
  runSkill,
  selectSkills,
  shouldPromote,
  type EvalReport,
  type SkillPackage,
} from "@videoai/skills";

/**
 * The skill engine and the catalogue it loads.
 *
 * Two things are being protected here. First, that a skill claiming to be
 * active actually contains guidance -- an empty active skill is worse than a
 * missing one, because the router will select it. Second, that the registry
 * cannot silently diverge from what is on disk.
 */

const CATALOGUE_ROOT = path.resolve(import.meta.dirname, "../../skills");

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "videoai-skill-"));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

function frontmatter(overrides: Record<string, unknown> = {}): string {
  const base = {
    name: "Test Skill",
    version: "1.0",
    category: "prompt",
    description: "A skill used in tests.",
    status: "active",
    requires_skills: [],
    modes: [],
    generation_kinds: [],
    ...overrides,
  };
  const lines = Object.entries(base).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n\nThis body is long enough to count as real content for the loader's check.\n`;
}

function pkg(id: string, overrides: Partial<SkillPackage["descriptor"]> = {}): SkillPackage {
  return {
    skill_id: id,
    directory: `/tmp/${id}`,
    descriptor: {
      skill_id: id,
      name: id,
      version: "1.0",
      category: "prompt",
      description: "d",
      required_tools: [],
      supported_models: [],
      requires_skills: [],
      quality_profile: "STANDARD",
      timeout_seconds: 30,
      max_retries: 1,
      license: "proprietary",
      status: "active",
      modes: [],
      generation_kinds: [],
      ...overrides,
    },
    body: `body for ${id}`,
    input_schema: null,
    output_schema: null,
    eval: null,
    package_hash: "0".repeat(64),
  };
}

describe("skill package loading", () => {
  it("reads the descriptor from frontmatter and the body separately", async () => {
    const dir = await fixture({ "SKILL.md": frontmatter({ name: "Camera Director" }) });
    const skill = await loadSkillPackage(dir);

    expect(skill.descriptor.name).toBe("Camera Director");
    expect(skill.body).not.toContain("---");
    expect(skill.body).toContain("long enough");
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a package with no frontmatter", async () => {
    const dir = await fixture({ "SKILL.md": "just a body, no descriptor" });
    await expect(loadSkillPackage(dir)).rejects.toThrow(SkillPackageError);
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses an active skill with no meaningful content", async () => {
    // This is the failure the check exists for: a skill the router will select
    // that has nothing to say.
    const dir = await fixture({
      "SKILL.md": `---\nname: "Empty"\nversion: "1.0"\ncategory: "prompt"\ndescription: "d"\nstatus: "active"\n---\n\nTODO\n`,
    });
    await expect(loadSkillPackage(dir)).rejects.toThrow(/active but has no meaningful content/);
    await rm(dir, { recursive: true, force: true });
  });

  it("allows a draft skill to be a placeholder", async () => {
    const dir = await fixture({
      "SKILL.md": `---\nname: "Later"\nversion: "1.0"\ncategory: "prompt"\ndescription: "d"\nstatus: "draft"\n---\n\nTODO\n`,
    });
    await expect(loadSkillPackage(dir)).resolves.toBeTruthy();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("package hashing", () => {
  it("changes when the body changes", async () => {
    const a = await fixture({ "SKILL.md": frontmatter() });
    const before = await hashDirectory(a);
    await writeFile(path.join(a, "SKILL.md"), frontmatter() + "\nAn extra paragraph.\n");
    expect(await hashDirectory(a)).not.toBe(before);
    await rm(a, { recursive: true, force: true });
  });

  it("does not change when only the eval changes", async () => {
    // Adding test cases is not a behaviour change, and forcing a version bump
    // for it would discourage improving coverage.
    const dir = await fixture({ "SKILL.md": frontmatter(), "EVAL.md": "# Eval\n" });
    const before = await hashDirectory(dir);
    await writeFile(path.join(dir, "EVAL.md"), "# Eval\n\nMore cases.\n");
    expect(await hashDirectory(dir)).toBe(before);
    await rm(dir, { recursive: true, force: true });
  });

  it("changes when a reference file changes", async () => {
    const dir = await fixture({ "SKILL.md": frontmatter(), "references/a.md": "one" });
    const before = await hashDirectory(dir);
    await writeFile(path.join(dir, "references/a.md"), "two");
    expect(await hashDirectory(dir)).not.toBe(before);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("dependency resolution", () => {
  it("orders dependencies before the skills that need them", () => {
    const available = new Map([
      ["a", pkg("a", { requires_skills: ["b"] })],
      ["b", pkg("b", { requires_skills: ["c"] })],
      ["c", pkg("c")],
    ]);
    expect(resolveSkills(["a"], available).map((s) => s.skill_id)).toEqual(["c", "b", "a"]);
  });

  it("includes each skill once even when several require it", () => {
    const available = new Map([
      ["a", pkg("a", { requires_skills: ["c"] })],
      ["b", pkg("b", { requires_skills: ["c"] })],
      ["c", pkg("c")],
    ]);
    const ids = resolveSkills(["a", "b"], available).map((s) => s.skill_id);
    expect(ids.filter((i) => i === "c")).toHaveLength(1);
  });

  it("detects a cycle rather than looping", () => {
    const available = new Map([
      ["a", pkg("a", { requires_skills: ["b"] })],
      ["b", pkg("b", { requires_skills: ["a"] })],
    ]);
    expect(() => resolveSkills(["a"], available)).toThrow(SkillCycleError);
  });

  it("reports a missing dependency by name and by who required it", () => {
    const available = new Map([["a", pkg("a", { requires_skills: ["absent"] })]]);
    expect(() => resolveSkills(["a"], available)).toThrow(MissingSkillError);
    expect(() => resolveSkills(["a"], available)).toThrow(/"a" requires "absent"/);
  });

  it("finds what a change to one skill would affect", () => {
    const available = new Map([
      ["base", pkg("base")],
      ["mid", pkg("mid", { requires_skills: ["base"] })],
      ["top", pkg("top", { requires_skills: ["mid"] })],
      ["other", pkg("other")],
    ]);
    expect(dependents("base", available)).toEqual(["mid", "top"]);
  });
});

describe("skill routing", () => {
  const catalogue = new Map([
    ["prompt-normalizer", pkg("prompt-normalizer")],
    ["negative-instruction-builder", pkg("negative-instruction-builder")],
    ["seed-planner", pkg("seed-planner")],
    ["ugc-director", pkg("ugc-director")],
    ["creator-persona", pkg("creator-persona")],
    ["mobile-camera", pkg("mobile-camera")],
    ["natural-speech", pkg("natural-speech")],
    ["informal-pacing", pkg("informal-pacing")],
    ["camera-director", pkg("camera-director")],
    ["lens-director", pkg("lens-director")],
    ["lighting-director", pkg("lighting-director")],
    ["composition-director", pkg("composition-director")],
    ["color-director", pkg("color-director")],
    ["character-identity-lock", pkg("character-identity-lock")],
    ["face-consistency", pkg("face-consistency")],
    ["speech-director", pkg("speech-director")],
    ["dialogue-timing", pkg("dialogue-timing")],
    ["unwritten", pkg("unwritten", { status: "draft" })],
  ]);

  it("selects the UGC spine for a UGC shot", () => {
    const ids = selectSkills({ quality_mode: "UGC" }, catalogue).map((s) => s.skill_id);
    expect(ids).toContain("ugc-director");
    expect(ids).toContain("mobile-camera");
    expect(ids).not.toContain("camera-director");
  });

  it("selects the cinematic spine for a cinematic shot", () => {
    const ids = selectSkills({ quality_mode: "CINEMATIC" }, catalogue).map((s) => s.skill_id);
    expect(ids).toContain("lighting-director");
    expect(ids).not.toContain("ugc-director");
  });

  it("pulls in identity skills only when the shot locks identity", () => {
    const without = selectSkills({ quality_mode: "STANDARD" }, catalogue).map((s) => s.skill_id);
    const with_ = selectSkills(
      { quality_mode: "STANDARD", requires_identity_lock: true },
      catalogue,
    ).map((s) => s.skill_id);

    expect(without).not.toContain("character-identity-lock");
    expect(with_).toContain("character-identity-lock");
  });

  it("never selects a draft skill", () => {
    const ids = selectSkills({ quality_mode: "UGC", required: ["unwritten"] }, catalogue).map(
      (s) => s.skill_id,
    );
    expect(ids).not.toContain("unwritten");
  });

  it("always includes the skills that apply to every generation", () => {
    const ids = selectSkills({ quality_mode: "PREVIEW" }, catalogue).map((s) => s.skill_id);
    expect(ids).toContain("prompt-normalizer");
  });

  it("caps the number of skills so the context stays usable", () => {
    expect(selectSkills({ quality_mode: "UGC", limit: 4 }, catalogue)).toHaveLength(4);
  });

  it("keeps explicitly required skills when over the cap", () => {
    const ids = selectSkills(
      { quality_mode: "UGC", required: ["face-consistency"], limit: 3 },
      catalogue,
    ).map((s) => s.skill_id);
    expect(ids).toContain("face-consistency");
  });

  it("keeps the shot's own specialists over the mode's spine when over the cap", () => {
    // CINEMATIC brings five cinematography skills before any conditional is
    // considered, so a flat cut would drop the speech and identity skills a
    // dialogue shot with a locked face actually needs.
    const ids = selectSkills(
      {
        quality_mode: "CINEMATIC",
        has_dialogue: true,
        requires_identity_lock: true,
        limit: 6,
      },
      catalogue,
    ).map((s) => s.skill_id);

    expect(ids).toHaveLength(6);
    expect(ids).toContain("speech-director");
    expect(ids).toContain("character-identity-lock");
  });

  it("composes instructions without leaking eval content", () => {
    const withEval = { ...pkg("a"), eval: "# Eval\n\nsecret test cases" };
    const text = composeInstructions([withEval]);
    expect(text).toContain("body for a");
    expect(text).not.toContain("secret test cases");
  });
});

describe("skill execution contract", () => {
  const skill = pkg("test-skill", { timeout_seconds: 1, max_retries: 1 });

  it("returns the handler's result when it satisfies the contract", async () => {
    const result = await runSkill(
      skill,
      async () => ({ status: "pass", confidence: 0.9, findings: [], recommended_actions: [], metrics: {} }),
      {},
      { record: false },
    );
    expect(result.status).toBe("pass");
  });

  it("treats a malformed result as a failure rather than passing it on", async () => {
    const result = await runSkill(skill, async () => ({ nonsense: true }), {}, { record: false });
    expect(result.status).toBe("error");
    expect(result.findings[0]!.message).toContain("skill contract");
  });

  it("retries a failing handler within its budget", async () => {
    let calls = 0;
    const result = await runSkill(
      skill,
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return { status: "pass", confidence: 1, findings: [], recommended_actions: [], metrics: {} };
      },
      {},
      { record: false },
    );
    expect(calls).toBe(2);
    expect(result.status).toBe("pass");
  });

  it("does not retry a timeout, which will not resolve by trying again", async () => {
    let calls = 0;
    const result = await runSkill(
      pkg("slow", { timeout_seconds: 0.05, max_retries: 3 }),
      async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 500));
        return { status: "pass", confidence: 1, findings: [], recommended_actions: [], metrics: {} };
      },
      {},
      { record: false },
    );
    expect(calls).toBe(1);
    expect(result.status).toBe("error");
  });
});

describe("eval and promotion", () => {
  it("parses cases out of fenced json blocks", () => {
    const cases = parseEvalCases(
      "Prose explaining the skill.\n\n```json\n[{\"id\": \"a\", \"input\": {}, \"expect\": {}}]\n```\n",
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]!.id).toBe("a");
  });

  it("rejects a case block missing its required fields", () => {
    expect(() => parseEvalCases('```json\n[{"id": "a"}]\n```')).toThrow(/needs id, input and expect/);
  });

  const report = (over: Partial<EvalReport> = {}): EvalReport => ({
    skill_id: "s", version: "1.1", suite: "default", outcomes: [],
    score: 0.9, latency_ms: 1000, retries: 0.1, gpu_seconds: 10, ...over,
  });

  it("promotes a first version that clears the bar", () => {
    expect(shouldPromote(report({ score: 0.85 }), null).promote).toBe(true);
  });

  it("refuses a first version below the bar", () => {
    expect(shouldPromote(report({ score: 0.5 }), null).promote).toBe(false);
  });

  it("refuses a version that did not improve quality", () => {
    const decision = shouldPromote(report({ score: 0.85 }), report({ score: 0.9 }));
    expect(decision.promote).toBe(false);
    expect(decision.reasons[0]).toContain("did not improve");
  });

  it("refuses a quality gain that costs too much latency", () => {
    const decision = shouldPromote(
      report({ score: 0.95, latency_ms: 2000 }),
      report({ score: 0.9, latency_ms: 1000 }),
    );
    expect(decision.promote).toBe(false);
    expect(decision.reasons.join(" ")).toContain("Latency regressed");
  });

  it("promotes a genuine improvement", () => {
    expect(shouldPromote(report({ score: 0.95 }), report({ score: 0.9 })).promote).toBe(true);
  });
});

describe("the shipped catalogue", () => {
  it("loads every package without error", async () => {
    const catalogue = await loadCatalogue(CATALOGUE_ROOT);
    expect(catalogue.size).toBeGreaterThan(150);
  });

  it("has no duplicate skill ids", async () => {
    const directories = await discoverSkillPackages(CATALOGUE_ROOT);
    const ids = await Promise.all(
      directories.map(async (d) => (await loadSkillPackage(d)).skill_id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every active skill real content", async () => {
    const catalogue = await loadCatalogue(CATALOGUE_ROOT);
    const thin = [...catalogue.values()]
      .filter((s) => s.descriptor.status === "active" && s.body.length < 400)
      .map((s) => s.skill_id);
    expect(thin, `Active skills without real guidance: ${thin.join(", ")}`).toEqual([]);
  });

  it("gives every active skill an eval", async () => {
    const catalogue = await loadCatalogue(CATALOGUE_ROOT);
    const missing = [...catalogue.values()]
      .filter((s) => s.descriptor.status === "active" && !s.eval)
      .map((s) => s.skill_id);
    expect(missing, `Active skills with no eval: ${missing.join(", ")}`).toEqual([]);
  });

  it("has parseable eval cases everywhere", async () => {
    const catalogue = await loadCatalogue(CATALOGUE_ROOT);
    for (const skill of catalogue.values()) {
      if (!skill.eval) continue;
      expect(() => parseEvalCases(skill.eval!), `${skill.skill_id} eval`).not.toThrow();
    }
  });

  it("resolves every active skill's dependencies against other active skills", async () => {
    // A draft dependency would make the router throw at runtime for any shot
    // that selected the dependent skill.
    const catalogue = await loadCatalogue(CATALOGUE_ROOT);
    const active = new Map([...catalogue].filter(([, s]) => s.descriptor.status === "active"));
    for (const skill of active.values()) {
      expect(() => resolveSkills([skill.skill_id], active), `${skill.skill_id}`).not.toThrow();
    }
  });

  it("routes a real UGC shot to a coherent, bounded set", async () => {
    const catalogue = await loadCatalogue(CATALOGUE_ROOT);
    const selected = selectSkills(
      { quality_mode: "UGC", generation_kind: "speech_to_video", has_dialogue: true, has_humans: true },
      catalogue,
    );
    const ids = selected.map((s) => s.skill_id);

    expect(ids).toContain("ugc-director");
    expect(ids).toContain("natural-speech");
    expect(selected.length).toBeLessThanOrEqual(12);
    expect(selected.every((s) => s.descriptor.status === "active")).toBe(true);
  });

  it("keeps the prompt compilers genuinely different from each other", async () => {
    // The failure this guards against is one generic compiler copied five
    // times, which would defeat the point of having per-model compilers.
    const catalogue = await loadCatalogue(CATALOGUE_ROOT);
    const bodies = ["wan-t2v-prompt", "wan-i2v-prompt", "wan-s2v-prompt", "qwen-image-prompt"].map(
      (id) => catalogue.get(id)!.body,
    );
    expect(new Set(bodies).size).toBe(bodies.length);

    // Each should carry the constraint that defines it.
    expect(catalogue.get("wan-i2v-prompt")!.body).toContain("keyframe");
    expect(catalogue.get("wan-s2v-prompt")!.body).toMatch(/audio|mouth/i);
    expect(catalogue.get("wan-t2v-prompt")!.body).toMatch(/no reference/i);
  });
});
