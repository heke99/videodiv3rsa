import type { GpuUsageKind } from "@videoai/contracts";
import { query, queryOne, transaction } from "@videoai/database";

/**
 * GPU cost accounting (spec section 79).
 *
 * Every second of GPU time is attributed to a user, an organisation, a
 * project, a model and a shot, so a question like "what did shot 8 cost" has
 * an answer. Without that attribution, cost is a single monthly number and
 * nothing can be improved from it.
 */

export interface UsageEvent {
  organization_id: string;
  user_id?: string | null;
  project_id?: string | null;
  job_id?: string | null;
  shot_id?: string | null;
  worker_id?: string | null;
  model_id?: string | null;
  kind: GpuUsageKind;
  gpu_seconds: number;
  cost_units: number;
}

export async function record(event: UsageEvent): Promise<void> {
  await queryOne(
    `insert into public.usage_events
       (organization_id, user_id, project_id, job_id, shot_id, worker_id, model_id,
        kind, gpu_seconds, cost_units)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      event.organization_id,
      event.user_id ?? null,
      event.project_id ?? null,
      event.job_id ?? null,
      event.shot_id ?? null,
      event.worker_id ?? null,
      event.model_id ?? null,
      event.kind,
      event.gpu_seconds,
      event.cost_units,
    ],
  );
}

/**
 * Cost per unit of GPU time.
 *
 * Configured rather than assumed, because the rate depends on what the
 * hardware costs, which changes with the provider and the contract.
 */
export function costUnits(gpuSeconds: number, unitsPerGpuSecond: number): number {
  return Number((gpuSeconds * unitsPerGpuSecond).toFixed(4));
}

export type Dimension = "user" | "project" | "model" | "mode" | "worker" | "kind";

const DIMENSION_COLUMNS: Record<Dimension, string> = {
  user: "user_id::text",
  project: "project_id::text",
  model: "model_id",
  mode: "kind",
  worker: "worker_id",
  kind: "kind",
};

/**
 * Roll raw events into daily or monthly totals.
 *
 * Idempotent on its natural key, so re-running a period corrects it rather
 * than doubling it. A rollup job that cannot be safely re-run is a rollup job
 * nobody dares to fix.
 */
export async function rollup(
  organizationId: string,
  periodStart: string,
  granularity: "day" | "month",
  dimension: Dimension,
): Promise<number> {
  const column = DIMENSION_COLUMNS[dimension];
  const interval = granularity === "day" ? "1 day" : "1 month";

  const rows = await query<{ dimension_value: string; gpu_seconds: string; cost_units: string }>(
    `select coalesce(${column}, 'unattributed') as dimension_value,
            sum(gpu_seconds) as gpu_seconds,
            sum(cost_units) as cost_units
     from public.usage_events
     where organization_id = $1
       and occurred_at >= $2::date
       and occurred_at < $2::date + $3::interval
     group by 1`,
    [organizationId, periodStart, interval],
  );

  await transaction(async (client) => {
    for (const row of rows) {
      await client.query(
        `insert into public.usage_rollups
           (organization_id, period_start, granularity, dimension, dimension_value,
            gpu_seconds, cost_units)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (organization_id, period_start, granularity, dimension, dimension_value)
         do update set gpu_seconds = excluded.gpu_seconds, cost_units = excluded.cost_units`,
        [
          organizationId,
          periodStart,
          granularity,
          dimension,
          row.dimension_value,
          Number(row.gpu_seconds),
          Number(row.cost_units),
        ],
      );
    }
  });

  return rows.length;
}

export interface CostBreakdown {
  dimension_value: string;
  gpu_seconds: number;
  cost_units: number;
  share: number;
}

export async function breakdown(
  organizationId: string | null,
  dimension: Dimension,
  since: string,
): Promise<CostBreakdown[]> {
  const column = DIMENSION_COLUMNS[dimension];
  const rows = await query<{ dimension_value: string; gpu_seconds: string; cost_units: string }>(
    `select coalesce(${column}, 'unattributed') as dimension_value,
            sum(gpu_seconds) as gpu_seconds,
            sum(cost_units) as cost_units
     from public.usage_events
     where ($1::uuid is null or organization_id = $1)
       and occurred_at >= $2::timestamptz
     group by 1 order by 3 desc`,
    [organizationId, since],
  );

  const total = rows.reduce((sum, r) => sum + Number(r.cost_units), 0);
  return rows.map((r) => ({
    dimension_value: r.dimension_value,
    gpu_seconds: Number(r.gpu_seconds),
    cost_units: Number(r.cost_units),
    share: total === 0 ? 0 : Number(r.cost_units) / total,
  }));
}

/**
 * Cost per approved shot.
 *
 * The metric that matters: total GPU spend divided by shots that passed QC.
 * Spend per generated shot flatters a system that regenerates a lot, and this
 * one does not.
 */
export async function costPerApprovedShot(
  organizationId: string | null,
  since: string,
): Promise<{ approved_shots: number; gpu_seconds: number; cost_units: number; per_shot: number }> {
  const totals = await queryOne<{ gpu_seconds: string; cost_units: string }>(
    `select coalesce(sum(gpu_seconds), 0) as gpu_seconds, coalesce(sum(cost_units), 0) as cost_units
     from public.usage_events
     where ($1::uuid is null or organization_id = $1) and occurred_at >= $2::timestamptz`,
    [organizationId, since],
  );

  const approved = await queryOne<{ count: string }>(
    `select count(*) as count from public.shots s
     join public.projects p on p.id = s.project_id
     where s.status = 'approved' and s.updated_at >= $2::timestamptz
       and ($1::uuid is null or p.organization_id = $1)`,
    [organizationId, since],
  );

  const shots = Number(approved?.count ?? 0);
  const cost = Number(totals?.cost_units ?? 0);

  return {
    approved_shots: shots,
    gpu_seconds: Number(totals?.gpu_seconds ?? 0),
    cost_units: cost,
    per_shot: shots === 0 ? 0 : Number((cost / shots).toFixed(4)),
  };
}

/** Remaining credit for an organisation, from the ledger's latest balance. */
export async function creditBalance(organizationId: string): Promise<number> {
  const row = await queryOne<{ balance_after: string }>(
    `select balance_after from public.credit_ledger
     where organization_id = $1 order by created_at desc limit 1`,
    [organizationId],
  );
  return Number(row?.balance_after ?? 0);
}

/**
 * Move credit, computing the new balance inside the transaction.
 *
 * The balance is derived rather than stored on the organisation, so a
 * concurrent debit cannot read a stale figure and write it back.
 */
export async function adjustCredit(
  organizationId: string,
  delta: number,
  reason: string,
  jobId?: string | null,
): Promise<number> {
  return transaction(async (client) => {
    const current = await client.query<{ balance_after: string }>(
      `select balance_after from public.credit_ledger
       where organization_id = $1 order by created_at desc limit 1 for update`,
      [organizationId],
    );
    const balance = Number(current.rows[0]?.balance_after ?? 0) + delta;

    await client.query(
      `insert into public.credit_ledger (organization_id, delta, balance_after, reason, job_id)
       values ($1, $2, $3, $4, $5)`,
      [organizationId, delta, balance, reason, jobId ?? null],
    );

    return balance;
  });
}
