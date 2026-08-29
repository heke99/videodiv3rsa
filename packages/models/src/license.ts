import type { LicenseStatus, ModelLifecycle } from "@videoai/contracts";

/**
 * Licence and lifecycle gate (spec sections 65 and 85).
 *
 * This is fail-closed on purpose: a model is usable only when someone has
 * explicitly reviewed its licence and explicitly promoted the version. Every
 * other state, including "we have not looked yet", denies. Open weights are
 * not the same thing as a worldwide commercial SaaS grant.
 */

export const ROUTABLE_LICENSE_STATUSES: readonly LicenseStatus[] = ["approved"];

export const ROUTABLE_LIFECYCLES: readonly ModelLifecycle[] = ["production", "canary"];

export interface LicenseGateInput {
  model_id: string;
  license_status: LicenseStatus | string;
  lifecycle: ModelLifecycle | string;
  commercial_use: boolean;
  territories: string[];
  /** Territory the work will be delivered into, if the caller knows it. */
  target_territory?: string | null;
}

export interface GateDecision {
  allowed: boolean;
  reason: string;
}

export function checkLicenseGate(input: LicenseGateInput): GateDecision {
  if (!ROUTABLE_LICENSE_STATUSES.includes(input.license_status as LicenseStatus)) {
    return {
      allowed: false,
      reason:
        `${input.model_id} has licence status "${input.license_status}"; ` +
        `only "approved" may be routed to.`,
    };
  }
  if (!input.commercial_use) {
    return {
      allowed: false,
      reason: `${input.model_id} is approved but its licence does not grant commercial use.`,
    };
  }
  if (!ROUTABLE_LIFECYCLES.includes(input.lifecycle as ModelLifecycle)) {
    return {
      allowed: false,
      reason:
        `${input.model_id} is at lifecycle "${input.lifecycle}"; ` +
        `a version reaches traffic only at "canary" or "production".`,
    };
  }
  const territories = input.territories ?? [];
  const unrestricted = territories.length === 0 || territories.includes("*");
  if (!unrestricted && input.target_territory && !territories.includes(input.target_territory)) {
    return {
      allowed: false,
      reason:
        `${input.model_id} is licensed for ${territories.join(", ")} ` +
        `but this work targets ${input.target_territory}.`,
    };
  }
  return { allowed: true, reason: "Licence approved, commercial use granted, version promoted." };
}

/** Thrown at preflight so a run fails before it consumes any GPU time. */
export class LicenseBlockedError extends Error {
  constructor(readonly decisions: Array<{ model_id: string; reason: string }>) {
    super(
      `Refusing to start: ${decisions.length} model(s) are not cleared for use.\n` +
        decisions.map((d) => `  - ${d.reason}`).join("\n"),
    );
    this.name = "LicenseBlockedError";
  }
}
