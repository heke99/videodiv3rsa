import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EXPORT_PRESETS } from "@videoai/render";
import { query, queryOne } from "@videoai/database";
import { storage } from "@videoai/storage";
import { assertOwned, authenticate } from "../auth.js";

/**
 * Renders and exports (spec section 41).
 *
 * A render is the composed timeline; an export is one delivery of it at a
 * particular aspect and codec. Keeping them separate means several formats
 * share one composition rather than re-rendering per platform.
 */

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/export/presets", async () => ({
    presets: Object.entries(EXPORT_PRESETS).map(([aspect, size]) => ({ aspect, ...size })),
  }));

  app.get("/api/projects/:id/renders", async (request) => {
    const caller = await authenticate(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await assertOwned("projects", id, caller);

    return {
      renders: await query(
        `select r.id, r.status, r.asset_id, r.loudness_profile, r.created_at, r.finished_at,
                coalesce(json_agg(json_build_object(
                  'id', e.id, 'aspect_ratio', e.aspect_ratio, 'width', e.width, 'height', e.height,
                  'status', e.status, 'asset_id', e.asset_id, 'burned_captions', e.burned_captions
                )) filter (where e.id is not null), '[]') as exports
         from public.renders r
         left join public.exports e on e.render_id = r.id
         where r.project_id = $1
         group by r.id order by r.created_at desc`,
        [id],
      ),
    };
  });

  app.post("/api/projects/:id/exports", async (request, reply) => {
    const caller = await authenticate(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await assertOwned("projects", id, caller);

    const body = z
      .object({
        aspect_ratio: z.enum(["9:16", "16:9", "1:1", "4:5", "21:9"]),
        burned_captions: z.boolean().default(false),
        container: z.enum(["mp4", "webm"]).default("mp4"),
      })
      .parse(request.body);

    const render = await queryOne<{ id: string }>(
      `select id from public.renders
       where project_id = $1 and status = 'completed'
       order by created_at desc limit 1`,
      [id],
    );
    if (!render) {
      const error = new Error("This project has no completed render to export yet.");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }

    const preset = EXPORT_PRESETS[body.aspect_ratio]!;
    const created = await queryOne<{ id: string }>(
      `insert into public.exports
         (organization_id, render_id, aspect_ratio, width, height, container,
          video_codec, audio_codec, burned_captions)
       values ($1, $2, $3, $4, $5, $6, $7, 'aac', $8)
       returning id`,
      [
        caller.organization_id, render.id, body.aspect_ratio, preset.width, preset.height,
        body.container, body.container === "webm" ? "vp9" : "h264", body.burned_captions,
      ],
    );

    return reply.status(202).send({ export_id: created!.id });
  });

  app.get("/api/exports/:id/download", async (request) => {
    const caller = await authenticate(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const row = await queryOne<{ asset_id: string | null; status: string; organization_id: string }>(
      "select asset_id, status, organization_id from public.exports where id = $1",
      [id],
    );
    if (!row || row.organization_id !== caller.organization_id) {
      const error = new Error("Not found");
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }
    if (row.status !== "completed" || !row.asset_id) {
      const error = new Error(`This export is ${row.status}.`);
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }

    const version = await queryOne<{ storage_key: string }>(
      `select v.storage_key from public.asset_versions v
       join public.assets a on a.id = v.asset_id and a.current_version = v.version
       where v.asset_id = $1`,
      [row.asset_id],
    );

    await queryOne(
      "insert into public.downloads (organization_id, export_id, user_id) values ($1, $2, $3) returning id",
      [caller.organization_id, id, caller.user_id],
    );

    return { url: await storage().signedUrl(version!.storage_key, 900) };
  });
}
