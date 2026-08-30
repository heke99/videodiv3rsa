import type { QualityMode } from "@videoai/contracts";
import { queryOne, transaction } from "@videoai/database";
import {
  QUALITY_PROFILES,
  allJudges,
  coverage,
  evaluate,
  measuredJudges,
  planRepair,
  type EnsembleResult,
  type Judge,
  type JudgeContext,
  type RepairDecision,
} from "@videoai/quality";
import { runTechnicalQc, type TechnicalQcExpectation } from "@videoai/render";

/**
 * QC orchestration (spec sections 32, 33, 35).
 *
 * Runs measurement before judgement, aggregates, persists, and hands the
 * result to the repair planner. The ordering is the point: a file that fails
 * technical QC is broken in a way no judge's opinion changes, and asking a
 * judge about it wastes time that could be spent regenerating.
 */

export interface QcRequest {
  organization_id: string;
  project_id: string;
  job_id: string | null;
  asset_id: string;
  asset_path: string;
  subject_kind: "shot" | "scene" | "reference" | "audio" | "final";
  subject_id: string;
  profile: QualityMode;
  technical: TechnicalQcExpectation;
  judge_context: Omit<JudgeContext, "asset_path">;
  /** Restrict the panel, for a cheap re-check after a targeted repair. */
  judges?: Judge[];
}

export interface QcOutcome {
  evaluation: EnsembleResult;
  evaluation_id: string;
  /** Fraction of this profile's gating dimensions that could be measured. */
  coverage: number;
  technical_passed: boolean;
}

export async function runQc(request: QcRequest): Promise<QcOutcome> {
  const technical = await runTechnicalQc(request.asset_path, request.technical);

  if (!technical.passed) {
    // Short-circuit: the file is broken, so record the technical findings as
    // the evaluation and skip the judges entirely.
    const evaluation: EnsembleResult = {
      schema_version: "1.0",
      subject_kind: request.subject_kind,
      subject_id: request.subject_id,
      quality_profile: request.profile,
      overall: 0,
      scores: { encoding: 0 },
      judges: [
        {
          judge_id: "technical-qc",
          judge_version: "1.0",
          status: "fail",
          score: 0,
          confidence: 1,
          findings: technical.findings,
          recommended_actions: [],
          metrics: {},
          repair_scope: "shot",
        },
      ],
      passed: false,
      unmeasured: [],
    };
    // Coverage is zero rather than null: nothing was checked, and we know it.
    const id = await persist(request, evaluation, 0);
    return { evaluation, evaluation_id: id, coverage: 0, technical_passed: false };
  }

  const panel = request.judges ?? allJudges;
  const evaluation = await evaluate(
    panel,
    { ...request.judge_context, asset_path: request.asset_path },
    { subject_kind: request.subject_kind, subject_id: request.subject_id, profile: request.profile },
  );

  const measured = coverage(evaluation, request.profile);
  const id = await persist(request, evaluation, measured);
  return { evaluation, evaluation_id: id, coverage: measured, technical_passed: true };
}

/** The measured panel only, for a fast re-check after a deterministic repair. */
export async function recheck(request: QcRequest): Promise<QcOutcome> {
  return runQc({ ...request, judges: measuredJudges });
}

export function planRepairFor(
  outcome: QcOutcome,
  input: Omit<Parameters<typeof planRepair>[0], "evaluation" | "subject_id">,
): RepairDecision {
  return planRepair({
    ...input,
    evaluation: outcome.evaluation,
    subject_id: outcome.evaluation.subject_id,
  });
}

async function persist(
  request: QcRequest,
  evaluation: EnsembleResult,
  measuredCoverage: number,
): Promise<string> {
  return transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into public.quality_evaluations
         (organization_id, project_id, job_id, subject_kind, subject_id, asset_id,
          quality_profile, overall, passed, coverage)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id`,
      [
        request.organization_id,
        request.project_id,
        request.job_id,
        request.subject_kind,
        request.subject_id,
        request.asset_id,
        request.profile,
        evaluation.overall,
        evaluation.passed,
        measuredCoverage,
      ],
    );
    const evaluationId = inserted.rows[0]!.id;

    const thresholds = QUALITY_PROFILES[request.profile].dimensions;
    for (const [dimension, score] of Object.entries(evaluation.scores)) {
      const threshold = thresholds[dimension as keyof typeof thresholds] ?? null;
      await client.query(
        `insert into public.quality_metrics
           (evaluation_id, organization_id, dimension, score, threshold, passed)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (evaluation_id, dimension) do nothing`,
        [
          evaluationId,
          request.organization_id,
          dimension,
          score,
          threshold,
          threshold === null || score >= threshold,
        ],
      );
    }

    for (const judge of evaluation.judges) {
      for (const found of judge.findings) {
        await client.query(
          `insert into public.quality_findings
             (evaluation_id, organization_id, judge_id, judge_version, code, severity, message, frames, entity_ref)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            evaluationId,
            request.organization_id,
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

    return evaluationId;
  });
}

/** Record a human rating, which is what makes calibration possible. */
export async function recordHumanEvaluation(input: {
  organization_id: string | null;
  asset_id: string;
  evaluation_id: string | null;
  human_score: number;
  failure_labels: string[];
  rated_by: string | null;
}): Promise<void> {
  await queryOne(
    `insert into public.human_evaluations
       (organization_id, asset_id, evaluation_id, human_score, failure_labels, rated_by)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      input.organization_id,
      input.asset_id,
      input.evaluation_id,
      input.human_score,
      input.failure_labels,
      input.rated_by,
    ],
  );
}
