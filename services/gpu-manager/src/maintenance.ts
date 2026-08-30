import { config } from "@videoai/config";
import { query } from "@videoai/database";
import { METRICS, metric } from "@videoai/telemetry";
import { createGpuProvider } from "./providers/index.js";
import { ProviderUnsupportedError, type GpuProvider } from "./providers/provider.js";
import { expireStaleReservations, HEARTBEAT_MAX_AGE_SECONDS } from "./scheduler.js";

/**
 * Fleet maintenance (spec sections 51, 53, 57).
 *
 * Three things the schema was designed around and nothing performed. A job that
 * died left its VRAM reservation `held` for ever, so the scheduler kept
 * accounting for memory nobody was using. A worker that went silent stayed
 * `healthy` on the admin page indefinitely. And a rented GPU sat idle at full
 * price, because `GPU_IDLE_TIMEOUT_SECONDS` was read by nothing at all.
 *
 * `tick()` does one pass and returns what it did. It takes no timers, so it can
 * be tested against a real database without waiting for anything; `main.ts` is
 * the loop.
 */

export interface MaintenanceReport {
  reservations_expired: number;
  workers_marked_unhealthy: string[];
  workers_suspended: string[];
  /** Workers that were idle long enough but whose provider cannot stop them. */
  suspend_unsupported: string[];
}

export async function tick(provider: GpuProvider = createGpuProvider()): Promise<MaintenanceReport> {
  const report: MaintenanceReport = {
    reservations_expired: await expireStaleReservations(),
    workers_marked_unhealthy: await markSilentWorkersUnhealthy(),
    workers_suspended: [],
    suspend_unsupported: [],
  };

  for (const workerId of await idleWorkers()) {
    try {
      await provider.stopWorker(workerId);
      await query(
        "update public.gpu_workers set lifecycle = 'OFF', updated_at = now() where worker_id = $1",
        [workerId],
      );
      report.workers_suspended.push(workerId);
    } catch (error) {
      if (error instanceof ProviderUnsupportedError) {
        // The manual provider cannot stop a machine under someone's desk. That
        // is the abstraction working, not a failure: the loop notes it and
        // carries on rather than dying on every pass.
        report.suspend_unsupported.push(workerId);
        continue;
      }
      throw error;
    }
  }

  // Emitted every pass, including zeros: a reservation leak or a fleet going
  // quiet is a trend, and a metric that only appears when it is non-zero cannot
  // show one.
  metric(METRICS.reservationsExpired, report.reservations_expired, {});
  metric(METRICS.workersUnhealthy, report.workers_marked_unhealthy.length, {});
  // Idle time is deliberately not written to usage_events: that table is
  // per-organisation and an idle worker belongs to no tenant. Attributing it to
  // one would put another customer's waste on someone's bill. It is platform
  // cost, and a metric is where platform cost belongs.
  metric(METRICS.workersSuspended, report.workers_suspended.length, {});
  return report;
}

/**
 * A worker whose heartbeat has aged out is not healthy, whatever it last said.
 *
 * The scheduler already filters on heartbeat age at read time, so this does not
 * change what gets scheduled. What it changes is what an operator sees: without
 * it the admin page shows a machine that has been unreachable for a week as
 * healthy, because the last thing it ever said was that it was fine.
 */
async function markSilentWorkersUnhealthy(): Promise<string[]> {
  const rows = await query<{ worker_id: string }>(
    `update public.gpu_workers
     set healthy = false, lifecycle = 'UNHEALTHY', updated_at = now()
     where healthy
       and (last_seen_at is null or last_seen_at < now() - make_interval(secs => $1))
     returning worker_id`,
    [HEARTBEAT_MAX_AGE_SECONDS],
  );
  return rows.map((r) => r.worker_id);
}

/**
 * Workers idle past the timeout with nothing held against them.
 *
 * Both halves matter. `lifecycle = 'IDLE'` alone would stop a worker that a
 * reservation is still counting on, and the reservation check alone would stop
 * one that is between jobs by milliseconds.
 */
async function idleWorkers(): Promise<string[]> {
  const rows = await query<{ worker_id: string }>(
    `select w.worker_id
     from public.gpu_workers w
     where w.lifecycle = 'IDLE'
       and w.queue_depth = 0
       and w.updated_at < now() - make_interval(secs => $1)
       and not exists (
         select 1 from public.gpu_reservations r
         where r.worker_id = w.worker_id and r.status = 'held'
       )`,
    [config().GPU_IDLE_TIMEOUT_SECONDS],
  );
  return rows.map((r) => r.worker_id);
}
