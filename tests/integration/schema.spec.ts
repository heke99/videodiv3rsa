import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Every SQL statement in the codebase, checked against a real schema.
 *
 * This exists because of a bug that reached main: a query filtered on
 * `gpu_workers.status`, a column that does not exist, and nothing noticed.
 * Unit tests do not execute SQL and the strings are opaque to the compiler, so
 * a misremembered column is invisible until production. The whole class --
 * wrong column, wrong table, wrong parameter type -- is one Postgres already
 * detects, so the fix is to ask it.
 *
 * `PREPARE` is the right question: it parses, resolves every name and infers
 * every parameter type, without executing anything or touching a row.
 *
 * Statements that build a table or column name at run time are expanded over
 * the values they can take. They were skipped at first, which left the gap
 * exactly where a name is least checkable by anything else.
 *
 * Skipped when DATABASE_URL is unset, as the RLS suite is. Any Postgres with
 * the migrations applied will do; it does not have to be the live database.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATABASE_URL = process.env["DATABASE_URL"];

interface Statement {
  file: string;
  sql: string;
  /** True when no declared binding covered it, so it could not be checked. */
  dynamic?: boolean;
}

/**
 * Every world an interpolated statement can be in, mirroring its source.
 *
 * A binding is one coherent set of values, not a menu: in `library.ts` the
 * table and the singular its version table is named from have to agree, and
 * expanding them independently would produce combinations the code can never
 * produce and failures nobody should chase.
 *
 * Declared here rather than parsed out of the TypeScript, because a parser for
 * this would be guessing. The test below fails on any dynamic statement not
 * covered, so a new one has to be declared -- which is what keeps this honest
 * rather than decorative.
 */
type Binding = Record<string, string>;

const BINDINGS: Record<string, Binding[]> = {
  // assertOwnedBy, over its OwnedTable union.
  "packages/auth/src/index.ts": [
    { table: "projects" },
    { table: "generation_jobs" },
    { table: "assets" },
    { table: "renders" },
    { table: "exports" },
  ],
  // DIMENSION_COLUMNS: the column each usage dimension groups by.
  "packages/usage/src/index.ts": [
    { column: "user_id::text" },
    { column: "project_id::text" },
    { column: "model_id" },
    { column: "kind" },
    { column: "worker_id" },
  ],
  // ENTITY_TABLES, minus voices. `voice_profiles` is in that map but never
  // reaches an interpolation: it has neither `label` nor `is_library_entity`
  // and is not versioned, so the list route branches to its own literal query
  // before `table` is used. Including it here asserted against statements the
  // code cannot run, which is a false failure rather than a found bug.
  "services/api/src/routes/library.ts": [
    { table: "characters", 'table.replace(/s$/, "")': "character" },
    { table: "products", 'table.replace(/s$/, "")': "product" },
    { table: "locations", 'table.replace(/s$/, "")': "location" },
  ],
  // recordView, over the two entity kinds that carry reference views.
  "services/orchestrator/src/activities/references.ts": [
    { table: "character_references", column: "character_id" },
    { table: "product_references", column: "product_id" },
  ],
  // saveVersion, over its two document kinds.
  "services/orchestrator/src/activities/implementations.ts": [
    { table: "scene_bibles", versions: "scene_bible_versions", fk: "scene_bible_id" },
    { table: "scripts", versions: "script_versions", fk: "script_id" },
  ],
};

/**
 * Apply one binding to a statement, or decline.
 *
 * Returns null when the binding has no value for something the statement
 * interpolates: that pairing does not occur in the code either.
 */
function bind(sql: string, binding: Binding): string | null {
  let out = "";
  let rest = sql;
  for (;;) {
    const start = rest.indexOf("${");
    if (start === -1) return out + rest;
    const end = rest.indexOf("}", start);
    if (end === -1) return null;
    const value = binding[rest.slice(start + 2, end)];
    if (value === undefined) return null;
    out += rest.slice(0, start) + value;
    rest = rest.slice(end + 1);
  }
}

/**
 * The SQL literals the application actually runs.
 *
 * Every call site in this codebase passes the statement as a template literal
 * to `query`, `queryOne` or `client.query`, which is what makes them findable.
 */
function statements(): Statement[] {
  const pattern = /\b(?:client\.)?(?:query|queryOne)(?:<[^>]*>)?\s*\(\s*`([^`]*)`/g;
  const found: Statement[] = [];

  for (const file of globSync("{services,packages}/*/src/**/*.ts", { cwd: ROOT }).sort()) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    for (const match of source.matchAll(pattern)) {
      const sql = match[1]!.trim();
      if (sql.length === 0) continue;

      if (!sql.includes("${")) {
        found.push({ file, sql });
        continue;
      }
      const bindings = BINDINGS[file];
      if (!bindings) {
        found.push({ file, sql, dynamic: true });
        continue;
      }
      for (const binding of bindings) {
        // A binding that does not apply to this statement is not a gap: the
        // pairing does not occur in the code either.
        const bound = bind(sql, binding);
        if (bound !== null) found.push({ file, sql: bound });
      }
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

  it("leaves no statement unchecked", () => {
    // A statement whose table name is built at run time is the least checkable
    // by anything else, so it is the last place to allow a gap. Declaring its
    // values in BINDINGS is the price of writing one.
    const uncovered = [...new Set(all.filter((s) => s.dynamic).map((s) => s.file))];
    expect(uncovered, "these files interpolate into SQL with no declared bindings").toEqual([]);
  });

  it("prepares every one of them", async () => {
    const failures: string[] = [];

    for (const [index, statement] of all.entries()) {
      if (statement.dynamic) continue;
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
