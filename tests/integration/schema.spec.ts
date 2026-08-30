import { readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Every SQL statement in the codebase, checked against a real schema.
 *
 * This exists because of a bug that reached main: a query filtered on
 * `gpu_workers.status`, a column that does not exist, and nothing noticed.
 * Unit tests do not execute SQL, and the strings are opaque to the compiler,
 * so a misremembered column name is invisible until production. The whole
 * class of defect -- wrong column, wrong table, wrong parameter type -- is one
 * Postgres already detects, so the fix is to ask it.
 *
 * `PREPARE` is the right question: it parses, resolves every name and infers
 * every parameter type, without executing anything or touching a row.
 *
 * Skipped when DATABASE_URL is unset, as the RLS suite is. Any Postgres with
 * the migrations applied will do; it does not have to be the live database.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATABASE_URL = process.env["DATABASE_URL"];

interface Statement {
  file: string;
  sql: string;
}

/**
 * The SQL literals the application actually runs.
 *
 * Every call site in this codebase passes the statement as a template literal
 * to `query`, `queryOne` or `client.query`, which is what makes them findable.
 * Statements with an interpolation are skipped: the table name is chosen at run
 * time, so there is no single statement to prepare.
 */
function statements(): Statement[] {
  const pattern = /\b(?:client\.)?(?:query|queryOne)(?:<[^>]*>)?\s*\(\s*`([^`]*)`/g;
  const found: Statement[] = [];

  for (const file of globSync("{services,packages}/*/src/**/*.ts", { cwd: ROOT }).sort()) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    for (const match of source.matchAll(pattern)) {
      const sql = match[1]!.trim();
      if (sql.length === 0 || sql.includes("${")) continue;
      found.push({ file, sql });
    }
  }
  return found;
}

const all = statements();
let client: Client;

describe.skipIf(!DATABASE_URL)("every SQL statement against the real schema", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it("finds the statements to check", () => {
    // A regex that silently stops matching would turn this whole suite green
    // while checking nothing, which is the one failure mode it cannot have.
    expect(all.length).toBeGreaterThan(80);
  });

  it("prepares every one of them", async () => {
    const failures: string[] = [];

    for (const [index, statement] of all.entries()) {
      const name = `_schema_check_${index}`;
      try {
        await client.query(`prepare ${name} as ${statement.sql}`);
        await client.query(`deallocate ${name}`);
      } catch (error) {
        const message = (error as Error).message.split("\n")[0];
        failures.push(
          `${statement.file}: ${message}\n    ${statement.sql.replace(/\s+/g, " ").slice(0, 140)}`,
        );
      }
    }

    expect(failures, `${failures.length} of ${all.length} statements do not match the schema`).toEqual([]);
  }, 120_000);
});
