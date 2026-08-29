import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Portability guard (spec sections 5, 58, 114).
 *
 * Moving to another domain, GPU provider, storage backend or host must be a
 * configuration change. A single literal in product code is enough to break
 * that promise, so the literals are banned by test rather than by convention.
 *
 * Documentation, example environment files and this test may name them; code
 * may not.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SELF = path.join(ROOT, "tests/portability/no-hardcoded.spec.ts");

const BANNED = [
  // The current domain. Everything reads PUBLIC_APP_URL / APP_DOMAIN instead.
  { pattern: /video\.div3rsa\.com/, why: "domain literal; read APP_DOMAIN" },
  // GPU provider endpoints. Providers live behind GpuProvider implementations.
  { pattern: /api\.runpod\.io/, why: "GPU provider endpoint; belongs in the RunPod adapter's config" },
  { pattern: /\.runpod\.net/, why: "GPU provider host; workers are addressed by registry endpoint" },
  // Storage hosts. Everything goes through StorageAdapter.
  { pattern: /[a-z0-9]+\.supabase\.co/, why: "storage/database host; read SUPABASE_URL" },
  { pattern: /s3\.[a-z0-9-]+\.amazonaws\.com/, why: "bucket host; read S3_ENDPOINT" },
  // Absolute model paths. The root is MODEL_ROOT.
  { pattern: /(^|[^A-Za-z0-9_])\/models\//, why: "absolute model path; read MODEL_ROOT" },
];

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", ".turbo", "coverage", "models"]);
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".py"];

/** Paths where naming a literal is the point rather than a leak. */
const ALLOWED = ["docs/", ".env.example", "README.md", "vendor/", "infra/database/migrations/"];

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

describe("portability", () => {
  it("contains no hardcoded domain, provider, bucket or model path in code", async () => {
    const files = (await walk(ROOT)).filter((f) => {
      if (f === SELF) return false;
      const rel = path.relative(ROOT, f);
      if (ALLOWED.some((a) => rel.startsWith(a))) return false;
      return CODE_EXTENSIONS.includes(path.extname(f));
    });

    const hits: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      text.split("\n").forEach((line, i) => {
        for (const rule of BANNED) {
          if (rule.pattern.test(line)) {
            hits.push(`${path.relative(ROOT, file)}:${i + 1}  ${rule.why}`);
          }
        }
      });
    }

    expect(hits, `Hardcoded values found:\n${hits.join("\n")}`).toEqual([]);
  });
});
