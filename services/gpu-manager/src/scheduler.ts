import { GPU_PROFILE_VRAM_GIB, type GpuProfile, type WorkerRequirement } from "@videoai/contracts";
import { query, queryOne, transaction, type GpuWorkerRow } from "@videoai/database";

/**
 * Worker selection and reservations (spec sections 51, 52).
 *
 * The scheduler matches on capability, never on hardware identity, and it
 * batches work by model so a 96 GiB card is not spent thrashing weights in and
 * out of VRAM.
 */

export interface WorkerCandidate {
  worker_id: string;
  endpoint: string;
  profile: GpuProfile;
  vram_free_bytes: number;
  queue_depth: number;
  loaded_models: string[];
}

/**
 * How long a worker may go without reporting before it stops counting.
 *
 * Exported because the health probe in `providers/manual.ts` was carrying its
 * own copy of the same number, and two heartbeat windows that can drift apart
 * is one heartbeat window nobody can reason about.
 */
export const HEARTBEAT_MAX_AGE_SECONDS = 120;

/**
 * Workers that can serve a requirement, best first.
 *
 * Preference order is deliberate: a worker that already has the model resident
 * beats an idle one, because a cold load of a 14B model costs more than the
 * queue wait it would avoid.
 */
export async function selectWorkers(
  requirement: WorkerRequirement,
  modelId: string,
): Promise<WorkerCandidate[]> {
  const rows = await query<GpuWorkerRow & { loaded_models: string[] }>(
    `select w.*,
            coalesce(array_agg(m.model_id) filter (where m.loaded), '{}') as loaded_models
     from public.gpu_workers w
     left join public.gpu_worker_models m on m.worker_id = w.worker_id
     where w.healthy
       and not w.drain_requested
       and w.lifecycle in ('READY', 'BUSY', 'IDLE')
       and w.last_seen_at > now() - make_interval(secs => $1)
       and $2 = any(w.supported_precisions)
     group by w.worker_id`,
    [HEARTBEAT_MAX_AGE_SECONDS, requirement.required_precision],
  );

  const needed = GPU_PROFILE_VRAM_GIB[requirement.required_profile];

  return rows
    .filter((r) => GPU_PROFILE_VRAM_GIB[r.profile as GpuProfile] >= needed)
    .filter((r) => Number(r.vram_free_bytes) >= requirement.required_vram_bytes)
    .map((r) => ({
      worker_id: r.worker_id,
      endpoint: r.endpoint,
      profile: r.profile as GpuProfile,
      vram_free_bytes: Number(r.vram_free_bytes),
      queue_depth: r.queue_depth,
      loaded_models: r.loaded_models,
    }))
    .sort((a, b) => {
      const aHot = a.loaded_models.includes(modelId) ? 0 : 1;
      const bHot = b.loaded_models.includes(modelId) ? 0 : 1;
      if (aHot !== bHot) return aHot - bHot;
      if (a.queue_depth !== b.queue_depth) return a.queue_depth - b.queue_depth;
      return b.vram_free_bytes - a.vram_free_bytes;
    });
}

export class NoCapacityError extends Error {
  constructor(requirement: WorkerRequirement) {
    super(
      `No healthy worker satisfies ${requirement.required_profile} / ` +
        `${requirement.required_precision} / ${requirement.required_runtime} with ` +
        `${(requirement.required_vram_bytes / 1024 ** 3).toFixed(1)} GiB free.`,
    );
    this.name = "NoCapacityError";
  }
}

export interface Reservation {
  reservation_id: string;
  worker_id: string;
  endpoint: string;
  expires_at: string;
}

/**
 * Hold VRAM on a worker for one job.
 *
 * The check and the insert happen in one transaction with the worker row
 * locked, so two jobs cannot both observe the same free VRAM and both take it.
 */
export async function reserve(
  requirement: WorkerRequirement,
  modelId: string,
  jobId: string,
  organizationId: string | null,
  ttlSeconds = 900,
): Promise<Reservation> {
  const candidates = await selectWorkers(requirement, modelId);
  if (candidates.length === 0) throw new NoCapacityError(requirement);

  for (const candidate of candidates) {
    const reservation = await transaction(async (client) => {
      const locked = await client.query<{ vram_free_bytes: string }>(
        "select vram_free_bytes from public.gpu_workers where worker_id = $1 for update",
        [candidate.worker_id],
      );
      const free = Number(locked.rows[0]?.vram_free_bytes ?? 0);

      const held = await client.query<{ total: string }>(
        `select coalesce(sum(vram_bytes), 0) as total from public.gpu_reservations
         where worker_id = $1 and status = 'held' and expires_at > now()`,
        [candidate.worker_id],
      );
      const available = free - Number(held.rows[0]?.total ?? 0);
      if (available < requirement.required_vram_bytes) return null;

      const inserted = await client.query<{ id: string; expires_at: string }>(
        `insert into public.gpu_reservations
           (worker_id, job_id, organization_id, vram_bytes, expires_at)
         values ($1, $2, $3, $4, now() + make_interval(secs => $5))
         returning id, expires_at`,
        [candidate.worker_id, jobId, organizationId, requirement.required_vram_bytes, ttlSeconds],
      );
      await client.query(
        "update public.gpu_workers set lifecycle = 'BUSY', queue_depth = queue_depth + 1 where worker_id = $1",
        [candidate.worker_id],
      );

      return {
        reservation_id: inserted.rows[0]!.id,
        worker_id: candidate.worker_id,
        endpoint: candidate.endpoint,
        expires_at: inserted.rows[0]!.expires_at,
      };
    });

    if (reservation) return reservation;
  }

  // Every candidate lost its capacity between selection and locking.
  throw new NoCapacityError(requirement);
}

export async function release(reservationId: string): Promise<void> {
  await transaction(async (client) => {
    const released = await client.query<{ worker_id: string }>(
      `update public.gpu_reservations
       set status = 'released', released_at = now()
       where id = $1 and status = 'held'
       returning worker_id`,
      [reservationId],
    );
    const workerId = released.rows[0]?.worker_id;
    if (!workerId) return;
    await client.query(
      `update public.gpu_workers
       set queue_depth = greatest(queue_depth - 1, 0),
           -- Only a worker that is actually taking work goes back to IDLE.
           -- Without the DRAINING guard, a worker being drained flipped back to
           -- IDLE the moment its last job finished, so the fleet view showed a
           -- machine as available while an operator was trying to retire it.
           lifecycle = case
             when lifecycle = 'DRAINING' then 'DRAINING'
             when queue_depth - 1 <= 0 then 'IDLE'
             else lifecycle
           end
       where worker_id = $1`,
      [workerId],
    );
  });
}

/** Reservations whose job died without releasing must not strand VRAM. */
export async function expireStaleReservations(): Promise<number> {
  const rows = await query<{ id: string }>(
    `update public.gpu_reservations set status = 'expired'
     where status = 'held' and expires_at <= now()
     returning id`,
  );
  return rows.length;
}

/**
 * Group pending work so a worker loads a model once and runs everything that
 * needs it (spec section 52). Order within a batch is preserved so shots still
 * render in a predictable sequence.
 */
export function batchByModel<T extends { model_id: string; model_version: string }>(
  items: T[],
): Array<{ model_id: string; model_version: string; items: T[] }> {
  const groups = new Map<string, { model_id: string; model_version: string; items: T[] }>();
  for (const item of items) {
    const key = `${item.model_id}@${item.model_version}`;
    const group = groups.get(key) ?? {
      model_id: item.model_id,
      model_version: item.model_version,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Profiles the fleet can currently serve; feeds the router and preflight. */
export async function availableProfiles(): Promise<GpuProfile[]> {
  const rows = await query<{ profile: string }>(
    `select distinct profile from public.gpu_workers
     where healthy and not drain_requested
       and lifecycle in ('READY', 'BUSY', 'IDLE')
       and last_seen_at > now() - make_interval(secs => $1)`,
    [HEARTBEAT_MAX_AGE_SECONDS],
  );
  return rows.map((r) => r.profile as GpuProfile);
}

/** Stop sending work to a worker while letting its current jobs finish. */
export async function drain(workerId: string): Promise<void> {
  await queryOne(
    "update public.gpu_workers set drain_requested = true, lifecycle = 'DRAINING' where worker_id = $1 returning worker_id",
    [workerId],
  );
}
