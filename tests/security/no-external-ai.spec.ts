import { describe, expect, it } from "vitest";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The system must never be able to reach an external generation provider
 * (spec sections 1, 2, 78). This is asserted rather than assumed, because the
 * failure mode it guards against is a quiet one: a local model fails, someone
 * adds a "temporary" hosted fallback, and the product silently stops being
 * self-hosted.
 *
 * external_generation_provider_count == 0
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

/** Hosts and SDK package names that would constitute an external generator. */
const BANNED_HOSTS = [
  "api.klingai.com",
  "api.minimax",
  "api.muapi.ai",
  "api.runwayml.com",
  "api.lumalabs.ai",
  "api.pikapikapika.io",
  "api.d-id.com",
  "api.heygen.com",
  "api.elevenlabs.io",
  "api.openai.com",
  "generativelanguage.googleapis.com",
  "aiplatform.googleapis.com",
  "api.replicate.com",
  "fal.run",
  "queue.fal.run",
  "api.stability.ai",
  "api.deepinfra.com",
  "api.together.xyz",
];

const BANNED_PACKAGES = [
  "replicate",
  "@fal-ai/client",
  "@fal-ai/serverless-client",
  "openai",
  "@google/generative-ai",
  "@google-cloud/aiplatform",
  "elevenlabs",
  "runwayml",
  "@runwayml/sdk",
  "kling",
  "klingai",
  "muapi",
  "stability-sdk",
  "@anthropic-ai/sdk",
];

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", ".turbo", "coverage", "models",
]);

/** This file names the banned things, so it must exempt itself. */
const SELF = path.join(ROOT, "tests/security/no-external-ai.spec.ts");

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".py", ".json", ".yaml", ".yml", ".toml", ".txt"];

describe("no external AI generation providers", () => {
  it("has zero external generation hosts in source or lockfiles", async () => {
    const files = (await walk(ROOT)).filter(
      (f) => f !== SELF && SOURCE_EXTENSIONS.includes(path.extname(f)),
    );
    const hits: string[] = [];

    for (const file of files) {
      if ((await stat(file)).size > 8_000_000) continue;
      const text = await readFile(file, "utf8");
      for (const host of BANNED_HOSTS) {
        if (text.includes(host)) hits.push(`${path.relative(ROOT, file)}: ${host}`);
      }
    }

    expect(hits, `External generation endpoints found:\n${hits.join("\n")}`).toEqual([]);
  });

  it("declares no external generation SDK as a dependency", async () => {
    const manifests = (await walk(ROOT)).filter((f) => path.basename(f) === "package.json");
    const hits: string[] = [];

    for (const file of manifests) {
      const pkg = JSON.parse(await readFile(file, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const declared = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const name of Object.keys(declared)) {
        if (BANNED_PACKAGES.includes(name)) hits.push(`${path.relative(ROOT, file)}: ${name}`);
      }
    }

    expect(hits, `External generation SDKs declared:\n${hits.join("\n")}`).toEqual([]);
  });

  it("declares no external generation SDK in any Python requirements file", async () => {
    const files = (await walk(ROOT)).filter((f) =>
      /^(requirements.*\.txt|constraints.*\.txt)$/.test(path.basename(f)),
    );
    const hits: string[] = [];

    for (const file of files) {
      for (const line of (await readFile(file, "utf8")).split("\n")) {
        const name = line.trim().split(/[=<>!~ ;#]/)[0]?.toLowerCase();
        if (name && BANNED_PACKAGES.includes(name)) {
          hits.push(`${path.relative(ROOT, file)}: ${name}`);
        }
      }
    }

    expect(hits, `External generation SDKs in Python requirements:\n${hits.join("\n")}`).toEqual([]);
  });
});
