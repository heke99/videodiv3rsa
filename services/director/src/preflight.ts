import type { PreflightReport, ShotPlan } from "@videoai/contracts";

/**
 * Preflight (spec section 109).
 *
 * Runs before anything expensive. Its value is entirely in failing early: a
 * blocked licence or a missing reference discovered after twenty shots have
 * rendered has already cost real money.
 */

export interface PreflightInput {
  plan: ShotPlan;
  /** Models the router would select, already licence-checked. */
  routableModelIds: string[];
  /** Model ids the routing decisions actually need. */
  requiredModelIds: string[];
  /** Model versions present and hash-verified on at least one worker. */
  installedModelIds: string[];
  availableProfileCount: number;
  referencesValid: boolean;
  storageAvailable: boolean;
  quotaRemainingUnits: number;
  estimatedCostUnits: number;
  estimatedGpuSeconds: number;
  estimatedQueueSeconds: number;
  estimatedRenderSeconds: number;
}

export function preflight(input: PreflightInput): PreflightReport {
  const blockers: string[] = [];

  const unlicensed = input.requiredModelIds.filter((id) => !input.routableModelIds.includes(id));
  if (unlicensed.length > 0) {
    blockers.push(
      `These models are not cleared for use: ${unlicensed.join(", ")}. ` +
        `A licence has to be reviewed and approved before they can be routed to.`,
    );
  }

  const missing = input.requiredModelIds.filter((id) => !input.installedModelIds.includes(id));
  if (missing.length > 0) {
    blockers.push(`These models are not installed and verified on any worker: ${missing.join(", ")}.`);
  }

  if (input.availableProfileCount === 0) {
    blockers.push("No healthy GPU worker is available.");
  }
  if (!input.referencesValid) {
    blockers.push("One or more references the plan plans against are missing or unreadable.");
  }
  if (!input.storageAvailable) {
    blockers.push("Storage is not writable.");
  }
  if (input.quotaRemainingUnits < input.estimatedCostUnits) {
    blockers.push(
      `Estimated cost is ${input.estimatedCostUnits.toFixed(0)} units but only ` +
        `${input.quotaRemainingUnits.toFixed(0)} remain.`,
    );
  }

  return {
    passed: blockers.length === 0,
    models_installed: missing.length === 0,
    licenses_approved: unlicensed.length === 0,
    gpu_available: input.availableProfileCount > 0,
    references_valid: input.referencesValid,
    storage_available: input.storageAvailable,
    quota_available: input.quotaRemainingUnits > 0,
    budget_sufficient: input.quotaRemainingUnits >= input.estimatedCostUnits,
    blockers,
    estimated_gpu_seconds: input.estimatedGpuSeconds,
    estimated_queue_seconds: input.estimatedQueueSeconds,
    estimated_render_seconds: input.estimatedRenderSeconds,
    is_estimate: true,
  };
}
