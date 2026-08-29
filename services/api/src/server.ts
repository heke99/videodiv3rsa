import Fastify from "fastify";
import { z } from "zod";
import { config } from "@videoai/config";
import { CreateVideoRequest, type JobProgress } from "@videoai/contracts";
import { query, queryOne } from "@videoai/database";
import { budgetFor, cancelProduction, getProgress, startProduction } from "@videoai/orchestrator";
import { AuthError, assertOwned, authenticate } from "./auth.js";

/**
 * The public API. This is the only thing a browser talks to: it never reaches
 * a GPU worker, a model runtime or Temporal directly (spec section 77).
 */

const cfg = config();
const app = Fastify({ logger: { level: cfg.LOG_LEVEL } });

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AuthError) {
    return reply.status(error.status).send({ error: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: "Invalid request", issues: error.issues });
  }
  app.log.error(error);
  // Internal detail stays in the logs; the client gets a stable shape.
  return reply.status(500).send({ error: "Something went wrong on our side" });
});

app.get("/health", async () => ({ status: "ok" }));

app.get("/api/projects", async (request) => {
  const caller = await authenticate(request);
  return {
    projects: await query(
      `select id, title, status, quality_mode, aspect_ratio, target_duration_frames,
              thumbnail_asset_id, updated_at
       from public.projects
       where organization_id = $1 and deleted_at is null
       order by updated_at desc limit 50`,
      [caller.organization_id],
    ),
  };
});

app.post("/api/projects", async (request, reply) => {
  const caller = await authenticate(request);
  const body = CreateVideoRequest.parse(request.body);

  const project = await queryOne<{ id: string }>(
    `insert into public.projects
       (organization_id, title, quality_mode, aspect_ratio, created_by, status)
     values ($1, $2, $3, $4, $5, 'planning')
     returning id`,
    [
      caller.organization_id,
      // A placeholder title until the Director writes the brief.
      body.prompt.slice(0, 120),
      body.mode,
      body.aspect_ratio,
      caller.user_id,
    ],
  );

  await queryOne(
    `insert into public.project_versions (project_id, organization_id, version, brief, created_by)
     values ($1, $2, 1, $3, $4) returning id`,
    [project!.id, caller.organization_id, { prompt: body.prompt }, caller.user_id],
  );

  return reply.status(201).send({ project_id: project!.id });
});

app.post("/api/projects/:id/generate", async (request, reply) => {
  const caller = await authenticate(request);
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  await assertOwned("projects", id, caller);

  const project = await queryOne<{ quality_mode: string }>(
    "select quality_mode from public.projects where id = $1",
    [id],
  );

  const job = await queryOne<{ id: string }>(
    `insert into public.generation_jobs
       (organization_id, project_id, quality_mode, retry_budget, created_by)
     values ($1, $2, $3, $4, $5)
     returning id`,
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

  return reply.status(202).send({ job_id: job!.id });
});

app.get("/api/jobs/:id", async (request) => {
  const caller = await authenticate(request);
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  await assertOwned("generation_jobs", id, caller);

  const job = await queryOne<{ status: string; progress: JobProgress; error_message: string | null }>(
    "select status, progress, error_message from public.generation_jobs where id = $1",
    [id],
  );

  // Live progress comes from the running workflow; the stored row is the
  // fallback for a job that has finished or has not started yet.
  try {
    return { ...job, live: await getProgress(id) };
  } catch {
    return job;
  }
});

app.post("/api/jobs/:id/cancel", async (request) => {
  const caller = await authenticate(request);
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  await assertOwned("generation_jobs", id, caller);

  await queryOne(
    "update public.generation_jobs set cancel_requested = true where id = $1 returning id",
    [id],
  );
  await cancelProduction(id);
  return { cancelled: true };
});

const port = Number(process.env["PORT"] ?? 8000);
await app.listen({ port, host: "0.0.0.0" });
