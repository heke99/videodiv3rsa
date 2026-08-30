import { createHash } from "node:crypto";
import type {
  Checkpoint,
  CreativeBrief,
  JobStatus,
  QualityEvaluation,
  RepairPlan,
  RoutingDecision,
  SceneBible,
  Script,
  Shot,
  ShotPlan,
} from "@videoai/contracts";

/**
 * Activity signatures.
 *
 * Workflows are deterministic and may not touch the network, the clock or the
 * database, so everything that does lives behind one of these. Each is
 * idempotent or keyed, so Temporal replaying an activity after a crash never
 * produces a second generation (spec section 48).
 */

export interface ShotGenerationInput {
  job_id: string;
  organization_id: string;
  project_id: string;
  shot: Shot;
  decision: RoutingDecision;
  attempt: number;
  /**
   * Stable across retries of the same logical work and different when anything
   * about the request changes, so a replay returns the first result and a real
   * regeneration does not.
   */
  idempotency_key: string;
}

export interface ShotGenerationOutput {
  asset_id: string;
  storage_key: string;
  sha256: string;
  gpu_seconds: number;
  cost_units: number;
}

export interface Activities {
  // -- planning ------------------------------------------------------------
  loadCapabilitySnapshot(input: { organization_id: string }): Promise<{
    snapshot: import("@videoai/contracts").CapabilitySnapshot;
  }>;
  generateBrief(input: { job_id: string; project_id: string }): Promise<CreativeBrief>;
  generateSceneBible(input: { job_id: string; brief: CreativeBrief }): Promise<SceneBible>;
  generateScript(input: { job_id: string; brief: CreativeBrief; bible: SceneBible }): Promise<Script>;
  generateShotPlan(input: {
    job_id: string;
    brief: CreativeBrief;
    bible: SceneBible;
    script: Script;
  }): Promise<ShotPlan>;
  runPreflight(input: {
    job_id: string;
    plan: ShotPlan;
  }): Promise<import("@videoai/contracts").PreflightReport>;
  routeShots(input: {
    job_id: string;
    plan: ShotPlan;
    quality_mode: string;
  }): Promise<Array<{ shot_id: string; decision: RoutingDecision }>>;

  // -- audio ---------------------------------------------------------------
  generateDialogue(input: {
    job_id: string;
    script: Script;
    bible: SceneBible;
  }): Promise<Array<{ dialogue_line_id: string; asset_id: string; length_samples: number }>>;
  alignDialogue(input: {
    job_id: string;
    dialogue_asset_ids: string[];
  }): Promise<Array<{ dialogue_line_id: string; alignment_id: string }>>;
  generateAmbience(input: { job_id: string; shot_ids: string[] }): Promise<{ asset_ids: string[] }>;

  // -- references and shots -------------------------------------------------
  generateReferences(input: { job_id: string; bible: SceneBible }): Promise<{ asset_ids: string[] }>;
  generateShot(input: ShotGenerationInput): Promise<ShotGenerationOutput>;

  // -- quality --------------------------------------------------------------
  /**
   * Technical QC and the judge panel, in that order.
   *
   * One activity rather than two because the order is not the caller's to
   * choose: a file that fails technical QC is broken in a way no judge's
   * opinion changes, and the short-circuit that records why is part of the
   * measurement. `coverage` reports how much of the profile was reachable, and
   * is not optional -- `passed` on its own overstates what was checked.
   */
  runQc(input: {
    job_id: string;
    asset_id: string;
    shot: Shot;
    qc_profile: string;
    /** Measured judges only, for re-checking after a deterministic repair. */
    measured_only?: boolean;
  }): Promise<{
    technical_passed: boolean;
    evaluation: QualityEvaluation;
    evaluation_id: string;
    coverage: number;
  }>;
  planRepair(input: {
    job_id: string;
    shot: Shot;
    evaluation: QualityEvaluation;
    /** Skills the routing decision named for this shot's model. */
    required_skills?: string[];
  }): Promise<RepairPlan>;
  applyRepair(input: {
    job_id: string;
    plan: RepairPlan;
    idempotency_key: string;
  }): Promise<ShotGenerationOutput>;

  // -- delivery -------------------------------------------------------------
  buildTimeline(input: { job_id: string; plan: ShotPlan; shot_assets: Record<string, string> }): Promise<{
    timeline_id: string;
  }>;
  composeFinal(input: { job_id: string; timeline_id: string }): Promise<{ asset_id: string }>;
  exportRenders(input: { job_id: string; render_asset_id: string }): Promise<{ export_ids: string[] }>;

  // -- bookkeeping ----------------------------------------------------------
  /**
   * Record one take of a shot: the asset, the evaluation that judged it, and
   * what it did to the shot's state.
   *
   * The editor's version history and its restore button both read
   * `shot_versions.asset_id` and `shot_versions.quality_evaluation_id`, and the
   * project view reads `shots.current_asset_id` and `shots.status`. Nothing in
   * the pipeline wrote any of them, so every generated shot appeared as
   * `planned` with no asset and no history to restore from.
   */
  recordShotTake(input: {
    job_id: string;
    /** The shot's slug, as it appears in the plan. */
    shot_id: string;
    asset_id: string;
    evaluation_id: string;
    passed: boolean;
  }): Promise<{ version: number }>;
  setJobStatus(input: { job_id: string; status: JobStatus; message?: string }): Promise<void>;
  saveCheckpoint(input: Checkpoint): Promise<void>;
  loadCheckpoint(input: {
    job_id: string;
    stage: string;
    unit_id: string | null;
  }): Promise<Checkpoint | null>;
  recordSpend(input: {
    job_id: string;
    gpu_seconds: number;
    cost_units: number;
    generation_attempts?: number;
    repair_attempts?: number;
  }): Promise<void>;
  releaseReservations(input: { job_id: string }): Promise<void>;
}

/**
 * Idempotency key for one unit of generation work.
 *
 * Everything that changes the output is in the hash, so a retry of identical
 * work reuses the first result while a genuine regeneration -- a new attempt,
 * a repaired prompt, a different model -- produces a new one.
 */
export function idempotencyKey(parts: {
  job_id: string;
  shot_id: string;
  attempt: number;
  model_id: string;
  model_version: string;
  prompt_hash: string;
}): string {
  return createHash("sha256")
    .update(
      [
        parts.job_id,
        parts.shot_id,
        parts.attempt,
        parts.model_id,
        parts.model_version,
        parts.prompt_hash,
      ].join("|"),
    )
    .digest("hex");
}

export function hashInputs(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
