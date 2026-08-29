import type {
  Finding,
  QualityEvaluation,
  RepairAction,
  RepairPlan,
  RepairScope,
  RetryBudget,
  BudgetSpend,
} from "@videoai/contracts";

/**
 * Failure classification and repair planning (spec section 35).
 *
 * The single principle: choose the smallest scope that can address the
 * findings. Every larger scope discards work that was already correct, and
 * `dependent_shots` discards neighbouring shots as well.
 */

export type FailureClass =
  | "composition_fault"
  | "local_artifact"
  | "motion_fault"
  | "audio_fault"
  | "identity_fault"
  | "product_fault"
  | "whole_shot_failure"
  | "none";

export interface Classification {
  failure_class: FailureClass;
  driving_findings: string[];
  rationale: string;
}

/** Findings that mean the assembly is wrong rather than the generation. */
const COMPOSITION_CODES = new Set([
  "av_sync",
  "caption_mismatch",
  "caption_too_fast",
  "safe_area_violation",
  "loudness_off_target",
  "true_peak_exceeded",
  "encoding",
  "pixel_format",
]);

const AUDIO_CODES = new Set(["no_audio", "clipping", "silent_gap", "over_compressed"]);
const MOTION_CODES = new Set(["insufficient_motion", "excess_motion", "frozen_segment"]);
const IDENTITY_CODES = new Set(["identity_drift", "face_drift", "clothing_drift"]);
const PRODUCT_CODES = new Set(["product_mismatch", "logo_warped", "text_garbled"]);

export function classify(evaluation: QualityEvaluation, entityChanged = false): Classification {
  const severe = evaluation.judges
    .flatMap((j) => j.findings)
    .filter((f) => f.severity === "high" || f.severity === "critical");

  if (severe.length === 0) {
    return { failure_class: "none", driving_findings: [], rationale: "Nothing severe was found." };
  }

  const codes = severe.map((f) => f.code);

  // Checked before anything else: a canonical entity that changed is
  // invalidation, not a generation failure, and other shots are affected too.
  if (entityChanged && codes.some((c) => IDENTITY_CODES.has(c) || PRODUCT_CODES.has(c))) {
    return {
      failure_class: "identity_fault",
      driving_findings: codes,
      rationale: "A canonical entity changed, so dependent shots are stale rather than badly generated.",
    };
  }

  // Composition faults are cheapest and are never a reason to regenerate, so
  // they are resolved before considering anything more expensive.
  if (codes.every((c) => COMPOSITION_CODES.has(c))) {
    return {
      failure_class: "composition_fault",
      driving_findings: codes,
      rationale: "Every finding is an assembly fault; nothing was generated badly.",
    };
  }

  // Several unrelated severe findings mean there is nothing worth salvaging.
  const distinct = new Set(codes);
  if (distinct.size >= 3) {
    return {
      failure_class: "whole_shot_failure",
      driving_findings: codes,
      rationale: `${distinct.size} unrelated severe findings; the shot is not salvageable.`,
    };
  }

  if (codes.some((c) => IDENTITY_CODES.has(c))) {
    return { failure_class: "identity_fault", driving_findings: codes, rationale: "The subject drifted." };
  }
  if (codes.some((c) => PRODUCT_CODES.has(c))) {
    return { failure_class: "product_fault", driving_findings: codes, rationale: "The product is wrong." };
  }
  if (codes.every((c) => AUDIO_CODES.has(c))) {
    return { failure_class: "audio_fault", driving_findings: codes, rationale: "Audio only; picture is sound." };
  }
  if (codes.some((c) => MOTION_CODES.has(c))) {
    return { failure_class: "motion_fault", driving_findings: codes, rationale: "The motion is the failure." };
  }
  if (severe.every((f) => f.frames.length > 0)) {
    return {
      failure_class: "local_artifact",
      driving_findings: codes,
      // Every finding names frames, so the defect is bounded in time.
      rationale: "The defect is confined to specific frames.",
    };
  }

  return { failure_class: "whole_shot_failure", driving_findings: codes, rationale: "No cheaper cause fits." };
}

/** The smallest scope that can address each class. */
const SCOPE_FOR: Record<FailureClass, RepairScope> = {
  none: "none",
  composition_fault: "timing",
  audio_fault: "audio",
  local_artifact: "frame",
  motion_fault: "shot",
  identity_fault: "dependent_shots",
  product_fault: "shot",
  whole_shot_failure: "shot",
};

const ACTION_FOR: Partial<Record<string, RepairAction>> = {
  caption_mismatch: "caption_repair",
  caption_too_fast: "caption_repair",
  safe_area_violation: "caption_repair",
  av_sync: "timing_repair",
  loudness_off_target: "audio_repair",
  true_peak_exceeded: "audio_repair",
  over_compressed: "audio_repair",
  clipping: "audio_repair",
  silent_gap: "audio_repair",
  no_audio: "audio_repair",
  insufficient_motion: "motion_repair",
  excess_motion: "motion_repair",
  frozen_segment: "shot_regeneration",
  identity_drift: "identity_repair",
  product_mismatch: "product_repair",
  logo_warped: "product_repair",
  text_garbled: "product_repair",
  lip_sync: "lip_sync_repair",
  upscale_changed_content: "upscale_repair",
  upscale_added_flicker: "upscale_repair",
};

export interface PlanRepairInput {
  evaluation: QualityEvaluation;
  subject_id: string;
  entity_changed?: boolean;
  budget: RetryBudget;
  spend: BudgetSpend;
  /** Rough cost of each scope, used to refuse a repair that cannot finish. */
  estimated_gpu_seconds?: Partial<Record<RepairScope, number>>;
}

export interface RepairDecision {
  plan: RepairPlan;
  classification: Classification;
  needs_review: boolean;
  reason: string;
}

const DEFAULT_COST: Record<RepairScope, number> = {
  none: 0,
  caption: 0,
  timing: 0,
  audio: 2,
  upscale: 20,
  lipsync: 25,
  frame: 15,
  keyframe: 20,
  shot: 60,
  scene: 240,
  dependent_shots: 300,
  project: 1200,
};

export function planRepair(input: PlanRepairInput): RepairDecision {
  const classification = classify(input.evaluation, input.entity_changed);

  if (classification.failure_class === "none") {
    return {
      plan: emptyPlan(input.subject_id),
      classification,
      needs_review: false,
      reason: "Nothing to repair.",
    };
  }

  const findings = input.evaluation.judges.flatMap((j) => j.findings);
  let scope = SCOPE_FOR[classification.failure_class];

  // Refine the scope from the specific findings: a composition fault caused
  // only by captions is a caption repair, which is cheaper still than timing.
  if (classification.failure_class === "composition_fault") {
    const codes = new Set(classification.driving_findings);
    const captionOnly = [...codes].every((c) =>
      ["caption_mismatch", "caption_too_fast", "safe_area_violation"].includes(c),
    );
    const audioOnly = [...codes].every((c) =>
      ["loudness_off_target", "true_peak_exceeded", "over_compressed"].includes(c),
    );
    if (captionOnly) scope = "caption";
    else if (audioOnly) scope = "audio";
  }

  // A shot that is otherwise good except for the mouth costs one pass, not a
  // new shot.
  if (
    classification.failure_class === "local_artifact" &&
    classification.driving_findings.every((c) => c === "lip_sync")
  ) {
    scope = "lipsync";
  }

  const cost = input.estimated_gpu_seconds?.[scope] ?? DEFAULT_COST[scope];
  const remainingGpu = input.budget.max_gpu_seconds - input.spend.gpu_seconds;
  const remainingRepairs = input.budget.max_repair_attempts - input.spend.repair_attempts;

  if (remainingRepairs <= 0) {
    return {
      plan: emptyPlan(input.subject_id),
      classification,
      needs_review: true,
      reason: "The repair budget is spent; handing this to review rather than trying again.",
    };
  }

  if (cost > remainingGpu) {
    // Starting a repair that cannot finish spends the budget and produces
    // nothing; a decision from the user is worth more.
    return {
      plan: emptyPlan(input.subject_id),
      classification,
      needs_review: true,
      reason:
        `A ${scope} repair needs about ${cost}s of GPU and ${remainingGpu.toFixed(0)}s remain. ` +
        `Handing this to review.`,
    };
  }

  const actions = buildActions(findings, input.subject_id);

  return {
    plan: {
      schema_version: "1.0",
      subject_id: input.subject_id,
      scope,
      actions,
      addressed_findings: classification.driving_findings,
      estimated_gpu_seconds: cost,
    },
    classification,
    needs_review: false,
    reason: classification.rationale,
  };
}

function buildActions(findings: Finding[], subjectId: string): RepairPlan["actions"] {
  const seen = new Set<RepairAction>();
  const actions: RepairPlan["actions"] = [];

  for (const found of findings) {
    if (found.severity !== "high" && found.severity !== "critical") continue;
    const action = ACTION_FOR[found.code];
    if (!action || seen.has(action)) continue;
    seen.add(action);
    actions.push({
      action,
      target_id: subjectId,
      rationale: found.message || found.code,
      params: found.frames.length > 0 ? { frames: found.frames } : {},
    });
  }

  // Nothing mapped, but something was severe: correct the prompt rather than
  // re-rolling the same one, which is a lottery.
  if (actions.length === 0) {
    actions.push({
      action: "prompt_repair",
      target_id: subjectId,
      rationale: "No specific repair maps to these findings; correct the prompt before regenerating.",
      params: {},
    });
  }

  return actions;
}

function emptyPlan(subjectId: string): RepairPlan {
  return {
    schema_version: "1.0",
    subject_id: subjectId,
    scope: "none",
    actions: [],
    addressed_findings: [],
    estimated_gpu_seconds: 0,
  };
}
