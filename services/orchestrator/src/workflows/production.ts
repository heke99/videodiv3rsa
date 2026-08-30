import {
  ApplicationFailure,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import type {
  BudgetSpend,
  JobProgress,
  JobStatus,
  RepairScope,
  RoutingDecision,
  Shot,
  ShotPlan,
} from "@videoai/contracts";
import { JOB_STATUS_TO_STEP } from "@videoai/contracts";
import type { Activities } from "../activities/index.js";
import { budgetFor, checkBudget, spend, ZERO_SPEND } from "../budget.js";

/**
 * The production workflow (spec section 48).
 *
 * Temporal replays this function to reconstruct state after a crash, so it is
 * pure orchestration: no clock, no network, no randomness. Every checkpoint is
 * written by an activity, which is what makes a failure during scene eight
 * resume at scene eight rather than at the brief.
 */

const activities = proxyActivities<Activities>({
  startToCloseTimeout: "30 minutes",
  retry: {
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
    // A budget that is already spent, or a licence that is not approved, will
    // not become true by trying again.
    nonRetryableErrorTypes: ["BudgetExhaustedError", "LicenseBlockedError", "RoutingError"],
  },
});

/** Planning is cheap and slow; generation is expensive and slow. Different shapes. */
const planning = proxyActivities<Activities>({
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 3, nonRetryableErrorTypes: ["DirectorSchemaError"] },
});

const bookkeeping = proxyActivities<Activities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 5 },
});

/**
 * Repair scopes that change nothing a vision judge can see.
 *
 * Captions, timing and levels are deterministic edits to the mix and the
 * subtitle track; re-running the identity or hands judges over them would spend
 * GPU time to be told what they already said. A re-check after one of these
 * needs the measured panel only.
 */
const DETERMINISTIC_REPAIRS: readonly RepairScope[] = ["caption", "timing", "audio"];

export const cancelSignal = defineSignal("cancel");
export const progressQuery = defineQuery<JobProgress>("progress");

export interface ProductionInput {
  job_id: string;
  project_id: string;
  organization_id: string;
  quality_mode: string;
}

export interface ProductionResult {
  status: JobStatus;
  render_asset_id: string | null;
  export_ids: string[];
  shots_approved: number;
  shots_needing_review: string[];
  spend: BudgetSpend;
}

export async function production(input: ProductionInput): Promise<ProductionResult> {
  const budget = budgetFor(input.quality_mode);
  let currentSpend: BudgetSpend = ZERO_SPEND;
  let cancelled = false;
  let status: JobStatus = "queued";
  let completedUnits = 0;
  let totalUnits = 0;

  // Cancellation stops future stages and lets the current one finish, so
  // completed work is kept and the GPU reservation is released cleanly
  // (spec section 50).
  setHandler(cancelSignal, () => {
    cancelled = true;
  });

  setHandler(progressQuery, () => ({
    job_id: input.job_id,
    status,
    step: JOB_STATUS_TO_STEP[status],
    completed_units: completedUnits,
    total_units: totalUnits,
    message: "",
    // workflowInfo is replay-safe; Date.now() would not be.
    updated_at: new Date(workflowInfo().startTime).toISOString(),
  }));

  const advance = async (next: JobStatus): Promise<void> => {
    status = next;
    await bookkeeping.setJobStatus({ job_id: input.job_id, status: next });
  };

  const stopIfCancelled = (): boolean => cancelled;

  try {
    // -- planning ----------------------------------------------------------
    await advance("planning");
    const brief = await planning.generateBrief({ job_id: input.job_id, project_id: input.project_id });
    if (stopIfCancelled()) return await finish("cancelled");

    const bible = await planning.generateSceneBible({ job_id: input.job_id, brief });
    if (stopIfCancelled()) return await finish("cancelled");

    await advance("generating_script");
    const script = await planning.generateScript({ job_id: input.job_id, brief, bible });

    const plan: ShotPlan = await planning.generateShotPlan({
      job_id: input.job_id,
      brief,
      bible,
      script,
    });
    totalUnits = plan.shots.length;

    // -- preflight ---------------------------------------------------------
    await advance("preflight");
    const report = await planning.runPreflight({ job_id: input.job_id, plan });
    if (!report.passed) {
      // Failing here costs nothing; failing twenty shots later costs real money.
      throw ApplicationFailure.nonRetryable(
        `Preflight blocked this job:\n${report.blockers.join("\n")}`,
        "PreflightBlocked",
      );
    }

    const routes = await planning.routeShots({
      job_id: input.job_id,
      plan,
      quality_mode: input.quality_mode,
    });
    const decisions = new Map(routes.map((r) => [r.shot_id, r.decision]));

    // -- audio first -------------------------------------------------------
    // Speech is generated and aligned before any talking shot, so the video
    // model receives the audio that will actually ship rather than having a
    // voice forced onto it afterwards (spec section 19).
    await advance("generating_audio");
    const dialogue = await activities.generateDialogue({ job_id: input.job_id, script, bible });

    await advance("syncing");
    await activities.alignDialogue({
      job_id: input.job_id,
      dialogue_asset_ids: dialogue.map((d) => d.asset_id),
    });
    if (stopIfCancelled()) return await finish("cancelled");

    // -- references --------------------------------------------------------
    await advance("generating_references");
    await activities.generateReferences({ job_id: input.job_id, bible });
    await advance("reference_qc");

    // -- shots -------------------------------------------------------------
    await advance("generating_shots");
    const shotAssets: Record<string, string> = {};
    const needsReview: string[] = [];

    for (const shot of plan.shots) {
      if (stopIfCancelled()) break;

      const decision = decisions.get(shot.id);
      if (!decision) {
        throw ApplicationFailure.nonRetryable(`No routing decision for shot ${shot.id}`, "RoutingError");
      }

      const outcome = await produceShot(shot, decision);
      currentSpend = outcome.spend;
      completedUnits += 1;

      if (outcome.asset_id) {
        shotAssets[shot.id] = outcome.asset_id;
      } else {
        needsReview.push(shot.id);
      }
    }

    if (stopIfCancelled()) return await finish("cancelled");

    // A production where some shots could not reach the bar goes to review
    // rather than shipping a film with holes in it.
    if (needsReview.length > 0) {
      return await finish("needs_review", { needsReview, shotAssets });
    }

    // -- delivery ----------------------------------------------------------
    await advance("audio_generation");
    await activities.generateAmbience({ job_id: input.job_id, shot_ids: plan.shots.map((s) => s.id) });

    const { timeline_id } = await activities.buildTimeline({
      job_id: input.job_id,
      plan,
      shot_assets: shotAssets,
    });

    await advance("final_render");
    const render = await activities.composeFinal({ job_id: input.job_id, timeline_id });

    await advance("final_qc");
    const exports = await activities.exportRenders({
      job_id: input.job_id,
      render_asset_id: render.asset_id,
    });

    await advance("completed");
    return {
      status: "completed",
      render_asset_id: render.asset_id,
      export_ids: exports.export_ids,
      shots_approved: Object.keys(shotAssets).length,
      shots_needing_review: [],
      spend: currentSpend,
    };
  } finally {
    // Whatever happened, the GPU must not stay reserved.
    await bookkeeping.releaseReservations({ job_id: input.job_id });
  }

  /**
   * Generate one shot, then QC it, then repair it, within the job's budget.
   *
   * The loop is bounded twice over: by attempts and by spend. It returns
   * without an asset rather than looping when neither can produce something
   * that passes.
   */
  async function produceShot(
    shot: Shot,
    decision: RoutingDecision,
  ): Promise<{ asset_id: string | null; spend: BudgetSpend }> {
    let working = currentSpend;

    for (let attempt = 1; attempt <= budget.max_generation_attempts; attempt++) {
      const check = checkBudget(budget, working);
      if (!check.ok) return { asset_id: null, spend: working };

      const generated = await activities.generateShot({
        job_id: input.job_id,
        organization_id: input.organization_id,
        project_id: input.project_id,
        shot,
        decision,
        attempt,
        idempotency_key: `${input.job_id}:${shot.id}:${attempt}:${decision.model_id}`,
      });

      working = spend(working, {
        generation_attempts: 1,
        gpu_seconds: generated.gpu_seconds,
        cost_units: generated.cost_units,
      });
      await bookkeeping.recordSpend({
        job_id: input.job_id,
        gpu_seconds: generated.gpu_seconds,
        cost_units: generated.cost_units,
        generation_attempts: 1,
      });

      // Measurement before judgement: a broken file should not cost judge time.
      // runQc short-circuits on a technical failure and records why.
      await advance("shot_qc");
      let qc = await activities.runQc({
        job_id: input.job_id,
        asset_id: generated.asset_id,
        shot,
        qc_profile: decision.qc_profile,
      });
      if (!qc.technical_passed) continue;

      await bookkeeping.recordShotTake({
        job_id: input.job_id,
        shot_id: shot.id,
        asset_id: generated.asset_id,
        evaluation_id: qc.evaluation_id,
        passed: qc.evaluation.passed,
      });
      if (qc.evaluation.passed) return { asset_id: generated.asset_id, spend: working };

      // Repair before regeneration: a shot that is right except for the mouth
      // should cost one lip sync pass, not a whole new shot.
      for (let repair = 1; repair <= budget.max_repair_attempts; repair++) {
        if (!checkBudget(budget, working).ok) break;

        await advance("repairing");
        const repairPlan = await activities.planRepair({
          job_id: input.job_id,
          shot,
          evaluation: qc.evaluation,
          required_skills: decision.skills,
        });
        if (repairPlan.scope === "none" || repairPlan.scope === "shot") break;

        const repaired = await activities.applyRepair({
          job_id: input.job_id,
          plan: repairPlan,
          idempotency_key: `${input.job_id}:${shot.id}:${attempt}:repair:${repair}`,
        });
        working = spend(working, {
          repair_attempts: 1,
          gpu_seconds: repaired.gpu_seconds,
          cost_units: repaired.cost_units,
        });
        await bookkeeping.recordSpend({
          job_id: input.job_id,
          gpu_seconds: repaired.gpu_seconds,
          cost_units: repaired.cost_units,
          repair_attempts: 1,
        });

        // A deterministic repair changes captions, timing or levels and cannot
        // touch anything a vision judge looks at, so re-running the full panel
        // would spend GPU time to be told what it already said.
        const assetId = repaired.asset_id;
        qc = await activities.runQc({
          job_id: input.job_id,
          asset_id: assetId,
          shot,
          qc_profile: decision.qc_profile,
          measured_only: DETERMINISTIC_REPAIRS.includes(repairPlan.scope),
        });

        await bookkeeping.recordShotTake({
          job_id: input.job_id,
          shot_id: shot.id,
          asset_id: assetId,
          evaluation_id: qc.evaluation_id,
          passed: qc.evaluation.passed,
        });
        if (qc.evaluation.passed) return { asset_id: assetId, spend: working };
      }

      await advance("generating_shots");
    }

    return { asset_id: null, spend: working };
  }

  async function finish(
    final: JobStatus,
    extra: { needsReview?: string[]; shotAssets?: Record<string, string> } = {},
  ): Promise<ProductionResult> {
    await advance(final);
    return {
      status: final,
      render_asset_id: null,
      export_ids: [],
      shots_approved: Object.keys(extra.shotAssets ?? {}).length,
      shots_needing_review: extra.needsReview ?? [],
      spend: currentSpend,
    };
  }
}
