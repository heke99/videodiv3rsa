import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb } from "@videoai/database";
import { loadCatalogue, syncRegistry } from "../src/index.js";

/**
 * Sync the skill catalogue on disk into the registry.
 *
 * Run after editing skills. Drift is reported and refused unless --allow-drift
 * is passed, so an edit without a version bump cannot take effect unnoticed.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../skills");
const allowDrift = process.argv.includes("--allow-drift");

const catalogue = await loadCatalogue(root);
const result = await syncRegistry(catalogue, { allowDrift });

console.log(`catalogue: ${catalogue.size} skills`);
console.log(`  created   ${result.created.length}`);
console.log(`  updated   ${result.updated.length}`);
console.log(`  unchanged ${result.unchanged.length}`);

if (result.orphaned.length > 0) {
  console.log(`  orphaned  ${result.orphaned.length}: ${result.orphaned.join(", ")}`);
}

if (result.drifted.length > 0) {
  console.error(`\n${result.drifted.length} skill(s) were edited without a version bump:`);
  for (const d of result.drifted) {
    console.error(`  ${d.skill_id}@${d.version}`);
  }
  console.error(`\nBump the version, or re-run with --allow-drift if this is intentional.`);
  await closeDb();
  process.exit(1);
}

await closeDb();
