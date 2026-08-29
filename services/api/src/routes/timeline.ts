import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { diffTimelines, framesToDisplaySeconds } from "@videoai/timeline";
import type { Timeline } from "@videoai/contracts";
import { query, queryOne, transaction } from "@videoai/database";
import { assertOwned, authenticate, conflict, notFound } from "../auth.js";

/**
 * The timeline the editor draws (spec section 42).
 *
 * The API returns integer frames and samples, exactly as stored. Seconds are
 * added alongside purely so the UI can lay out a ruler without doing timebase
 * arithmetic in the browser, where it would drift from the server's.
 */

export async function timelineRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects/:id/timeline", async (request) => {
    const caller = await authenticate(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await assertOwned("projects", id, caller);

    const timeline = await queryOne<{
      id: string;
      current_version: number;
      frame_rate_num: number;
      frame_rate_den: number;
      audio_sample_rate: number;
      duration_frames: string;
      loudness_profile: string;
    }>(
      `select id, current_version, frame_rate_num, frame_rate_den, audio_sample_rate,
              duration_frames, loudness_profile
       from public.timelines where project_id = $1`,
      [id],
    );

    if (!timeline) return { timeline: null, tracks: [], events: [] };

    const [tracks, events] = await Promise.all([
      query(
        "select id, slug, kind, index, muted from public.timeline_tracks where timeline_id = $1 order by index",
        [timeline.id],
      ),
      query(
        `select id, track_id, slug, kind, asset_id, shot_id, scene_id,
                start_frame, end_frame, start_sample, end_sample,
                gain_db, fade_in_samples, fade_out_samples, pan, ducking_group, text_content
         from public.timeline_events where timeline_id = $1
         order by coalesce(start_frame, 0), coalesce(start_sample, 0)`,
        [timeline.id],
      ),
    ]);

    const fps = { num: timeline.frame_rate_num, den: timeline.frame_rate_den };

    return {
      timeline: {
        ...timeline,
        duration_frames: Number(timeline.duration_frames),
        // Display only. The UI must never send this back as timing.
        duration_seconds: framesToDisplaySeconds(Number(timeline.duration_frames), fps),
      },
      tracks,
      events: events.map((event) => {
        const e = event as Record<string, unknown>;
        const startFrame = e["start_frame"] === null ? null : Number(e["start_frame"]);
        const startSample = e["start_sample"] === null ? null : Number(e["start_sample"]);
        return {
          ...e,
          start_frame: startFrame,
          end_frame: e["end_frame"] === null ? null : Number(e["end_frame"]),
          start_sample: startSample,
          end_sample: e["end_sample"] === null ? null : Number(e["end_sample"]),
          display_start_seconds:
            startFrame !== null
              ? framesToDisplaySeconds(startFrame, fps)
              : startSample !== null
                ? startSample / timeline.audio_sample_rate
                : 0,
        };
      }),
    };
  });

  /**
   * Mute or unmute a track. The only timeline edit that changes nothing about
   * the generated assets, so it applies immediately.
   */
  app.patch("/api/timeline-tracks/:id", async (request) => {
    const caller = await authenticate(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { muted } = z.object({ muted: z.boolean() }).parse(request.body);

    const updated = await queryOne<{ id: string }>(
      `update public.timeline_tracks set muted = $2
       where id = $1 and organization_id = $3 returning id`,
      [id, muted, caller.organization_id],
    );
    if (!updated) {
      throw notFound();
    }
    return { muted };
  });

  /**
   * What changed between two timeline versions.
   *
   * The editor uses this for undo history and to explain what a regeneration
   * moved, which is otherwise invisible to a user watching a rerender.
   */
  app.get("/api/projects/:id/timeline/diff", async (request) => {
    const caller = await authenticate(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await assertOwned("projects", id, caller);
    const { from, to } = z
      .object({ from: z.coerce.number().int().positive(), to: z.coerce.number().int().positive() })
      .parse(request.query);

    const versions = await query<{ version: number; document: Timeline }>(
      `select v.version, v.document from public.timeline_versions v
       join public.timelines t on t.id = v.timeline_id
       where t.project_id = $1 and v.version in ($2, $3)`,
      [id, from, to],
    );

    const before = versions.find((v) => v.version === from);
    const after = versions.find((v) => v.version === to);
    if (!before || !after) {
      throw notFound("One of those timeline versions does not exist.");
    }

    return diffTimelines(before.document, after.document);
  });

  /** Autosave with optimistic concurrency (spec section 101). */
  app.put("/api/projects/:id/timeline", async (request) => {
    const caller = await authenticate(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await assertOwned("projects", id, caller);

    const body = z
      .object({ document: z.record(z.string(), z.unknown()), expected_version: z.number().int().nonnegative() })
      .parse(request.body);

    return transaction(async (client) => {
      const timeline = await client.query<{ id: string; current_version: number }>(
        "select id, current_version from public.timelines where project_id = $1 for update",
        [id],
      );
      const row = timeline.rows[0];
      if (!row) {
        throw conflict("This project has no timeline yet.");
      }

      if (row.current_version !== body.expected_version) {
        // Another tab saved first. Refusing is the only safe answer: merging
        // two timeline edits automatically would silently lose one of them.
        throw conflict(
          `This timeline changed elsewhere (now at version ${row.current_version}). ` +
            `Reload before saving.`,
        );
      }

      const next = row.current_version + 1;
      await client.query(
        `insert into public.timeline_versions (timeline_id, organization_id, version, document)
         values ($1, $2, $3, $4)`,
        [row.id, caller.organization_id, next, body.document],
      );
      await client.query("update public.timelines set current_version = $2 where id = $1", [row.id, next]);

      return { version: next };
    });
  });
}
