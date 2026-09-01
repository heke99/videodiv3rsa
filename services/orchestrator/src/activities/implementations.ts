import { ApplicationFailure } from "@temporalio/activity";
import { config } from "@videoai/config";
import type {
  AspectRatio,
  CapabilitySnapshot,
  Checkpoint,
  CreativeBrief,
  GenerateRequest,
  JobStatus,
  RepairPlan,
  RoutableKind,
  SceneBible,
  Script,
  Shot,
  ShotPlan,
} from "@videoai/contracts";
import { EXPORT_PRESETS } from "@videoai/contracts";
import { query, queryOne, transaction } from "@videoai/database";
import { compileShotPrompt, Director, LocalReasoningBackend, Planner, preflight } from "@videoai/director";
import { buildCapabilitySnapshot, loadRoutableModels, loadRoutingRules, route } from "@videoai/models";
import { availableProfiles } from "@videoai/gpu-manager";
import { planRepair as classifyRepair } from "@videoai/quality";
import { recordSkillRun, type SkillPackage } from "@videoai/skills";
import { adjustCredit } from "@videoai/usage";
import { METRICS, SPANS, metric, traced } from "@videoai/telemetry";

import {
  buildTimeline as buildTimelineActivity,
  composeFinal as composeFinalActivity,
  exportRenders as exportRendersActivity,
  recordShotTake as recordShotTakeActivity,
  runQualityControl,
} from "./delivery.js";
import {
  alignDialogue as alignDialogueActivity,
  generateAmbience as generateAmbienceActivity,
  generateDialogue as generateDialogueActivity,
} from "./audio.js";
import { dispatch } from "./generate.js";
import {
  generateReferences as generateReferencesActivity,
  persistEntities,
} from "./references.js";
import { skillCatalogue } from "./support.js";
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
 * Activities that are still not written.
 *
 * Empty, and that is the claim worth holding rather than deleting. Every stage
 * the production workflow calls now dispatches; against an empty fleet each one
 * fails with `NoCapacityError` -- "no worker holds this model" -- rather than
 * "nobody wrote this". The list stays so that an activity added without an
 * implementation has somewhere honest to be recorded, and so the boundary test
 * keeps asserting the difference between the two failures.
 */
export const UNIMPLEMENTED_ACTIVITIES = [] as const satisfies ReadonlyArray<keyof Activities>;

/**
 * Activities that dispatch to a GPU worker.
 *
 * Written, and reachable: with a worker registered they generate, and without
 * one they refuse by name. Exported so a test can hold both halves of that.
 */
export const DISPATCHING_ACTIVITIES = [
  "generateShot",
  "applyRepair",
  "generateDialogue",
  "alignDialogue",
  "generateAmbience",
  "generateReferences",
] as const satisfies ReadonlyArray<keyof Activities>;

/**
 * The span each activity runs inside.
 *
 * The names come from `SPANS`, which the spec fixed and which nothing emitted
 * until now. Held as a table rather than wrapped around each body: an activity
 * added without a span is then visible here as an absence, instead of silently
 * running untraced.
 */
const SPAN_FOR: Partial<Record<keyof Activities, string>> = {
  generateBrief: SPANS.planning,
  generateSceneBible: SPANS.planning,
  generateScript: SPANS.planning,
  generateShotPlan: SPANS.planning,
  runPreflight: SPANS.planning,
  routeShots: SPANS.planning,
  generateDialogue: SPANS.generation,
  alignDialogue: SPANS.generation,
  generateAmbience: SPANS.generation,
  generateReferences: SPANS.generation,
  generateShot: SPANS.generation,
  applyRepair: SPANS.generation,
  runQc: SPANS.qc,
  planRepair: SPANS.repair,
  buildTimeline: SPANS.render,
  composeFinal: SPANS.render,
  exportRenders: SPANS.render,
};

/**
 * Wrap every activity that has a span in one.
 *
 * `traced` records the failure and rethrows, so instrumentation cannot swallow
 * an error or change what the workflow sees. Bookkeeping activities are left
 * alone: they are a single statement each, and a span per checkpoint write
 * would bury the ones that matter.
 */
function instrument(activities: Activities): Activities {
  const traced_ = Object.fromEntries(
    Object.entries(activities).map(([name, fn]) => {
      const span = SPAN_FOR[name as keyof Activities];
      if (!span) return [name, fn];
      const call = fn as (input: unknown) => Promise<unknown>;
      return [
        name,
        (input: unknown) => traced(span, { activity: name, job_id: jobIdOf(input) }, () => call(input)),
      ];
    }),
  );
  return traced_ as unknown as Activities;
}

function jobIdOf(input: unknown): string | undefined {
  const id = (input as { job_id?: unknown } | null)?.job_id;
  return typeof id === "string" ? id : undefined;
}

/** The dimension that scored worst, which is the one a repair would go after. */
function lowestDimension(evaluation: { scores: Record<string, number | undefined> }): string {
  let worst: string | undefined;
  let lowest = Infinity;
  for (const [dimension, score] of Object.entries(evaluation.scores)) {
    if (score !== undefined && score < lowest) {
      lowest = score;
      worst = dimension;
    }
  }
  return worst ?? "unknown";
}

export function createActivities(): Activities {
  const planner = new Planner(new Director(LocalReasoningBackend.fromConfig(config())));

  // One catalogue read per process rather than per `createActivities` call,
  // shared with the stages that live in their own modules.
  const skills = skillCatalogue;

  return instrument({
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

      // The document alone is not enough. Characters, products, locations and
      // voices are queried relationally by the library, by dependency
      // invalidation and by the reference tables, and nothing had ever written
      // those rows -- so the library was empty and the Director was offered no
      // voices to cast. They belong here, where the entities become real,
      // rather than later beside the images made of them.
      const job = await requireJob(job_id);
      await persistEntities(job.organization_id, job.project_id, bible);
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
      const kinds = new Set<RoutableKind>(plan.shots.map((s) => s.preferred_generation_kind));
      // The stages that are not shots but that this plan will still reach.
      // Ambience runs for every approved take, so its model is required; speech
      // and alignment only when the plan actually has lines to speak. Narration
      // that belongs to no shot is not visible here, which is the one gap: it
      // surfaces at the stage instead of at preflight.
      kinds.add("video_to_audio");
      if (plan.shots.some((s) => s.dialogue_line_ids.length > 0)) {
        kinds.add("text_to_speech");
        kinds.add("alignment");
      }
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

    // -- GPU backed. These reserve a worker, dispatch a signed request and
    // record the attempt. With no worker holding the model they fail with
    // NoCapacityError, which says what is actually missing.
    async generateShot(input) {
      const { bible } = await documentsFor(input.job_id);
      const compiled = compileShotPrompt({
        shot: input.shot,
        bible,
        quality_mode: input.decision.qc_profile,
        required_skills: input.decision.skills,
        skills: await skills(),
        idempotency_key: input.idempotency_key,
      });

      const project = await projectShape(input.project_id);
      return dispatch({
        job_id: input.job_id,
        organization_id: input.organization_id,
        project_id: input.project_id,
        shot_slug: input.shot.id,
        attempt: input.attempt,
        idempotency_key: input.idempotency_key,
        decision: input.decision,
        request: {
          shot_id: input.shot.id,
          model_id: input.decision.model_id,
          model_version: input.decision.model_version,
          precision: input.decision.precision,
          prompt: compiled.prompt,
          negative_prompt: compiled.negative_prompt,
          references: referencesFor(input.shot),
          driving_audio: null,
          seed: compiled.seed,
          duration_frames: input.shot.duration_frames,
          fps_num: project.frame_rate_num,
          fps_den: project.frame_rate_den,
          resolution: project.resolution,
          settings: {},
        },
        asset: { kind: "video", role: "shot", mime: "video/mp4", extension: ".mp4" },
        provenance: { skill_versions: compiled.skill_versions },
      });
    },

    async applyRepair({ job_id, plan, decision, shot, idempotency_key, source_asset_id }) {
      const { bible } = await documentsFor(job_id);
      const job = await requireJob(job_id);
      const compiled = compileShotPrompt({
        shot,
        bible,
        quality_mode: decision.qc_profile,
        required_skills: decision.skills,
        skills: await skills(),
        idempotency_key,
      });

      const project = await projectShape(job.project_id);
      const output = await dispatch({
        job_id,
        organization_id: job.organization_id,
        project_id: job.project_id,
        shot_slug: shot.id,
        attempt: 1,
        idempotency_key,
        decision,
        request: {
          shot_id: shot.id,
          model_id: decision.model_id,
          model_version: decision.model_version,
          precision: decision.precision,
          prompt: compiled.prompt,
          negative_prompt: compiled.negative_prompt,
          references: referencesFor(shot),
          driving_audio: null,
          seed: compiled.seed,
          duration_frames: shot.duration_frames,
          fps_num: project.frame_rate_num,
          fps_den: project.frame_rate_den,
          resolution: project.resolution,
          // The repair's scope and actions travel to the adapter, which is what
          // makes a lipsync pass different from a regeneration on the worker.
          settings: { repair_scope: plan.scope, repair_actions: plan.actions },
        },
        asset: { kind: "video", role: "shot", mime: "video/mp4", extension: ".mp4" },
        provenance: { skill_versions: compiled.skill_versions },
        // The graph edge that makes "what was this repaired from" answerable.
        derived_from: source_asset_id ? { asset_id: source_asset_id, relationship: "repaired_from" } : null,
      });

      await recordRepairAttempt(job_id, job, plan, output.asset_id);
      return output;
    },

    async generateDialogue(input) {
      return generateDialogueActivity(input);
    },
    async alignDialogue(input) {
      return alignDialogueActivity(input);
    },
    async generateAmbience(input) {
      return generateAmbienceActivity(input);
    },
    async generateReferences(input) {
      return generateReferencesActivity(input);
    },

    // -- CPU bound. Measurement, arithmetic and ffmpeg; no GPU involved.
    async runQc(input) {
      const outcome = await runQualityControl(input);

      // Why a shot failed, not just that it did. The dimension that came in
      // lowest is what a repair would target, so it is the one worth counting
      // across a run.
      if (!outcome.evaluation.passed) {
        metric(METRICS.qcFailureReason, 1, {
          job_id: input.job_id,
          profile: input.qc_profile,
          reason: outcome.technical_passed ? lowestDimension(outcome.evaluation) : "technical",
        });
      }
      // Recorded every time, passed or not: coverage falling is how the panel
      // quietly stops checking things, and it only shows up as a trend.
      metric(METRICS.successRate, outcome.evaluation.passed ? 1 : 0, {
        job_id: input.job_id,
        coverage: outcome.coverage,
      });

      return {
        technical_passed: outcome.technical_passed,
        evaluation: outcome.evaluation,
        evaluation_id: outcome.evaluation_id,
        coverage: outcome.coverage,
      };
    },
    async planRepair({ job_id, shot, evaluation, budget, spend, required_skills }) {
      // The classifier owns scope, cost and the budget verdict. Asking a model
      // whether the remaining GPU seconds cover a lipsync pass would replace
      // arithmetic with an opinion, and the arithmetic is already tested.
      const decision = classifyRepair({ evaluation, subject_id: shot.id, budget, spend });
      if (decision.needs_review || decision.plan.scope === "none") {
        return { plan: decision.plan, needs_review: decision.needs_review, reason: decision.reason };
      }

      // Only a prompt repair needs words. Every other action the classifier
      // emits is a mechanical edit it has already specified in full.
      const prompted = decision.plan.actions.some((a) => a.action === "prompt_repair");
      if (!prompted) {
        return { plan: decision.plan, needs_review: false, reason: decision.reason };
      }

      const drafted = await planner.repairPlan(
        evaluation,
        shot,
        await planningContext(job_id, required_skills),
      );
      const wording = drafted.actions.find((a) => a.action === "prompt_repair");

      return {
        // The Director's scope, cost and choice of actions are discarded; only
        // the rationale and parameters of the prompt repair are taken.
        plan: {
          ...decision.plan,
          actions: decision.plan.actions.map((action) =>
            action.action === "prompt_repair" && wording
              ? { ...action, rationale: wording.rationale, params: wording.params }
              : action,
          ),
        },
        needs_review: false,
        reason: decision.reason,
      };
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
    async recordShotTake(input) {
      return recordShotTakeActivity(input);
    },

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
        [
          checkpoint.job_id,
          checkpoint.stage,
          checkpoint.unit_id,
          checkpoint.inputs_hash,
          checkpoint.result ?? null,
        ],
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
      metric(METRICS.generationTime, gpu_seconds, { job_id });
      if (repair_attempts) metric(METRICS.repairRate, repair_attempts, { job_id });

      // Preflight gates on the credit balance, and until now nothing ever
      // debited it: a job could spend all day against a number that never
      // moved. The ledger entry is what makes that gate mean something.
      if (cost_units > 0) {
        const job = await requireJob(job_id);
        await adjustCredit(job.organization_id, -cost_units, "generation", job_id);
      }

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
        await client.query("update public.generation_jobs set budget_spend = $2 where id = $1", [
          job_id,
          {
            generation_attempts: (current["generation_attempts"] ?? 0) + (generation_attempts ?? 0),
            repair_attempts: (current["repair_attempts"] ?? 0) + (repair_attempts ?? 0),
            gpu_seconds: (current["gpu_seconds"] ?? 0) + gpu_seconds,
            cost_units: (current["cost_units"] ?? 0) + cost_units,
          },
        ]);
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
  });

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

  /** The project's timebase and delivery resolution, which every request needs. */
  async function projectShape(projectId: string) {
    const row = await queryOne<{
      frame_rate_num: number;
      frame_rate_den: number;
      aspect_ratio: string;
    }>("select frame_rate_num, frame_rate_den, aspect_ratio from public.projects where id = $1", [projectId]);
    if (!row) throw ApplicationFailure.nonRetryable(`Project ${projectId} not found`);
    const preset = EXPORT_PRESETS[row.aspect_ratio as AspectRatio];
    if (!preset) {
      throw ApplicationFailure.nonRetryable(`No resolution for aspect ratio ${row.aspect_ratio}`);
    }
    return {
      frame_rate_num: row.frame_rate_num,
      frame_rate_den: row.frame_rate_den,
      resolution: { width: preset.width, height: preset.height },
    };
  }

  /**
   * The Scene Bible this job planned with.
   *
   * Read back from the stored version rather than threaded through the
   * workflow: a Temporal workflow replays its arguments, a Scene Bible is
   * large, and the version rows are the record anyway.
   */
  async function documentsFor(jobId: string) {
    const job = await requireJob(jobId);
    const bible = await queryOne<{ document: SceneBible }>(
      `select v.document
       from public.scene_bible_versions v
       join public.scene_bibles b on b.id = v.scene_bible_id and b.current_version = v.version
       where b.project_id = $1`,
      [job.project_id],
    );
    if (!bible) {
      throw ApplicationFailure.nonRetryable(`Project ${job.project_id} has no Scene Bible to generate from`);
    }
    return { bible: bible.document };
  }

  /**
   * Record the repair: the plan that was chosen, then one attempt per action.
   *
   * The schema splits them because a plan can name several actions and each one
   * either worked or did not; a single row would lose which part of a repair
   * was the part that failed.
   */
  async function recordRepairAttempt(
    jobId: string,
    job: { organization_id: string },
    plan: RepairPlan,
    assetId: string,
  ): Promise<void> {
    await transaction(async (client) => {
      const planRow = await client.query<{ id: string }>(
        `insert into public.repair_plans (organization_id, job_id, subject_id, scope, document)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [job.organization_id, jobId, plan.subject_id, plan.scope, plan],
      );
      const planId = planRow.rows[0]!.id;

      for (const [index, action] of plan.actions.entries()) {
        await client.query(
          `insert into public.repair_attempts
             (repair_plan_id, organization_id, attempt, action, target_id, status,
              result_asset_id, finished_at)
           values ($1, $2, $3, $4, $5, 'succeeded', $6, now())`,
          [planId, job.organization_id, index + 1, action.action, action.target_id, assetId],
        );
      }
    });
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
        [
          parentId,
          job.organization_id,
          document,
          (document as { schema_version?: string }).schema_version ?? "1.0",
        ],
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
            job.project_id,
            sceneId,
            job.organization_id,
            shot.id,
            shot.index,
            shot.duration_frames,
            shot.shot_type,
            shot.preferred_generation_kind,
            shot.requires_identity_lock,
            shot.requires_product_fidelity,
            shot.motion_complexity,
            shot.continuity_requirement,
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
 * Reference images a shot should be generated against.
 *
 * Keyframes first: a shot that starts from a given frame is the strongest
 * continuity tool the pipeline has, which is why the router prefers
 * image_to_video when one exists.
 */
function referencesFor(shot: Shot): GenerateRequest["references"] {
  const references: GenerateRequest["references"] = [];
  if (shot.start_frame_asset) {
    references.push({ role: "start_frame", asset: shot.start_frame_asset, strength: 1 });
  }
  if (shot.end_frame_asset) {
    references.push({ role: "end_frame", asset: shot.end_frame_asset, strength: 1 });
  }
  return references;
}
