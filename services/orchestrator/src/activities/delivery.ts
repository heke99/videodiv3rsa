import { writeFile } from "node:fs/promises";

import { ApplicationFailure } from "@temporalio/activity";
import { createAsset } from "@videoai/assets";
import { config } from "@videoai/config";
import type {
  AspectRatio,
  DialogueAlignment,
  LoudnessProfile,
  QualityMode,
  Shot,
  ShotPlan,
  Timeline,
} from "@videoai/contracts";
import { EXPORT_PRESETS, Timebase } from "@videoai/contracts";
import { query, queryOne, transaction } from "@videoai/database";
import { recheck, runQc, type QcOutcome, type QcRequest } from "@videoai/qc";
import { measuredJudges, modelJudges, type Judge } from "@videoai/quality";
import { compose, probe, toSrt } from "@videoai/render";
import { assembleTimeline, type AssembledBed, type AssembledDialogue } from "@videoai/timeline";

import { materialise, readLocal, scratch } from "./media.js";

/**
 * The delivery half of the pipeline: technical QC, the measurable part of the
 * judge ensemble, timeline assembly, composition and export.
 *
 * None of this needs a GPU. It is separated from `implementations.ts` because
 * every function here has to move real bytes between storage, the local disk
 * and the database, and that bookkeeping would otherwise drown the activity
 * list.
 */

export interface JobContext {
  organization_id: string;
  project_id: string;
  quality_mode: QualityMode;
  aspect_ratio: string;
  timebase: Timebase;
  loudness_profile: LoudnessProfile;
}

export async function jobContext(jobId: string): Promise<JobContext> {
  const row = await queryOne<{
    organization_id: string;
    project_id: string;
    quality_mode: string;
    aspect_ratio: string;
    frame_rate_num: number;
    frame_rate_den: number;
    audio_sample_rate: number;
    loudness_profile: string | null;
  }>(
    `select j.organization_id, j.project_id, j.quality_mode, p.aspect_ratio,
            p.frame_rate_num, p.frame_rate_den, p.audio_sample_rate,
            s.loudness_profile
     from public.generation_jobs j
     join public.projects p on p.id = j.project_id
     left join public.project_settings s on s.project_id = p.id
     where j.id = $1`,
    [jobId],
  );
  if (!row) throw ApplicationFailure.nonRetryable(`Job ${jobId} not found`);

  // Parsed rather than cast: the sample rate column is a plain integer and the
  // contract admits three values, so a project stored with anything else is a
  // data fault that should surface here rather than at the ffmpeg call.
  const timebase = Timebase.safeParse({
    frame_rate: { num: row.frame_rate_num, den: row.frame_rate_den },
    audio_sample_rate: row.audio_sample_rate,
  });
  if (!timebase.success) {
    throw ApplicationFailure.nonRetryable(
      `Project ${row.project_id} has an unusable timebase: ${timebase.error.message}`,
    );
  }

  return {
    organization_id: row.organization_id,
    project_id: row.project_id,
    quality_mode: row.quality_mode as QualityMode,
    aspect_ratio: row.aspect_ratio,
    timebase: timebase.data,
    loudness_profile: (row.loudness_profile ?? "social") as LoudnessProfile,
  };
}

// -- quality control -------------------------------------------------------

/**
 * Technical QC and the judge panel, for one asset.
 *
 * The sequencing, the short-circuit on a broken file and the persistence all
 * live in `@videoai/qc`; this only resolves the job's context, puts the bytes
 * on disk where ffmpeg can reach them, and decides which judges are eligible.
 * An earlier version of this file reimplemented the persistence and got it
 * wrong in two ways -- it never recorded a dimension's threshold, and it wrote
 * the evaluation's overall verdict onto every metric row instead of comparing
 * each score to its own threshold -- both of which the editor reads.
 */
export async function runQualityControl(input: {
  job_id: string;
  asset_id: string;
  shot: Shot;
  qc_profile: string;
  /** Measured judges only. For re-checking after a deterministic repair. */
  measured_only?: boolean;
}): Promise<QcOutcome> {
  const ctx = await jobContext(input.job_id);
  const profile = input.qc_profile as QualityMode;
  const media = await materialise([input.asset_id]);

  try {
    const request: QcRequest = {
      organization_id: ctx.organization_id,
      project_id: ctx.project_id,
      job_id: input.job_id,
      asset_id: input.asset_id,
      asset_path: media.paths[input.asset_id]!,
      subject_kind: "shot",
      subject_id: input.shot.id,
      profile,
      technical: {
        asset_id: input.asset_id,
        expected_frames: input.shot.duration_frames,
        expected_fps: ctx.timebase.frame_rate,
        // Deliberately no expected width or height: a shot is generated at
        // whatever resolution its model produces and the compositor scales and
        // pads it to the export preset. Asserting the delivery size here would
        // fail every shot from a model that renders smaller, which is not a
        // defect in the file.
        expects_audio: input.shot.dialogue_line_ids.length > 0,
        expected_sample_rate: ctx.timebase.audio_sample_rate,
      },
      judge_context: {
        planned_motion_complexity: input.shot.motion_complexity,
        loudness_profile: ctx.loudness_profile,
        audio_sample_rate: ctx.timebase.audio_sample_rate,
        expects_audio: input.shot.dialogue_line_ids.length > 0,
      },
      judges: await panel(input.measured_only ?? false),
    };

    return input.measured_only ? await recheck(request) : await runQc(request);
  } finally {
    await media.cleanup();
  }
}

/**
 * The judges eligible to run.
 *
 * The measured judges are ffmpeg measurements and always run. The vision judges
 * need the QC model on a worker, and are included only when one holds it -- so
 * a report from a hardware-less deployment lists what was actually looked at
 * rather than a column of "unavailable". Either way the outcome carries
 * `coverage`, which is how much of the gating profile was reached; a caller
 * that drops it is claiming more than was checked.
 */
async function panel(measuredOnly: boolean): Promise<Judge[]> {
  if (measuredOnly) return [...measuredJudges];
  return (await qcRuntimeAvailable()) ? [...measuredJudges, ...modelJudges] : [...measuredJudges];
}

/**
 * True when a healthy worker actually holds the QC model.
 *
 * Asked of `gpu_worker_models`, which the supervisor writes on every scan, and
 * against `lifecycle` and `healthy`, which are the columns `gpu_workers` has.
 * Same shape as the installed-model check in `runPreflight`, deliberately --
 * there should be one answer to "is this model reachable", not two.
 */
async function qcRuntimeAvailable(): Promise<boolean> {
  const row = await queryOne<{ present: boolean }>(
    `select true as present
     from public.gpu_worker_models m
     join public.gpu_workers w on w.worker_id = m.worker_id
     where m.model_id = $1
       and m.present and m.verified
       and w.healthy and w.lifecycle in ('READY', 'BUSY', 'IDLE')
     limit 1`,
    [config().QC_MODEL],
  );
  return row !== null;
}

// -- shot takes -------------------------------------------------------------

/**
 * Record one take of a shot.
 *
 * A take is a new `shot_versions` row carrying the asset and the evaluation
 * that judged it, plus the shot's own pointer moved to it. Both are what the
 * editor reads: the version list, the quality badge beside each version, and
 * the restore button that moves the pointer back. Until this existed nothing
 * wrote them, so a generated shot showed as `planned` with an empty history.
 *
 * The shot's document is carried forward from the previous version rather than
 * rewritten: a take changes which pixels are current, not what the shot is.
 */
export async function recordShotTake(input: {
  job_id: string;
  shot_id: string;
  asset_id: string;
  evaluation_id: string;
  passed: boolean;
}): Promise<{ version: number }> {
  const ctx = await jobContext(input.job_id);

  return transaction(async (client) => {
    const shot = await client.query<{ id: string }>(
      "select id from public.shots where project_id = $1 and slug = $2",
      [ctx.project_id, input.shot_id],
    );
    const shotId = shot.rows[0]?.id;
    if (!shotId) {
      throw ApplicationFailure.nonRetryable(`Shot ${input.shot_id} is not in project ${ctx.project_id}`);
    }

    const inserted = await client.query<{ version: number }>(
      `insert into public.shot_versions (shot_id, organization_id, version, document, asset_id, quality_evaluation_id)
       select $1, $2, coalesce(max(v.version), 0) + 1,
              coalesce(
                (select v2.document from public.shot_versions v2
                 where v2.shot_id = $1 order by v2.version desc limit 1),
                '{}'::jsonb
              ),
              $3, $4
       from public.shot_versions v where v.shot_id = $1
       returning version`,
      [shotId, ctx.organization_id, input.asset_id, input.evaluation_id],
    );
    const version = inserted.rows[0]!.version;

    await client.query(
      `update public.shots
       set current_version = $2, current_asset_id = $3, status = $4,
           stale = false, stale_reasons = '{}'
       where id = $1`,
      [shotId, version, input.asset_id, input.passed ? "approved" : "needs_review"],
    );

    return { version };
  });
}

// -- timeline ---------------------------------------------------------------

export async function buildTimeline(input: {
  job_id: string;
  plan: ShotPlan;
  shot_assets: Record<string, string>;
}): Promise<{ timeline_id: string }> {
  const ctx = await jobContext(input.job_id);
  const [dialogue, beds] = await Promise.all([loadDialogue(ctx, input.plan), loadBeds(ctx, input.plan)]);

  const { timeline, extended_shots } = assembleTimeline({
    project_id: ctx.project_id,
    timebase: ctx.timebase,
    plan: input.plan,
    shot_assets: input.shot_assets,
    dialogue,
    beds,
    loudness_profile: ctx.loudness_profile,
  });

  const timelineId = await persistTimeline(ctx, timeline);

  // A shot that grew to hold its dialogue is a change to the plan, and the
  // stored shot row has to agree with the timeline or the two clocks drift.
  for (const extended of extended_shots) {
    await query(
      `update public.shots set duration_frames = $3
       where project_id = $1 and slug = $2`,
      [ctx.project_id, extended.shot_id, extended.to_frames],
    );
  }

  return { timeline_id: timelineId };
}

/**
 * Dialogue that has actually been generated, with its measured length.
 *
 * Absent dialogue is not an error: a film with no speech assembles fine, and
 * so does one whose speech has not been generated yet. Only the lines that
 * exist take part in the fit.
 */
async function loadDialogue(ctx: JobContext, plan: ShotPlan): Promise<AssembledDialogue[]> {
  const rows = await query<{
    dialogue_line_id: string;
    asset_id: string;
    audio_sample_rate: number;
    words: DialogueAlignment["words"];
    phonemes: DialogueAlignment["phonemes"];
    duration_samples: string | null;
  }>(
    `select a.dialogue_line_id, a.asset_id, a.audio_sample_rate, a.words, a.phonemes,
            v.duration_samples
     from public.dialogue_alignments a
     join public.assets s on s.id = a.asset_id
     join public.asset_versions v on v.asset_id = s.id and v.version = s.current_version
     where a.project_id = $1`,
    [ctx.project_id],
  );
  if (rows.length === 0) return [];

  const shotOfLine = new Map<string, string>();
  for (const shot of plan.shots) {
    for (const lineId of shot.dialogue_line_ids) shotOfLine.set(lineId, shot.id);
  }

  return rows
    .filter((row) => row.duration_samples !== null)
    .map((row) => ({
      dialogue_line_id: row.dialogue_line_id,
      shot_id: shotOfLine.get(row.dialogue_line_id) ?? null,
      asset_id: row.asset_id,
      length_samples: Number(row.duration_samples),
      pause_before_samples: 0,
      pause_after_samples: 0,
      alignment: {
        dialogue_line_id: row.dialogue_line_id,
        asset: { asset_id: row.asset_id },
        sample_rate: row.audio_sample_rate,
        words: row.words ?? [],
        phonemes: row.phonemes ?? [],
      },
    }));
}

/**
 * Ambience that has been generated, one bed per shot.
 *
 * Found by role and by the shot slug the generation recorded as the asset's
 * label, and taken at its measured length -- the same rule the dialogue follows,
 * because a bed trimmed to a planned length would drift from its own picture.
 * No start offset is computed here: dialogue may have already made an earlier
 * shot longer, so only assembly knows where a shot begins.
 *
 * Absent ambience is not an error. A film with no beds mixes fine.
 */
async function loadBeds(ctx: JobContext, plan: ShotPlan): Promise<AssembledBed[]> {
  const rows = await query<{ label: string; asset_id: string; duration_samples: string | null }>(
    `select distinct on (a.label) a.label, a.id as asset_id, v.duration_samples
     from public.assets a
     join public.asset_versions v on v.asset_id = a.id and v.version = a.current_version
     where a.project_id = $1 and a.role = 'ambience' and a.deleted_at is null
     order by a.label, a.created_at desc`,
    [ctx.project_id],
  );

  const slugs = new Set(plan.shots.map((s) => s.id));
  return rows
    .filter((row) => slugs.has(row.label) && row.duration_samples !== null)
    .map((row) => ({
      kind: "AMBIENCE" as const,
      asset_id: row.asset_id,
      shot_id: row.label,
      length_samples: Number(row.duration_samples),
      // Beds sit under the picture, not level with it. Ducking under speech is
      // applied on top of this by assembly.
      gain_db: -18,
    }));
}

async function persistTimeline(ctx: JobContext, timeline: Timeline): Promise<string> {
  return transaction(async (client) => {
    const parent = await client.query<{ id: string; current_version: number }>(
      `insert into public.timelines
         (project_id, organization_id, frame_rate_num, frame_rate_den, audio_sample_rate,
          duration_frames, loudness_profile)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (project_id) do update
         set duration_frames = excluded.duration_frames,
             loudness_profile = excluded.loudness_profile,
             current_version = public.timelines.current_version + 1,
             updated_at = now()
       returning id, current_version`,
      [
        ctx.project_id,
        ctx.organization_id,
        timeline.timebase.frame_rate.num,
        timeline.timebase.frame_rate.den,
        timeline.timebase.audio_sample_rate,
        timeline.duration_frames,
        timeline.loudness_profile,
      ],
    );
    const timelineId = parent.rows[0]!.id;
    const version = parent.rows[0]!.current_version;

    await client.query(
      `insert into public.timeline_versions (timeline_id, organization_id, version, document)
       values ($1, $2, $3, $4)
       on conflict (timeline_id, version) do update set document = excluded.document`,
      [timelineId, ctx.organization_id, version, timeline],
    );

    // Tracks and events are replaced wholesale. A re-assembly that dropped an
    // event must not leave the old one playing.
    await client.query("delete from public.timeline_tracks where timeline_id = $1", [timelineId]);

    const trackIds = new Map<string, string>();
    for (const track of timeline.tracks) {
      const inserted = await client.query<{ id: string }>(
        `insert into public.timeline_tracks (timeline_id, organization_id, slug, kind, index, muted)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [timelineId, ctx.organization_id, track.id, track.kind, track.index, track.muted],
      );
      trackIds.set(track.id, inserted.rows[0]!.id);
    }

    const shotIds = await shotIdBySlug(client, ctx.project_id);

    for (const event of timeline.events) {
      const trackId = trackIds.get(event.track_id);
      if (!trackId) continue;

      if (event.kind === "video") {
        await client.query(
          `insert into public.timeline_events
             (timeline_id, track_id, organization_id, slug, kind, asset_id, shot_id,
              start_frame, end_frame, source_start_frame)
           values ($1, $2, $3, $4, 'video', $5, $6, $7, $8, $9)`,
          [
            timelineId,
            trackId,
            ctx.organization_id,
            event.id,
            event.asset.asset_id,
            event.shot_id === null ? null : (shotIds.get(event.shot_id) ?? null),
            event.start_frame,
            event.end_frame,
            event.source_start_frame,
          ],
        );
      } else if (event.kind === "audio") {
        await client.query(
          `insert into public.timeline_events
             (timeline_id, track_id, organization_id, slug, kind, asset_id, shot_id,
              start_sample, end_sample, source_start_sample, gain_db,
              fade_in_samples, fade_out_samples, pan, ducking_group)
           values ($1, $2, $3, $4, 'audio', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            timelineId,
            trackId,
            ctx.organization_id,
            event.id,
            event.asset.asset_id,
            event.shot_id === null ? null : (shotIds.get(event.shot_id) ?? null),
            event.start_sample,
            event.end_sample,
            event.source_start_sample,
            event.gain_db,
            event.fade_in_samples,
            event.fade_out_samples,
            event.pan,
            event.ducking_group,
          ],
        );
      } else {
        await client.query(
          `insert into public.timeline_events
             (timeline_id, track_id, organization_id, slug, kind, start_sample, end_sample,
              source_start_sample, text_content)
           values ($1, $2, $3, $4, 'caption', $5, $6, 0, $7)`,
          [
            timelineId,
            trackId,
            ctx.organization_id,
            event.id,
            event.start_sample,
            event.end_sample,
            event.text,
          ],
        );
      }
    }

    return timelineId;
  });
}

async function shotIdBySlug(
  client: { query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> },
  projectId: string,
): Promise<Map<string, string>> {
  const rows = await client.query<{ id: string; slug: string }>(
    "select id, slug from public.shots where project_id = $1",
    [projectId],
  );
  return new Map(rows.rows.map((r) => [r.slug, r.id]));
}

// -- composition ------------------------------------------------------------

export async function composeFinal(input: {
  job_id: string;
  timeline_id: string;
}): Promise<{ asset_id: string }> {
  const ctx = await jobContext(input.job_id);
  const { timeline, version } = await loadTimeline(input.timeline_id);
  const preset = presetOrThrow(ctx.aspect_ratio);

  const render = await queryOne<{ id: string }>(
    `insert into public.renders
       (organization_id, project_id, job_id, timeline_version, status, loudness_profile)
     values ($1, $2, $3, $4, 'rendering', $5)
     returning id`,
    [ctx.organization_id, ctx.project_id, input.job_id, version, timeline.loudness_profile],
  );
  const renderId = render!.id;

  try {
    const assetId = await renderTimeline(ctx, timeline, preset, {
      kind: "render",
      role: "master",
      label: `render-${renderId}`,
      burnCaptions: false,
    });

    await query(
      "update public.renders set status = 'completed', asset_id = $2, finished_at = now() where id = $1",
      [renderId, assetId],
    );
    return { asset_id: assetId };
  } catch (error) {
    await query("update public.renders set status = 'failed', finished_at = now() where id = $1", [renderId]);
    throw error;
  }
}

// -- export -----------------------------------------------------------------

/**
 * One deliverable per aspect ratio the project asks for.
 *
 * The master render is reused for the project's own aspect ratio rather than
 * re-encoded, because a second pass over identical geometry would only add
 * generation loss.
 */
export async function exportRenders(input: {
  job_id: string;
  render_asset_id: string;
}): Promise<{ export_ids: string[] }> {
  const ctx = await jobContext(input.job_id);

  const render = await queryOne<{ id: string; timeline_version: number }>(
    `select id, timeline_version from public.renders
     where asset_id = $1 and job_id = $2 order by created_at desc limit 1`,
    [input.render_asset_id, input.job_id],
  );
  if (!render) {
    throw ApplicationFailure.nonRetryable(`No render row for asset ${input.render_asset_id}`);
  }

  const timelineRow = await queryOne<{ id: string }>(
    "select id from public.timelines where project_id = $1",
    [ctx.project_id],
  );
  if (!timelineRow) throw ApplicationFailure.nonRetryable("No timeline to export from");
  const { timeline } = await loadTimeline(timelineRow.id);

  const requested = await requestedAspectRatios(ctx);
  const exportIds: string[] = [];

  for (const aspect of requested) {
    const preset = presetOrThrow(aspect);
    const row = await queryOne<{ id: string }>(
      `insert into public.exports
         (organization_id, render_id, aspect_ratio, width, height, status)
       values ($1, $2, $3, $4, $5, 'processing')
       returning id`,
      [ctx.organization_id, render.id, aspect, preset.width, preset.height],
    );
    const exportId = row!.id;

    try {
      const assetId =
        aspect === ctx.aspect_ratio
          ? input.render_asset_id
          : await renderTimeline(ctx, timeline, preset, {
              kind: "render",
              role: "export",
              label: `export-${aspect}`,
              burnCaptions: false,
            });

      await query("update public.exports set status = 'completed', asset_id = $2 where id = $1", [
        exportId,
        assetId,
      ]);
      exportIds.push(exportId);
    } catch (error) {
      await query("update public.exports set status = 'failed' where id = $1", [exportId]);
      throw error;
    }
  }

  return { export_ids: exportIds };
}

async function requestedAspectRatios(ctx: JobContext): Promise<string[]> {
  const row = await queryOne<{ settings: { export_aspect_ratios?: unknown } | null }>(
    "select settings from public.project_settings where project_id = $1",
    [ctx.project_id],
  );
  const configured = row?.settings?.export_aspect_ratios;
  const list = Array.isArray(configured) ? configured.filter((v): v is string => typeof v === "string") : [];
  // The project's own aspect ratio is always delivered, whatever else is asked
  // for, so a misconfigured setting cannot produce a job with no output.
  return [...new Set([ctx.aspect_ratio, ...list])];
}

// -- shared render path -----------------------------------------------------

async function renderTimeline(
  ctx: JobContext,
  timeline: Timeline,
  preset: { width: number; height: number },
  asset: { kind: "render"; role: string; label: string; burnCaptions: boolean },
): Promise<string> {
  const assetIds = timeline.events.flatMap((event) =>
    event.kind === "caption" ? [] : [event.asset.asset_id],
  );

  const media = await materialise(assetIds);
  const out = await scratch();
  try {
    const outputPath = `${out.directory}/master.mp4`;
    let captionsPath: string | undefined;
    if (asset.burnCaptions) {
      const captions = timeline.events.filter((e) => e.kind === "caption");
      if (captions.length > 0) {
        captionsPath = `${out.directory}/captions.srt`;
        await writeFile(captionsPath, toSrt(captions, timeline.timebase.audio_sample_rate));
      }
    }

    await compose({
      timeline,
      assetPaths: media.paths,
      outputPath,
      width: preset.width,
      height: preset.height,
      captionsPath,
      burnCaptions: asset.burnCaptions && captionsPath !== undefined,
    });

    const info = await probe(outputPath);
    const created = await createAsset({
      organization_id: ctx.organization_id,
      project_id: ctx.project_id,
      kind: asset.kind,
      role: asset.role,
      label: asset.label,
      mime: "video/mp4",
      extension: ".mp4",
      body: await readLocal(outputPath),
      metadata: {
        width: info.width,
        height: info.height,
        frame_count: info.frame_count,
        frame_rate_num: info.frame_rate_num,
        frame_rate_den: info.frame_rate_den,
        audio_sample_rate: info.audio_sample_rate,
        audio_channels: info.audio_channels,
        video_codec: info.video_codec,
        audio_codec: info.audio_codec,
        pixel_format: info.pixel_format,
      },
    });
    return created.asset_id;
  } finally {
    await media.cleanup();
    await out.cleanup();
  }
}

async function loadTimeline(timelineId: string): Promise<{ timeline: Timeline; version: number }> {
  const row = await queryOne<{ document: Timeline; version: number }>(
    `select v.document, v.version
     from public.timeline_versions v
     join public.timelines t on t.id = v.timeline_id and t.current_version = v.version
     where v.timeline_id = $1`,
    [timelineId],
  );
  if (!row) throw ApplicationFailure.nonRetryable(`Timeline ${timelineId} has no current version`);
  return { timeline: row.document, version: row.version };
}

function presetOrThrow(aspect: string): { width: number; height: number } {
  const preset = EXPORT_PRESETS[aspect as AspectRatio] as { width: number; height: number } | undefined;
  // The column is plain text, so an aspect ratio the contract does not know
  // reaches here as a string. Refusing is right: guessing a resolution would
  // deliver a file in a shape nobody asked for.
  if (!preset) throw ApplicationFailure.nonRetryable(`No export preset for aspect ratio ${aspect}`);
  return preset;
}
