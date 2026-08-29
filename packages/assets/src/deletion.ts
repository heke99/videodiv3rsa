import { query, queryOne, transaction } from "@videoai/database";
import { storage, type StorageAdapter } from "@videoai/storage";

/**
 * Deletion and retention (spec section 91).
 *
 * Deletion is a workflow rather than a statement, because the order matters:
 * access is cut first so nothing can be read mid-delete, then derived outputs,
 * then originals, then the personal references that are the point of the
 * request. An audit tombstone remains, carrying what was deleted and when but
 * none of the media itself.
 */

export type DeletionStage =
  | "requested"
  | "soft_blocked"
  | "deleting_derived"
  | "deleting_assets"
  | "removing_references"
  | "tombstoned"
  | "completed"
  | "failed";

export interface DeletionRequest {
  target_kind: "project" | "account" | "organization" | "asset";
  target_id: string;
  organization_id: string | null;
  requested_by: string | null;
}

export async function requestDeletion(input: DeletionRequest): Promise<string> {
  const job = await queryOne<{ id: string }>(
    `insert into public.deletion_jobs (organization_id, target_kind, target_id, requested_by, status)
     values ($1, $2, $3, $4, 'requested') returning id`,
    [input.organization_id, input.target_kind, input.target_id, input.requested_by],
  );
  return job!.id;
}

export interface DeletionOutcome {
  job_id: string;
  status: DeletionStage;
  assets_deleted: number;
  objects_deleted: number;
  references_removed: number;
}

/**
 * Run a project deletion through its stages.
 *
 * Storage objects are removed after the rows that point at them, so a crash
 * mid-run leaves orphaned bytes rather than rows referencing bytes that are
 * gone. Orphaned bytes are recoverable by a sweep; dangling references are not.
 */
export async function deleteProject(
  jobId: string,
  projectId: string,
  store: StorageAdapter = storage(),
): Promise<DeletionOutcome> {
  const outcome: DeletionOutcome = {
    job_id: jobId,
    status: "requested",
    assets_deleted: 0,
    objects_deleted: 0,
    references_removed: 0,
  };

  const advance = async (status: DeletionStage) => {
    outcome.status = status;
    await queryOne("update public.deletion_jobs set status = $2 where id = $1 returning id", [jobId, status]);
  };

  try {
    // Cut access before anything is removed, so nothing can be read while the
    // project is half deleted.
    await advance("soft_blocked");
    await queryOne(
      "update public.projects set deleted_at = now(), status = 'archived' where id = $1 returning id",
      [projectId],
    );

    const keys = await query<{ storage_key: string; asset_id: string }>(
      `select v.storage_key, v.asset_id
       from public.asset_versions v
       join public.assets a on a.id = v.asset_id
       where a.project_id = $1`,
      [projectId],
    );

    await advance("deleting_derived");
    await transaction(async (client) => {
      await client.query(
        `delete from public.exports e using public.renders r
         where e.render_id = r.id and r.project_id = $1`,
        [projectId],
      );
      await client.query("delete from public.renders where project_id = $1", [projectId]);
    });

    await advance("deleting_assets");
    const assets = await query<{ id: string }>(
      "delete from public.assets where project_id = $1 returning id",
      [projectId],
    );
    outcome.assets_deleted = assets.length;

    // Only now are the bytes removed. A failure here leaves objects with no
    // rows, which a sweep can find; the reverse would be unrecoverable.
    for (const key of keys) {
      try {
        await store.delete(key.storage_key);
        outcome.objects_deleted += 1;
      } catch {
        // A missing object is already in the desired state.
      }
    }

    await advance("removing_references");
    const references = await query<{ id: string }>(
      `delete from public.voice_profiles where project_id = $1 returning id`,
      [projectId],
    );
    outcome.references_removed = references.length;

    await advance("tombstoned");
    await queryOne(
      `insert into public.audit_events
         (organization_id, actor_kind, action, target_kind, target_id, metadata)
       select p.organization_id, 'system', 'project.deleted', 'project', $1::text,
              jsonb_build_object(
                'assets_deleted', $2::int,
                'objects_deleted', $3::int,
                'references_removed', $4::int
              )
       from public.projects p where p.id = $1
       returning id`,
      [projectId, outcome.assets_deleted, outcome.objects_deleted, outcome.references_removed],
    );

    await queryOne("delete from public.projects where id = $1 returning id", [projectId]);

    await advance("completed");
    await queryOne("update public.deletion_jobs set completed_at = now() where id = $1 returning id", [
      jobId,
    ]);

    return outcome;
  } catch (error) {
    await queryOne(
      "update public.deletion_jobs set status = 'failed', error_message = $2 where id = $1 returning id",
      [jobId, (error as Error).message],
    );
    outcome.status = "failed";
    throw error;
  }
}

/**
 * Assets past their retention window.
 *
 * Generated media is regenerable at GPU cost and is the largest thing we
 * store, so it gets a shorter policy than anything that cannot be recreated.
 */
export async function expiredAssets(
  organizationId: string,
  scope: "generated_assets" | "uploads" | "renders",
): Promise<Array<{ asset_id: string; storage_key: string }>> {
  const policy = await queryOne<{ retain_days: number }>(
    "select retain_days from public.retention_policies where organization_id = $1 and scope = $2",
    [organizationId, scope],
  );
  if (!policy) return [];

  const kinds =
    scope === "renders"
      ? ["render"]
      : scope === "uploads"
        ? ["image", "video", "audio", "voice_reference"]
        : ["video", "image", "audio"];

  return query<{ asset_id: string; storage_key: string }>(
    `select v.asset_id, v.storage_key
     from public.asset_versions v
     join public.assets a on a.id = v.asset_id
     where a.organization_id = $1
       and a.kind = any($2)
       and a.created_at < now() - make_interval(days => $3)
       and a.deleted_at is null`,
    [organizationId, kinds, policy.retain_days],
  );
}
