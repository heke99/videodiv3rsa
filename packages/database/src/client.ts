import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, type AppConfig } from "@videoai/config";

/**
 * Two ways into the database, deliberately kept apart.
 *
 * `db()` is a direct pooled connection used by backend services. It bypasses
 * RLS, so every caller must pass organization_id explicitly and is responsible
 * for having checked it.
 *
 * `userClient()` is a PostgREST client carrying the caller's JWT, so RLS
 * applies. Anything reached on behalf of a browser goes through this.
 */

let pool: Pool | null = null;

export function db(cfg: AppConfig = config()): Pool {
  pool ??= new Pool({
    connectionString: cfg.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    application_name: "videoai",
  });
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

export async function query<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await db().query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Run a unit of work in one transaction, rolling back on any throw. */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** RLS-enforcing client bound to one end user's access token. */
export function userClient(accessToken: string, cfg: AppConfig = config()): SupabaseClient {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required for user-scoped access");
  }
  return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Service-role client. Used by the orchestrator and the GPU gateway, which have
 * no user session. Never hand this to anything that takes browser input
 * without an explicit organisation check first.
 */
export function serviceClient(cfg: AppConfig = config()): SupabaseClient {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for service access");
  }
  return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
