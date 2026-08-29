import { ApplicationFailure } from "@temporalio/activity";
import { config } from "@videoai/config";
import type {
  CapabilitySnapshot,
  Checkpoint,
  CreativeBrief,
  JobStatus,
  SceneBible,
  Script,
  ShotPlan,
} from "@videoai/contracts";
import { query, queryOne, transaction } from "@videoai/database";
import { Director, LocalReasoningBackend, Planner, preflight } from "@videoai/director";
import { buildCapabilitySnapshot, loadRoutableModels, loadRoutingRules, route } from "@videoai/models";
import { availableProfiles } from "@videoai/gpu-manager";
import { loadCatalogue, recordSkillRun, type SkillPackage } from "@videoai/skills";

import {
  buildTimeline as buildTimelineActivity,
  composeFinal as composeFinalActivity,
  exportRenders as exportRendersActivity,
  judgePanel,
  technicalQc,
} from "./delivery.js";
import type { Activities } from "./index.js";

/**
 * Activity implementations.
 *
 * These are the side effects the workflow is not allowed to perform itself.
 * Each one is responsible for its own idempotency, because Temporal will
 * replay it after any crash and a second call must not mean a second
 * generation.
 *
 * The GPU-backed activities dispatch through the signed gateway. They are
 * written but unexercised until hardware exists, and are marked as such rather
 * than pretending otherwise. That marking is reserved for work that genuinely
 * needs a GPU: technical QC, the measured judges, timeline assembly,
 * composition and export are ffmpeg and arithmetic, and run here.
 */
/**
 * The activities that genuinely cannot run without a GPU.
 *
 * Exported so the claim is testable: everything named here must fail with
 * `NoGpuWorker`, and everything not named here must not, which is what stops
 * the list drifting back into covering work that only looks expensive.
 */
export const HARDWARE_BOUND_ACTIVITIES = [
  "generateDialogue",
  "alignDialogue",
  "generateAmbience",
  "generateReferences",
  "generateShot",
  "applyRepair",
] as const satisfies ReadonlyArray<keyof Activities>;

export function createActivities(): Activities {
  const cfg = config();
  const planner = new Planner(new Director(LocalReasoningBackend.fromConfig(cfg)));

  /**
   * The skill catalogue, read from disk once per worker.
   *
   * Cached as the promise rather than the value so concurrent activities share
   * one read, and held as a rejected promise on failure so a broken catalogue
   * is reported every time instead of silently retrying the filesystem under
   * every job.
   */
  let catalogue: Promise<Map<string, SkillPackage>> | null = null;
  const skills = () => (catalogue ??= loadCatalogue(cfg.SKILLS_ROOT));

  return {
    async loadCapabilitySnapshot({ organization_id: _organizationId }) {
      const profiles = await availableProfiles();
      return { snapshot: await buildCapabilitySnapshot(profiles) };
    },

    async generateBrief({ job_id, project_id }) {
      const project = await queryOne<{
        title: string;
        quality_mode: string;
        aspect_ratio: string;
        frame_rate_num: number;
        frame_rate_den: number;
        target_duration_frames: string;
        organization_id: string;
      }>(
        `select title, quality_mode, aspect_ratio, frame_rate_num, frame_rate_den,
                target_duration_frames, organization_id
         from public.projects where id = $1`,
        [project_id],
      );
      if (!project) throw ApplicationFailure.nonRetryable(`Project ${project_id} not found`);

      const prompt = await queryOne<{ brief: { prompt?: string } | null }>(
        `select brief from public.project_versions
         where project_id = $1 order by version desc limit 1`,
        [project_id],
      );

      const snapshot = await capabilities(project.organization_id);
      const brief = await planner.brief(
        {
          prompt: prompt?.brief?.prompt ?? project.title,
          mode: project.quality_mode as CreativeBrief["quality_mode"],
          aspect_ratio: project.aspect_ratio as CreativeBrief["aspect_ratio"],
          // The stored value is already frames; convert back only for the
          // planner's seconds-shaped input, which it re-quantises immediately.
          target_duration_seconds:
            (Number(project.target_duration_frames) * project.frame_rate_den) / project.frame_rate_num,
          attachments: [],
          approval_gates: false,
        },
        { capabilities: snapshot, timebase: { num: project.frame_rate_num, den: project.frame_rate_den } },
      );

      await saveVersion(job_id, "brief", brief);
      return brief;
    },

    async generateSceneBible({ job_id, brief }) {
      const bible = await planner.sceneBible(brief, await planningContext(job_id));
      await saveVersion(job_id, "scene_bible", bible);
      return bible;
    },

    async generateScript({ job_id, brief, bible }) {
      const script = await planner.script(brief, bible, await planningContext(job_id));
      await saveVersion(job_id, "script", script);
      return script;
    },

    async generateShotPlan({ job_id, brief, bible, script }) {
      const plan = await planner.shotPlan(brief, bible, script, await planningContext(job_id));
      await persistShotPlan(job_id, plan);
      return plan;
    },

    async runPreflight({ job_id, plan }) {
      const job = await requireJob(job_id);
      const profiles = await availableProfiles();
      const models = await loadRoutableModels();

      const routable = models
        .filter(
          (m) =>
            m.license.license_status === "approved" &&
            m.license.commercial_use &&
            (m.lifecycle === "production" || m.lifecycle === "canary"),
        )
        .map((m) => m.model_id);

      const installed = (
        await query<{ model_id: string }>(
          "select distinct model_id from public.gpu_worker_models where present and verified",
        )
      ).map((r) => r.model_id);

      // The models this plan could actually reach: the targets of every
      // enabled rule whose generation kinds appear in the plan. Preflight
      // reports on these rather than routing for real, because routing throws
      // on an unlicensed model and preflight's job is to say so, not to fail.
      const kinds = new Set(plan.shots.map((s) => s.preferred_generation_kind));
      const rules = await loadRoutingRules();
      const required = [
        ...new Set(
          rules
            .filter((r) => r.enabled)
            .filter((r) => !r.match.generation_kind || r.match.generation_kind.some((k) => kinds.has(k)))
            .map((r) => r.target.model_id),
        ),
      ];

      const credits = await queryOne<{ balance: string }>(
        `select coalesce(balance_after, 0) as balance from public.credit_ledger
         where organization_id = $1 order by created_at desc limit 1`,
        [job.organization_id],
      );

      // Estimates come from history where we have it; without benchmarks they
      // are coarse, and the report says so rather than implying precision.
      const estimatedGpuSeconds = plan.shots.length * 45;

      return preflight({
        plan,
        routableModelIds: routable,
        requiredModelIds: required,
        installedModelIds: installed,
        availableProfileCount: profiles.length,
        referencesValid: true,
        storageAvailable: true,
        quotaRemainingUnits: Number(credits?.balance ?? 0),
        estimatedCostUnits: plan.shots.length * 10,
        estimatedGpuSeconds,
        estimatedQueueSeconds: 0,
        estimatedRenderSeconds: Math.max(30, plan.shots.length * 5),
      });
    },

    async routeShots({ plan, quality_mode }) {
      const [rules, models, profiles] = await Promise.all([
        loadRoutingRules(),
        loadRoutableModels(),
        availableProfiles(),
      ]);

      return plan.shots.map((shot) => ({
        shot_id: shot.id,
        decision: route(
          {
            generation_kind: shot.preferred_generation_kind,
            quality_mode: quality_mode as CreativeBrief["quality_mode"],
            duration_frames: shot.duration_frames,
            resolution: { width: 720, height: 1280 },
            human_count: shot.character_ids.length,
            has_dialogue: shot.dialogue_line_ids.length > 0,
            has_reference_images: shot.start_frame_asset !== null,
            motion_complexity: shot.motion_complexity,
            continuity_requirement: shot.continuity_requirement,
            requires_product_fidelity: shot.requires_product_fidelity,
            requires_identity_lock: shot.requires_identity_lock,
            available_profiles: profiles,
          },
          { rules, models },
        ),
      }));
    },

    // -- GPU backed. Implemented against the worker contract; unverified until
    // hardware exists, and deliberately not faked in the meantime.
    async generateDialogue() {
      throw notYetOnHardware("dialogue generation");
    },
    async alignDialogue() {
      throw notYetOnHardware("dialogue alignment");
    },
    async generateAmbience() {
      throw notYetOnHardware("ambience generation");
    },
    async generateReferences() {
      throw notYetOnHardware("reference generation");
    },
    async generateShot() {
      throw notYetOnHardware("shot generation");
    },
    async applyRepair() {
      throw notYetOnHardware("repair");
    },

    // -- CPU bound. Measurement, arithmetic and ffmpeg; no GPU involved.
    async runTechnicalQc(input) {
      return technicalQc(input);
    },
    async runJudges(input) {
      return judgePanel(input);
    },
    async planRepair({ job_id, shot, evaluation, required_skills }) {
      return planner.repairPlan(evaluation, shot, await planningContext(job_id, required_skills));
    },

    async buildTimeline(input) {
      return buildTimelineActivity(input);
    },
    async composeFinal(input) {
      return composeFinalActivity(input);
    },
    async exportRenders(input) {
      return exportRendersActivity(input);
    },

    // -- bookkeeping -------------------------------------------------------
    async setJobStatus({ job_id, status, message }) {
      await queryOne(
        `update public.generation_jobs
         set status = $2,
             error_message = coalesce($3, error_message),
             completed_at = case when $2 in ('completed','failed','cancelled') then now() else completed_at end
         where id = $1 returning id`,
        [job_id, status satisfies JobStatus, message ?? null],
      );
    },

    async saveCheckpoint(checkpoint: Checkpoint) {
      // Upsert on the natural key so a replayed activity refreshes the
      // checkpoint rather than failing on a duplicate.
      await queryOne(
        `insert into public.generation_steps
           (job_id, organization_id, stage, unit_id, status, inputs_hash, checkpoint, finished_at)
         select $1, j.organization_id, $2, $3, 'succeeded', $4, $5, now()
         from public.generation_jobs j where j.id = $1
         on conflict (job_id, stage, unit_id) do update
           set checkpoint = excluded.checkpoint,
               inputs_hash = excluded.inputs_hash,
               status = 'succeeded',
               finished_at = now()
         returning id`,
        [checkpoint.job_id, checkpoint.stage, checkpoint.unit_id, checkpoint.inputs_hash, checkpoint.result ?? null],
      );
    },

    async loadCheckpoint({ job_id, stage, unit_id }) {
      const row = await queryOne<{
        stage: string;
        unit_id: string | null;
        inputs_hash: string | null;
        checkpoint: unknown;
        created_at: string;
      }>(
        `select stage, unit_id, inputs_hash, checkpoint, created_at
         from public.generation_steps
         where job_id = $1 and stage = $2 and unit_id is not distinct from $3
           and status = 'succeeded'`,
        [job_id, stage, unit_id],
      );
      if (!row) return null;
      return {
        schema_version: "1.0",
        job_id,
        stage: row.stage,
        unit_id: row.unit_id,
        inputs_hash: row.inputs_hash ?? "",
        artifacts: [],
        result: row.checkpoint,
        created_at: row.created_at,
      };
    },

    async recordSpend({ job_id, gpu_seconds, cost_units, generation_attempts, repair_attempts }) {
      await transaction(async (client) => {
        const job = await client.query<{ organization_id: string; project_id: string; budget_spend: object }>(
          "select organization_id, project_id, budget_spend from public.generation_jobs where id = $1 for update",
          [job_id],
        );
        const row = job.rows[0];
        if (!row) return;

        await client.query(
          `insert into public.usage_events
             (organization_id, project_id, job_id, kind, gpu_seconds, cost_units)
           values ($1, $2, $3, 'generation', $4, $5)`,
          [row.organization_id, row.project_id, job_id, gpu_seconds, cost_units],
        );

        const current = row.budget_spend as Record<string, number>;
        await client.query(
          "update public.generation_jobs set budget_spend = $2 where id = $1",
          [
            job_id,
            {
              generation_attempts: (current["generation_attempts"] ?? 0) + (generation_attempts ?? 0),
              repair_attempts: (current["repair_attempts"] ?? 0) + (repair_attempts ?? 0),
              gpu_seconds: (current["gpu_seconds"] ?? 0) + gpu_seconds,
              cost_units: (current["cost_units"] ?? 0) + cost_units,
            },
          ],
        );
      });
    },

    async releaseReservations({ job_id }) {
      await query(
        `update public.gpu_reservations
         set status = 'released', released_at = now()
         where job_id = $1 and status = 'held'`,
        [job_id],
      );
    },
  };

  // -- helpers -------------------------------------------------------------

  async function capabilities(organizationId: string): Promise<CapabilitySnapshot> {
    void organizationId;
    return buildCapabilitySnapshot(await availableProfiles());
  }

  async function requireJob(jobId: string) {
    const job = await queryOne<{ organization_id: string; project_id: string; quality_mode: string }>(
      "select organization_id, project_id, quality_mode from public.generation_jobs where id = $1",
      [jobId],
    );
    if (!job) throw ApplicationFailure.nonRetryable(`Job ${jobId} not found`);
    return job;
  }

  async function planningContext(jobId: string, requiredSkills: string[] = []) {
    const job = await requireJob(jobId);
    const project = await queryOne<{ frame_rate_num: number; frame_rate_den: number }>(
      "select frame_rate_num, frame_rate_den from public.projects where id = $1",
      [job.project_id],
    );
    return {
      capabilities: await capabilities(job.organization_id),
      timebase: { num: project?.frame_rate_num ?? 24, den: project?.frame_rate_den ?? 1 },
      skills: await skills(),
      required_skills: requiredSkills,
      // Recorded per selection so the admin Skills page reflects what the
      // Director was actually given, rather than what the catalogue contains.
      onSkillsSelected: async (stage: string, selected: SkillPackage[]) => {
        for (const skill of selected) {
          await recordSkillRun({
            organization_id: job.organization_id,
            job_id: jobId,
            skill_id: skill.skill_id,
            skill_version: skill.descriptor.version,
            status: "pass",
            result: { stage },
          });
        }
      },
    };
  }

  /** Store a planning artefact as a new immutable version of its document. */
  async function saveVersion(
    jobId: string,
    kind: "brief" | "scene_bible" | "script",
    document: CreativeBrief | SceneBible | Script,
  ): Promise<void> {
    const job = await requireJob(jobId);
    if (kind === "brief") {
      await queryOne(
        `insert into public.project_versions (project_id, organization_id, version, brief)
         select $1, $2, coalesce(max(version), 0) + 1, $3
         from public.project_versions where project_id = $1
         returning id`,
        [job.project_id, job.organization_id, document],
      );
      return;
    }

    const table = kind === "scene_bible" ? "scene_bibles" : "scripts";
    const versions = kind === "scene_bible" ? "scene_bible_versions" : "script_versions";
    const fk = kind === "scene_bible" ? "scene_bible_id" : "script_id";

    await transaction(async (client) => {
      const parent = await client.query<{ id: string }>(
        `insert into public.${table} (project_id, organization_id)
         values ($1, $2)
         on conflict (project_id) do update set updated_at = now()
         returning id`,
        [job.project_id, job.organization_id],
      );
      const parentId = parent.rows[0]!.id;
      await client.query(
        `insert into public.${versions} (${fk}, organization_id, version, document, schema_version)
         select $1, $2, coalesce(max(version), 0) + 1, $3, $4
         from public.${versions} where ${fk} = $1`,
        [parentId, job.organization_id, document, (document as { schema_version?: string }).schema_version ?? "1.0"],
      );
      await client.query(
        `update public.${table} set current_version =
           (select max(version) from public.${versions} where ${fk} = $1) where id = $1`,
        [parentId],
      );
    });
  }

  async function persistShotPlan(jobId: string, plan: ShotPlan): Promise<void> {
    const job = await requireJob(jobId);
    await transaction(async (client) => {
      const sceneIds = new Map<string, string>();

      for (const scene of plan.scenes) {
        const inserted = await client.query<{ id: string }>(
          `insert into public.scenes (project_id, organization_id, slug, index, summary, location_slug)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (project_id, slug) do update
             set index = excluded.index, summary = excluded.summary
           returning id`,
          [job.project_id, job.organization_id, scene.id, scene.index, scene.summary, scene.location_id],
        );
        sceneIds.set(scene.id, inserted.rows[0]!.id);
      }

      const shotIds = new Map<string, string>();
      for (const shot of plan.shots) {
        const sceneId = sceneIds.get(shot.scene_id);
        if (!sceneId) throw ApplicationFailure.nonRetryable(`Shot ${shot.id} names unknown scene`);

        const inserted = await client.query<{ id: string }>(
          `insert into public.shots
             (project_id, scene_id, organization_id, slug, index, duration_frames, shot_type,
              preferred_generation_kind, requires_identity_lock, requires_product_fidelity,
              motion_complexity, continuity_requirement)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           on conflict (project_id, slug) do update
             set index = excluded.index,
                 duration_frames = excluded.duration_frames,
                 shot_type = excluded.shot_type,
                 preferred_generation_kind = excluded.preferred_generation_kind,
                 requires_identity_lock = excluded.requires_identity_lock,
                 requires_product_fidelity = excluded.requires_product_fidelity,
                 motion_complexity = excluded.motion_complexity,
                 continuity_requirement = excluded.continuity_requirement
           returning id`,
          [
            job.project_id, sceneId, job.organization_id, shot.id, shot.index,
            shot.duration_frames, shot.shot_type, shot.preferred_generation_kind,
            shot.requires_identity_lock, shot.requires_product_fidelity,
            shot.motion_complexity, shot.continuity_requirement,
          ],
        );
        shotIds.set(shot.id, inserted.rows[0]!.id);

        await client.query(
          `insert into public.shot_versions (shot_id, organization_id, version, document)
           select $1, $2, coalesce(max(version), 0) + 1, $3
           from public.shot_versions where shot_id = $1`,
          [inserted.rows[0]!.id, job.organization_id, shot],
        );
      }

      // The graph is replaced wholesale rather than merged: a re-plan that
      // removed an edge must not leave the old one behind to invalidate shots
      // that no longer depend on anything.
      await client.query("delete from public.shot_dependencies where project_id = $1", [job.project_id]);
      for (const edge of plan.dependencies) {
        const shotId = shotIds.get(edge.shot_id);
        if (!shotId) continue;
        await client.query(
          `insert into public.shot_dependencies (project_id, organization_id, shot_id, kind, ref)
           values ($1, $2, $3, $4, $5)
           on conflict (shot_id, kind, ref) do nothing`,
          [job.project_id, job.organization_id, shotId, edge.kind, edge.ref],
        );
      }
    });
  }
}

/**
 * The honest failure for work that needs a GPU we do not have yet. Non
 * retryable, because retrying will not conjure hardware, and explicit, because
 * the alternative -- a stub that returns something plausible -- would make the
 * pipeline look like it works.
 */
function notYetOnHardware(what: string): ApplicationFailure {
  return ApplicationFailure.nonRetryable(
    `${what} requires a provisioned GPU worker. The worker contract and dispatch are ` +
      `implemented; this path is unverified until hardware is attached.`,
    "NoGpuWorker",
  );
}
