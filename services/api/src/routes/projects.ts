import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateVideoRequest } from "@videoai/contracts";
import { query, queryOne, transaction } from "@videoai/database";
import { budgetFor, cancelProduction, getProgress, startProduction } from "@videoai/orchestrator";
import { assertOwned, authenticate } from "../auth.js";

/**
 * Projects and their generation jobs.
 *
 * Every handler resolves the caller's organisation from their token before
 * touching anything, so a request naming someone else's project gets the same
 * answer as one naming a project that does not exist.
 */

const Id = z.object({ id: z.string().uuid() });

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects", async (request) => {
    const caller = await authenticate(request);
    return {
      projects: await query(
        `select p.id, p.title, p.status, p.quality_mode, p.aspect_ratio,
                p.target_duration_frames, p.frame_rate_num, p.frame_rate_den,
                p.thumbnail_asset_id, p.updated_at,
                (select count(*) from public.shots s where s.project_id = p.id) as shot_count
         from public.projects p
         where p.organization_id = $1 and p.deleted_at is null
         order by p.updated_at desc limit 100`,
        [caller.organization_id],
      ),
    };
  });

  app.post("/api/projects", async (request, reply) => {
    const caller = await authenticate(request);
    const body = CreateVideoRequest.parse(request.body);

    const projectId = await transaction(async (client) => {
      const project = await client.query<{ id: string }>(
        `insert into public.projects
           (organization_id, title, quality_mode, aspect_ratio, created_by, status)
         values ($1, $2, $3, $4, $5, 'planning')
         returning id`,
        [
          caller.organization_id,
          // A placeholder until the Director writes a brief and titles it.
          body.prompt.slice(0, 120),
          body.mode,
          body.aspect_ratio,
          caller.user_id,
        ],
      );
      const id = project.rows[0]!.id;

      await client.query(
        `insert into public.project_versions (project_id, organization_id, version, brief, created_by)
         values ($1, $2, 1, $3, $4)`,
        [id, caller.organization_id, { prompt: body.prompt, attachments: body.attachments }, caller.user_id],
      );
      await client.query(
        `insert into public.project_settings (project_id, organization_id, approval_gates)
         values ($1, $2, $3)`,
        [id, caller.organization_id, body.approval_gates],
      );
      return id;
    });

    return reply.status(201).send({ project_id: projectId });
  });

  app.get("/api/projects/:id", async (request) => {
    const caller = await authenticate(request);
    const { id } = Id.parse(request.params);
    await assertOwned("projects", id, caller);

    const [project, scenes, shots, job] = await Promise.all([
      queryOne(
        `select id, title, status, quality_mode, aspect_ratio, frame_rate_num, frame_rate_den,
                audio_sample_rate, target_duration_frames, thumbnail_asset_id, updated_at
         from public.projects where id = $1`,
        [id],
      ),
      query("select id, slug, index, summary from public.scenes where project_id = $1 order by index", [id]),
      query(
        `select id, slug, scene_id, index, duration_frames, shot_type, status, stale, stale_reasons,
                current_asset_id, current_version, requires_identity_lock, requires_product_fidelity
         from public.shots where project_id = $1 order by index`,
        [id],
      ),
      queryOne(
        `select id, status, progress, error_message, budget_spend
         from public.generation_jobs where project_id = $1
         order by created_at desc limit 1`,
        [id],
      ),
    ]);

    return { project, scenes, shots, job };
  });

  app.patch("/api/projects/:id", async (request) => {
    const caller = await authenticate(request);
    const { id } = Id.parse(request.params);
    await assertOwned("projects", id, caller);

    const body = z
      .object({ title: z.string().min(1).max(200).optional(), expected_updated_at: z.string().optional() })
      .parse(request.body);

    // Optimistic concurrency: a second tab holding a stale view is refused
    // rather than silently overwriting the newer edit (spec section 101).
    const updated = await queryOne<{ updated_at: string }>(
      `update public.projects set title = coalesce($2, title)
       where id = $1 and ($3::timestamptz is null or updated_at = $3::timestamptz)
       returning updated_at`,
      [id, body.title ?? null, body.expected_updated_at ?? null],
    );

    if (!updated) {
      const current = await queryOne<{ updated_at: string }>(
        "select updated_at from public.projects where id = $1",
        [id],
      );
      const error = new Error("This project changed in another tab; reload before saving.");
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw Object.assign(error, { current_updated_at: current?.updated_at });
    }

    return { updated_at: updated.updated_at };
  });

  app.post("/api/projects/:id/generate", async (request, reply) => {
    const caller = await authenticate(request);
    const { id } = Id.parse(request.params);
    await assertOwned("projects", id, caller);

    const project = await queryOne<{ quality_mode: string }>(
      "select quality_mode from public.projects where id = $1",
      [id],
    );

    const job = await queryOne<{ id: string }>(
      `insert into public.generation_jobs
         (organization_id, project_id, quality_mode, retry_budget, created_by)
       values ($1, $2, $3, $4, $5) returning id`,
      [caller.organization_id, id, project!.quality_mode, budgetFor(project!.quality_mode), caller.user_id],
    );

    const started = await startProduction({
      job_id: job!.id,
      project_id: id,
      organization_id: caller.organization_id,
      quality_mode: project!.quality_mode,
    });

    await queryOne(
      "update public.generation_jobs set workflow_id = $2, run_id = $3 where id = $1 returning id",
      [job!.id, started.workflow_id, started.run_id],
    );
    await queryOne("update public.projects set status = 'generating' where id = $1 returning id", [id]);

    return reply.status(202).send({ job_id: job!.id });
  });

  app.get("/api/jobs/:id", async (request) => {
    const caller = await authenticate(request);
    const { id } = Id.parse(request.params);
    await assertOwned("generation_jobs", id, caller);

    const job = await queryOne(
      `select id, status, progress, error_message, budget_spend, created_at, completed_at
       from public.generation_jobs where id = $1`,
      [id],
    );

    // Live state comes from the running workflow; the row is the fallback for
    // a job that finished or has not started.
    try {
      return { ...job, live: await getProgress(id) };
    } catch {
      return job;
    }
  });

  app.post("/api/jobs/:id/cancel", async (request) => {
    const caller = await authenticate(request);
    const { id } = Id.parse(request.params);
    await assertOwned("generation_jobs", id, caller);

    await queryOne(
      "update public.generation_jobs set cancel_requested = true where id = $1 returning id",
      [id],
    );
    await cancelProduction(id);
    return { cancelled: true };
  });
}
