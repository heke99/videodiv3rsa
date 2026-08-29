import { writeFile } from "node:fs/promises";

import { ApplicationFailure } from "@temporalio/activity";
import { createAsset } from "@videoai/assets";
import type {
  AspectRatio,
  DialogueAlignment,
  LoudnessProfile,
  QualityEvaluation,
  QualityMode,
  Shot,
  ShotPlan,
  TechnicalQcReport,
  Timeline,
} from "@videoai/contracts";
import { EXPORT_PRESETS, Timebase } from "@videoai/contracts";
import { query, queryOne, transaction } from "@videoai/database";
import { coverage, evaluate, measuredJudges, modelJudges, type Judge } from "@videoai/quality";
import {
  compose,
  probe,
  runTechnicalQc as measureFile,
  toSrt,
} from "@videoai/render";
import { assembleTimeline, type AssembledDialogue } from "@videoai/timeline";

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

// -- technical QC -----------------------------------------------------------

export async function technicalQc(input: {
  job_id: string;
  asset_id: string;
  shot: Shot;
}): Promise<TechnicalQcReport> {
  const ctx = await jobContext(input.job_id);
  const media = await materialise([input.asset_id]);
  try {
    const path = media.paths[input.asset_id]!;
    return await measureFile(path, {
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
    });
  } finally {
    await media.cleanup();
  }
}

// -- judges -----------------------------------------------------------------

/**
 * Run the judges that can run.
 *
 * The measured judges are deterministic ffmpeg measurements and always run.
 * The vision judges need a QC runtime on a worker; they are included only when
 * one is advertised, so that a report from a hardware-less deployment lists the
 * dimensions it actually looked at instead of a column of "unavailable".
 *
 * Either way `coverage()` says how much of the gating profile was checked, and
 * the caller is expected to pass that on rather than claim a bare "passed".
 */
export async function judgePanel(input: {
  job_id: string;
  asset_id: string;
  shot: Shot;
  qc_profile: string;
}): Promise<QualityEvaluation & { coverage: number }> {
  const ctx = await jobContext(input.job_id);
  const profile = input.qc_profile as QualityMode;

  const judges: Judge[] = [...measuredJudges];
  if (await qcRuntimeAvailable()) judges.push(...modelJudges);

  const media = await materialise([input.asset_id]);
  try {
    const evaluation = await evaluate(
      judges,
      {
        asset_path: media.paths[input.asset_id]!,
        planned_motion_complexity: input.shot.motion_complexity,
        loudness_profile: ctx.loudness_profile,
        audio_sample_rate: ctx.timebase.audio_sample_rate,
        expects_audio: input.shot.dialogue_line_ids.length > 0,
      },
      { subject_kind: "shot", subject_id: input.shot.id, profile },
    );

    await persistEvaluation(ctx, input.job_id, input.asset_id, evaluation);
    return { ...evaluation, coverage: coverage(evaluation, profile) };
  } finally {
    await media.cleanup();
  }
}

/** True when some online worker advertises the QC runtime the vision judges need. */
async function qcRuntimeAvailable(): Promise<boolean> {
  const row = await queryOne<{ present: boolean }>(
    `select true as present
     from public.gpu_worker_capabilities c
     join public.gpu_workers w on w.worker_id = c.worker_id
     where c.capability = 'qc' and w.status = 'online'
     limit 1`,
  );
  return row !== null;
}

async function persistEvaluation(
  ctx: JobContext,
  jobId: string,
  assetId: string,
  evaluation: QualityEvaluation,
): Promise<void> {
  await transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into public.quality_evaluations
         (organization_id, project_id, job_id, subject_kind, subject_id, asset_id,
          quality_profile, overall, passed)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        ctx.organization_id,
        ctx.project_id,
        jobId,
        evaluation.subject_kind,
        evaluation.subject_id,
        assetId,
        evaluation.quality_profile,
        evaluation.overall,
        evaluation.passed,
      ],
    );
    const evaluationId = inserted.rows[0]!.id;

    for (const judge of evaluation.judges) {
      for (const found of judge.findings) {
        await client.query(
          `insert into public.quality_findings
             (evaluation_id, organization_id, judge_id, judge_version, code, severity,
              message, frames, entity_ref)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            evaluationId,
            ctx.organization_id,
            judge.judge_id,
            judge.judge_version,
            found.code,
            found.severity,
            found.message,
            found.frames,
            found.entity_ref,
          ],
        );
      }
    }

    for (const [dimension, score] of Object.entries(evaluation.scores)) {
      if (score === undefined) continue;
      await client.query(
        `insert into public.quality_metrics (evaluation_id, organization_id, dimension, score, passed)
         values ($1, $2, $3, $4, $5)
         on conflict (evaluation_id, dimension) do update set score = excluded.score`,
        [evaluationId, ctx.organization_id, dimension, score, evaluation.passed],
      );
    }
  });
}

// -- timeline ---------------------------------------------------------------

export async function buildTimeline(input: {
  job_id: string;
  plan: ShotPlan;
  shot_assets: Record<string, string>;
}): Promise<{ timeline_id: string }> {
  const ctx = await jobContext(input.job_id);
  const dialogue = await loadDialogue(ctx, input.plan);

  const { timeline, extended_shots } = assembleTimeline({
    project_id: ctx.project_id,
    timebase: ctx.timebase,
    plan: input.plan,
    shot_assets: input.shot_assets,
    dialogue,
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
            timelineId, trackId, ctx.organization_id, event.id, event.asset.asset_id,
            event.shot_id === null ? null : (shotIds.get(event.shot_id) ?? null),
            event.start_frame, event.end_frame, event.source_start_frame,
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
            timelineId, trackId, ctx.organization_id, event.id, event.asset.asset_id,
            event.shot_id === null ? null : (shotIds.get(event.shot_id) ?? null),
            event.start_sample, event.end_sample, event.source_start_sample, event.gain_db,
            event.fade_in_samples, event.fade_out_samples, event.pan, event.ducking_group,
          ],
        );
      } else {
        await client.query(
          `insert into public.timeline_events
             (timeline_id, track_id, organization_id, slug, kind, start_sample, end_sample,
              source_start_sample, text_content)
           values ($1, $2, $3, $4, 'caption', $5, $6, 0, $7)`,
          [
            timelineId, trackId, ctx.organization_id, event.id,
            event.start_sample, event.end_sample, event.text,
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
  const preset = EXPORT_PRESETS[aspect as AspectRatio] as
    | { width: number; height: number }
    | undefined;
  // The column is plain text, so an aspect ratio the contract does not know
  // reaches here as a string. Refusing is right: guessing a resolution would
  // deliver a file in a shape nobody asked for.
  if (!preset) throw ApplicationFailure.nonRetryable(`No export preset for aspect ratio ${aspect}`);
  return preset;
}
