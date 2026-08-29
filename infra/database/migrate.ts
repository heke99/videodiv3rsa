import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, migrate } from "@videoai/database";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

const results = await migrate(dir);
for (const r of results) {
  console.log(`${r.status === "applied" ? "applied" : "  ok   "}  ${r.name}`);
}
await closeDb();
