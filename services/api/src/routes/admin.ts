import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne } from "@videoai/database";
import { breakdown, costPerApprovedShot } from "@videoai/usage";
import { authenticate, type Caller } from "../auth.js";

/**
 * Admin surface (spec section 83).
 *
 * Platform staff only. The licence review endpoint matters most of anything
 * here: it is the only place a model becomes routable, and the router's
 * fail-closed gate depends on nothing else being able to set that status.
 */

async function requireAdmin(request: Parameters<typeof authenticate>[0]): Promise<Caller> {
  const caller = await authenticate(request);
  const admin = await queryOne<{ user_id: string }>(
    "select user_id from public.platform_admins where user_id = $1",
    [caller.user_id],
  );
  if (!admin) {
    // Same answer as an unknown route: staff endpoints do not advertise
    // themselves to users who cannot use them.
    const error = new Error("Not found");
    (error as Error & { statusCode?: number }).statusCode = 404;
    throw error;
  }
  return caller;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/overview", async (request) => {
    await requireAdmin(request);
    const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

    const [jobs, queue, workers, cost] = await Promise.all([
      queryOne<{ total: string; completed: string; failed: string; review: string }>(
        `select count(*) as total,
                count(*) filter (where status = 'completed') as completed,
                count(*) filter (where status = 'failed') as failed,
                count(*) filter (where status = 'needs_review') as review
         from public.generation_jobs where created_at >= $1::timestamptz`,
        [since],
      ),
      queryOne<{ queued: string; running: string }>(
        `select count(*) filter (where status = 'queued') as queued,
                count(*) filter (where status not in ('queued','completed','failed','cancelled','needs_review')) as running
         from public.generation_jobs`,
      ),
      queryOne<{ total: string; healthy: string }>(
        "select count(*) as total, count(*) filter (where healthy) as healthy from public.gpu_workers",
      ),
      costPerApprovedShot(null, since),
    ]);

    const total = Number(jobs?.total ?? 0);
    return {
      window_days: 7,
      jobs: {
        total,
        completed: Number(jobs?.completed ?? 0),
        failed: Number(jobs?.failed ?? 0),
        needs_review: Number(jobs?.review ?? 0),
        success_rate: total === 0 ? 0 : Number(jobs?.completed ?? 0) / total,
      },
      queue: { queued: Number(queue?.queued ?? 0), running: Number(queue?.running ?? 0) },
      workers: { total: Number(workers?.total ?? 0), healthy: Number(workers?.healthy ?? 0) },
      cost,
    };
  });

  app.get("/api/admin/workers", async (request) => {
    await requireAdmin(request);
    return {
      workers: await query(
        `select worker_id, provider, lifecycle, profile, healthy, drain_requested,
                vram_total_bytes, vram_free_bytes, temperature_c, utilization_pct,
                queue_depth, cuda_version, compute_capability, last_seen_at, started_at
         from public.gpu_workers order by worker_id`,
      ),
    };
  });

  app.post("/api/admin/workers/:id/drain", async (request) => {
    await requireAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { drain } = z.object({ drain: z.boolean().default(true) }).parse(request.body ?? {});

    await queryOne(
      `update public.gpu_workers
       set drain_requested = $2, lifecycle = case when $2 then 'DRAINING' else 'READY' end
       where worker_id = $1 returning worker_id`,
      [id, drain],
    );
    return { worker_id: id, draining: drain };
  });

  app.get("/api/admin/models", async (request) => {
    await requireAdmin(request);
    return {
      models: await query(
        `select mr.model_id, mr.display_name, mr.kind, mr.adapter, mr.runtime,
                mv.version, mv.lifecycle, mv.required_profile, mv.required_vram_gib, mv.canary_weight,
                ml.license_name, ml.status as license_status, ml.commercial_use, ml.territories,
                ml.reviewed_at, ml.reviewed_by,
                exists (
                  select 1 from public.gpu_worker_models gwm
                  where gwm.model_id = mr.model_id and gwm.present and gwm.verified
                ) as installed
         from public.model_registry mr
         left join public.model_versions mv on mv.model_id = mr.model_id
         left join public.model_licenses ml on ml.model_id = mr.model_id
         order by mr.model_id, mv.version`,
      ),
    };
  });

  /**
   * Record a licence review.
   *
   * This is the gate. A model is routable only when someone approved its
   * licence here and separately promoted its version, and both are recorded
   * with who did it.
   */
  app.post("/api/admin/models/:id/license", async (request) => {
    const caller = await requireAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(["unknown", "pending_review", "approved", "blocked", "expired_review"]),
        commercial_use: z.boolean(),
        territories: z.array(z.string()).default(["*"]),
        license_name: z.string().min(1).optional(),
      })
      .parse(request.body);

    const updated = await queryOne<{ model_id: string }>(
      `update public.model_licenses
       set status = $2, commercial_use = $3, territories = $4,
           license_name = coalesce($5, license_name),
           reviewed_at = now(), reviewed_by = $6
       where model_id = $1 returning model_id`,
      [id, body.status, body.commercial_use, body.territories, body.license_name ?? null, caller.user_id],
    );
    if (!updated) {
      const error = new Error("Not found");
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    await queryOne(
      `insert into public.audit_events (actor_user_id, actor_kind, action, target_kind, target_id, metadata)
       values ($1, 'user', 'model.license_reviewed', 'model', $2, $3) returning id`,
      [caller.user_id, id, body],
    );

    return { model_id: id, status: body.status };
  });

  /** Promote, canary or roll back a model version. */
  app.post("/api/admin/models/:id/lifecycle", async (request) => {
    const caller = await requireAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        version: z.string().min(1),
        lifecycle: z.enum([
          "candidate", "testing", "benchmarking", "approved", "canary",
          "production", "deprecated", "license_blocked", "disabled",
        ]),
        canary_weight: z.number().min(0).max(1).default(0),
      })
      .parse(request.body);

    // Promotion requires an approved licence. Enforced here as well as in the
    // router, so a version cannot sit in production with a blocked licence.
    if (body.lifecycle === "production" || body.lifecycle === "canary") {
      const licence = await queryOne<{ status: string; commercial_use: boolean }>(
        "select status, commercial_use from public.model_licenses where model_id = $1",
        [id],
      );
      if (licence?.status !== "approved" || !licence.commercial_use) {
        const error = new Error(
          `${id} cannot be promoted: its licence is "${licence?.status ?? "unknown"}" ` +
            `and commercial use is ${licence?.commercial_use ? "granted" : "not granted"}.`,
        );
        (error as Error & { statusCode?: number }).statusCode = 409;
        throw error;
      }
    }

    await queryOne(
      `update public.model_versions set lifecycle = $3, canary_weight = $4
       where model_id = $1 and version = $2 returning id`,
      [id, body.version, body.lifecycle, body.canary_weight],
    );

    await queryOne(
      `insert into public.audit_events (actor_user_id, actor_kind, action, target_kind, target_id, metadata)
       values ($1, 'user', 'model.lifecycle_changed', 'model', $2, $3) returning id`,
      [caller.user_id, id, body],
    );

    return { model_id: id, ...body };
  });

  app.get("/api/admin/skills", async (request) => {
    await requireAdmin(request);
    return {
      skills: await query(
        `select sr.skill_id, sr.name, sr.category, sr.status, sr.current_version,
                sv.package_hash, sv.requires_skills,
                (select count(*) from public.skill_runs r where r.skill_id = sr.skill_id) as runs,
                (select count(*) from public.skill_runs r
                 where r.skill_id = sr.skill_id and r.status in ('fail','error')) as failures,
                (select max(score) from public.skill_evaluations e
                 where e.skill_id = sr.skill_id and e.skill_version = sr.current_version) as eval_score
         from public.skill_registry sr
         left join public.skill_versions sv
           on sv.skill_id = sr.skill_id and sv.version = sr.current_version
         order by sr.category, sr.skill_id`,
      ),
    };
  });

  app.get("/api/admin/quality", async (request) => {
    await requireAdmin(request);
    const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

    const [dimensions, reasons, repairs] = await Promise.all([
      query(
        `select m.dimension, avg(m.score) as average, count(*) as samples,
                count(*) filter (where not m.passed) as failures
         from public.quality_metrics m
         join public.quality_evaluations e on e.id = m.evaluation_id
         where e.created_at >= $1::timestamptz
         group by m.dimension order by 4 desc`,
        [since],
      ),
      query(
        `select code, severity, count(*) as occurrences
         from public.quality_findings where created_at >= $1::timestamptz
         group by code, severity order by 3 desc limit 25`,
        [since],
      ),
      queryOne<{ evaluations: string; repaired: string }>(
        `select count(distinct e.id) as evaluations, count(distinct rp.id) as repaired
         from public.quality_evaluations e
         left join public.repair_plans rp on rp.evaluation_id = e.id
         where e.created_at >= $1::timestamptz`,
        [since],
      ),
    ]);

    const evaluations = Number(repairs?.evaluations ?? 0);
    return {
      dimensions,
      failure_reasons: reasons,
      repair_rate: evaluations === 0 ? 0 : Number(repairs?.repaired ?? 0) / evaluations,
    };
  });

  app.get("/api/admin/costs", async (request) => {
    await requireAdmin(request);
    const { dimension, days } = z
      .object({
        dimension: z.enum(["user", "project", "model", "mode", "worker", "kind"]).default("model"),
        days: z.coerce.number().int().positive().max(365).default(30),
      })
      .parse(request.query);

    const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
    return {
      dimension,
      since,
      breakdown: await breakdown(null, dimension, since),
      per_approved_shot: await costPerApprovedShot(null, since),
    };
  });

  app.get("/api/admin/jobs", async (request) => {
    await requireAdmin(request);
    return {
      jobs: await query(
        `select j.id, j.status, j.quality_mode, j.created_at, j.completed_at,
                j.error_message, j.budget_spend, p.title
         from public.generation_jobs j
         join public.projects p on p.id = j.project_id
         order by j.created_at desc limit 100`,
      ),
    };
  });
}
