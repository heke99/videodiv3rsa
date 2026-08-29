import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { db, transaction } from "./client.js";

/**
 * Migration runner. Files apply in filename order, each inside a transaction,
 * and each records its checksum so an edited migration is caught rather than
 * silently diverging from what a deployed database actually contains.
 */

export interface MigrationResult {
  name: string;
  status: "applied" | "skipped";
}

const MIGRATIONS_TABLE = `
  create table if not exists public.schema_migrations (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )
`;

export async function migrate(dir: string): Promise<MigrationResult[]> {
  await db().query(MIGRATIONS_TABLE);

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Map<string, string>(
    (
      await db().query<{ name: string; checksum: string }>(
        "select name, checksum from public.schema_migrations",
      )
    ).rows.map((r) => [r.name, r.checksum]),
  );

  const results: MigrationResult[] = [];

  for (const file of files) {
    const sql = await readFile(path.join(dir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = applied.get(file);

    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `Migration ${file} has changed since it was applied. ` +
            `Migrations are immutable once deployed; add a new one instead.`,
        );
      }
      results.push({ name: file, status: "skipped" });
      continue;
    }

    await transaction(async (client) => {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (name, checksum) values ($1, $2)", [
        file,
        checksum,
      ]);
    });
    results.push({ name: file, status: "applied" });
  }

  return results;
}
