import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne, transaction } from "@videoai/database";
import { assertOwned, authenticate, type Caller } from "../auth.js";

/**
 * Shot-level editing: the operations the project editor performs on one shot
 * without regenerating the film around it (spec section 42).
 */

const ShotId = z.object({ id: z.string().uuid() });

async function assertShotOwned(shotId: string, caller: Caller): Promise<{ project_id: string }> {
  const shot = await queryOne<{ project_id: string; organization_id: string }>(
    "select project_id, organization_id from public.shots where id = $1",
    [shotId],
  );
  if (!shot || shot.organization_id !== caller.organization_id) {
    const error = new Error("Not found");
    (error as Error & { statusCode?: number }).statusCode = 404;
    throw error;
  }
  return { project_id: shot.project_id };
}

export async function shotRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/shots/:id", async (request) => {
    const caller = await authenticate(request);
    const { id } = ShotId.parse(request.params);
    await assertShotOwned(id, caller);

    const [shot, versions, evaluation] = await Promise.all([
      queryOne("select * from public.shots where id = $1", [id]),
      query(
        `select v.version, v.asset_id, v.created_at, v.quality_evaluation_id,
                e.overall, e.passed
         from public.shot_versions v
         left join public.quality_evaluations e on e.id = v.quality_evaluation_id
         where v.shot_id = $1 order by v.version desc`,
        [id],
      ),
      queryOne(
        `select e.id, e.overall, e.passed,
                coalesce(json_agg(json_build_object(
                  'dimension', m.dimension, 'score', m.score, 'threshold', m.threshold, 'passed', m.passed
                )) filter (where m.id is not null), '[]') as metrics
         from public.quality_evaluations e
         left join public.quality_metrics m on m.evaluation_id = e.id
         where e.subject_kind = 'shot' and e.subject_id = (select slug from public.shots where id = $1)
         group by e.id order by e.created_at desc limit 1`,
        [id],
      ),
    ]);

    return { shot, versions, evaluation };
  });

  /** Restore an earlier take. A pointer move; nothing is deleted. */
  app.post("/api/shots/:id/restore", async (request) => {
    const caller = await authenticate(request);
    const { id } = ShotId.parse(request.params);
    await assertShotOwned(id, caller);
    const { version } = z.object({ version: z.number().int().positive() }).parse(request.body);

    const target = await queryOne<{ asset_id: string | null }>(
      "select asset_id from public.shot_versions where shot_id = $1 and version = $2",
      [id, version],
    );
    if (!target) {
      const error = new Error(`This shot has no version ${version}`);
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    await queryOne(
      `update public.shots set current_version = $2, current_asset_id = $3, stale = false, stale_reasons = '{}'
       where id = $1 returning id`,
      [id, version, target.asset_id],
    );
    return { restored_version: version };
  });

  /** Edit the prompt for a shot, which marks it stale rather than regenerating. */
  app.patch("/api/shots/:id", async (request) => {
    const caller = await authenticate(request);
    const { id } = ShotId.parse(request.params);
    await assertShotOwned(id, caller);

    const body = z
      .object({
        duration_frames: z.number().int().positive().optional(),
        description: z.string().max(4000).optional(),
        action: z.string().max(4000).optional(),
        index: z.number().int().nonnegative().optional(),
      })
      .parse(request.body);

    return transaction(async (client) => {
      const current = await client.query<{ document: Record<string, unknown>; version: number }>(
        `select document, version from public.shot_versions
         where shot_id = $1 order by version desc limit 1`,
        [id],
      );
      const document = { ...(current.rows[0]?.document ?? {}) };
      if (body.description !== undefined) document["description"] = body.description;
      if (body.action !== undefined) document["action"] = body.action;
      if (body.duration_frames !== undefined) document["duration_frames"] = body.duration_frames;

      // A prompt edit invalidates the take that exists, but never deletes it:
      // the user can still restore the previous version.
      await client.query(
        `insert into public.shot_versions (shot_id, organization_id, version, document)
         select $1, $2, coalesce(max(version), 0) + 1, $3
         from public.shot_versions where shot_id = $1`,
        [id, caller.organization_id, document],
      );
      await client.query(
        `update public.shots
         set duration_frames = coalesce($2, duration_frames),
             index = coalesce($3, index),
             stale = true,
             stale_reasons = array['edited by the user']
         where id = $1`,
        [id, body.duration_frames ?? null, body.index ?? null],
      );

      return { stale: true };
    });
  });

  /** Reorder shots within a project in one transaction. */
  app.post("/api/projects/:id/shots/reorder", async (request) => {
    const caller = await authenticate(request);
    const { id } = ShotId.parse(request.params);
    await assertOwned("projects", id, caller);
    const { order } = z.object({ order: z.array(z.string().uuid()).min(1) }).parse(request.body);

    await transaction(async (client) => {
      // Two passes: shift out of the way first, because the index is unique
      // per project and a direct reassignment collides mid-update.
      await client.query(
        "update public.shots set index = index + 100000 where project_id = $1",
        [id],
      );
      for (const [position, shotId] of order.entries()) {
        await client.query(
          "update public.shots set index = $2 where id = $1 and project_id = $3",
          [shotId, position, id],
        );
      }
    });

    return { reordered: order.length };
  });

  /** Queue a repair or a regeneration for one shot. */
  app.post("/api/shots/:id/repair", async (request, reply) => {
    const caller = await authenticate(request);
    const { id } = ShotId.parse(request.params);
    const { project_id } = await assertShotOwned(id, caller);
    const { scope } = z
      .object({ scope: z.enum(["auto", "shot", "lipsync", "audio", "caption", "timing"]).default("auto") })
      .parse(request.body ?? {});

    const job = await queryOne<{ id: string }>(
      `insert into public.generation_jobs
         (organization_id, project_id, quality_mode, created_by, status)
       select $1, $2, p.quality_mode, $3, 'repairing'
       from public.projects p where p.id = $2
       returning id`,
      [caller.organization_id, project_id, caller.user_id],
    );

    await queryOne("update public.shots set status = 'repairing' where id = $1 returning id", [id]);

    return reply.status(202).send({ job_id: job!.id, scope });
  });
}
