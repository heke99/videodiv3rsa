# Disaster recovery

What to do when a piece of the system is gone. Each section assumes the others
are intact; if several are not, work in the order they appear here, because
later recoveries depend on earlier ones.

A backup that has never been restored is not a backup. Restore drills belong in
the operational calendar, not in this document's aspirations.

## The database is lost

The database holds everything that makes generated media meaningful: which
project an asset belongs to, which model version made it, what the timeline
says, who is allowed to see it. Media without it is a pile of hashes.

1. Restore Postgres from the most recent verified backup.
2. Run migrations: `pnpm db:migrate`. The runner is idempotent and refuses to
   re-run an edited migration, so a mismatch here means the backup and the
   deployed code disagree — resolve that before continuing.
3. Reconcile storage against the database. Assets in storage with no
   `asset_versions` row are orphans from after the backup point; they are safe
   to leave, and safe to delete once you are sure of the window.
4. Re-verify model artifacts on every worker. The `gpu_worker_models` rows are
   restored from backup and may claim a verification that predates a host
   rebuild.
5. Jobs that were running are lost from Temporal's perspective if Temporal's own
   store went with it. Mark them `needs_review` rather than resuming: their
   checkpoints reference asset ids that may not have survived.

## A GPU worker is lost

The least serious failure, by design.

1. The worker ages out of scheduling after 120 seconds without a heartbeat, so
   no new work is sent to it automatically.
2. In-flight jobs fail their current activity and Temporal retries them on
   another worker. Work completed before the failure is checkpointed and is not
   repeated.
3. Release any reservations it was holding:
   ```sql
   update public.gpu_reservations set status = 'expired'
   where worker_id = '<lost>' and status = 'held';
   ```
4. Bring up a replacement following `GPU_MIGRATION.md`. Nothing needs to be
   restored: workers hold no state that is not either in the database or
   reproducible from the model volume.

## Storage is temporarily unavailable

1. Generation will fail at the point of writing output. This is the correct
   behaviour; do not disable the write.
2. Jobs move to `needs_review` once their retry budget is exhausted. They can be
   restarted after storage returns.
3. Do **not** point `STORAGE_PROVIDER` at a different backend to get moving
   again. Assets are addressed by storage key and provider; a mixed corpus is
   considerably harder to recover from than an outage.

## Temporal is restarted or lost

If Temporal's store survived, workflows resume where they were. That is the
entire point of running it.

If the store is lost:

1. Running productions cannot be resumed by Temporal.
2. Their checkpoints are in `generation_steps`, so completed stages are known.
3. Restart affected jobs. Activities are idempotent on their keys, so stages
   that already produced output return the existing result rather than
   regenerating it. A restarted job costs the stages that had not completed, not
   the whole production.

## A model file is corrupted

1. Runtimes verify artifacts against recorded hashes at startup and refuse to
   serve on a mismatch, so a corrupted model manifests as a runtime that will
   not come up, rather than as quietly degraded output.
2. Re-copy the affected file from the source recorded in `model_artifacts`.
3. Re-verify:
   ```sql
   select file, sha256 from public.model_artifacts
   where model_version_id = '<version>';
   ```
4. Never edit the recorded hash to match a file on disk. The hash is the record
   of what was reviewed and approved; changing it to match whatever is present
   defeats the check entirely.

## A render fails repeatedly

1. Check technical QC output first. It distinguishes a broken source asset from
   a broken composition, and they have different fixes.
2. A timeline that references a missing asset fails composition immediately with
   the asset id named. That is a data problem, not an ffmpeg problem.
3. If composition fails on a valid timeline with valid assets, capture the
   ffmpeg stderr from the job's logs. The last few lines carry the reason; the
   rest is banner.

## Backup coverage

| What                        | Why it matters                        | Frequency                      |
| --------------------------- | ------------------------------------- | ------------------------------ |
| Postgres                    | everything above depends on it        | continuous plus daily snapshot |
| Object metadata             | maps storage keys to meaning          | with the database              |
| Model registry and licences | which models are cleared for use      | with the database              |
| Skill registry              | which skill versions are active       | with the database              |
| Configuration and secrets   | in the secret manager, not in backups | on change                      |
| Generated assets            | regenerable but expensive             | per retention policy           |

Generated assets get their own policy because they are the largest and the least
irreplaceable: they can be regenerated from the plan, at GPU cost. Everything
else cannot be regenerated at all.
