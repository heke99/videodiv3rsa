import type { ModelLifecycle } from "@videoai/contracts";
import { checkLicenseGate } from "./license.js";
import { compareToBaseline, type BenchmarkResult } from "./benchmark.js";

/**
 * Model promotion gates (spec section 85).
 *
 * A model never goes from downloaded to production. It passes through gates
 * in order, each answering a question that cannot be answered later:
 *
 *   candidate -> licence review -> security scan -> compatibility
 *             -> benchmark -> golden regression -> canary -> production
 *
 * Encoded as checks rather than as a document, because a promotion process
 * that lives in a runbook is a promotion process someone will skip under
 * pressure.
 */

export type GateId =
  | "licence_reviewed"
  | "security_scanned"
  | "artifacts_verified"
  | "compatibility_checked"
  | "benchmarked"
  | "no_golden_regression"
  | "canary_observed";

export interface GateResult {
  gate: GateId;
  passed: boolean;
  detail: string;
  /** A gate that cannot be evaluated yet, as distinct from one that failed. */
  blocked?: boolean;
}

export interface PromotionInput {
  model_id: string;
  version: string;
  lifecycle: ModelLifecycle;
  license: { license_status: string; commercial_use: boolean; territories: string[] };
  /** Every declared artifact present on a worker with a matching hash. */
  artifacts_verified: boolean;
  /** Dependency and image scan recorded for this version. */
  security_scanned: boolean;
  /** The runtime loaded it and produced output at least once. */
  compatibility_checked: boolean;
  benchmark: BenchmarkResult | null;
  baseline: BenchmarkResult | null;
  /** Observed canary traffic, if the version has been in canary. */
  canary: { requests: number; failure_rate: number } | null;
  target: "canary" | "production";
}

export interface PromotionDecision {
  allowed: boolean;
  target: "canary" | "production";
  gates: GateResult[];
  blockers: string[];
}

const MINIMUM_BENCHMARK_SCORE = 0.7;
const MINIMUM_CANARY_REQUESTS = 50;
const MAXIMUM_CANARY_FAILURE_RATE = 0.1;

export function evaluatePromotion(input: PromotionInput): PromotionDecision {
  const gates: GateResult[] = [];

  const licence = checkLicenseGate({
    model_id: input.model_id,
    // The lifecycle gate is what this function decides, so it is satisfied
    // here and only the licence half is asked of the shared check.
    lifecycle: "production",
    license_status: input.license.license_status,
    commercial_use: input.license.commercial_use,
    territories: input.license.territories,
  });
  gates.push({
    gate: "licence_reviewed",
    passed: licence.allowed,
    detail: licence.reason,
  });

  gates.push({
    gate: "security_scanned",
    passed: input.security_scanned,
    detail: input.security_scanned
      ? "Dependencies and image scanned for this version."
      : "No security scan is recorded for this version.",
  });

  gates.push({
    gate: "artifacts_verified",
    passed: input.artifacts_verified,
    detail: input.artifacts_verified
      ? "Every declared artifact is present and matches its hash."
      : "Model files are missing or do not match their recorded hashes.",
  });

  gates.push({
    gate: "compatibility_checked",
    passed: input.compatibility_checked,
    detail: input.compatibility_checked
      ? "The runtime loaded this version and produced output."
      : "This version has never produced output on a worker.",
  });

  if (!input.benchmark) {
    gates.push({
      gate: "benchmarked",
      passed: false,
      blocked: true,
      detail: "The golden suite has not been run against this version.",
    });
  } else {
    const scored = input.benchmark.overall >= MINIMUM_BENCHMARK_SCORE;
    gates.push({
      gate: "benchmarked",
      passed: scored,
      detail: scored
        ? `Golden suite scored ${input.benchmark.overall.toFixed(3)} over ` +
          `${(input.benchmark.coverage * 100).toFixed(0)}% coverage.`
        : `Golden suite scored ${input.benchmark.overall.toFixed(3)}, below ${MINIMUM_BENCHMARK_SCORE}.`,
    });
  }

  if (!input.benchmark) {
    gates.push({
      gate: "no_golden_regression",
      passed: false,
      blocked: true,
      detail: "Nothing to compare without a benchmark run.",
    });
  } else if (!input.baseline) {
    // First version of a model has nothing to regress against, which is not a
    // failure.
    gates.push({
      gate: "no_golden_regression",
      passed: true,
      detail: "First version of this model; no baseline to regress against.",
    });
  } else {
    const verdict = compareToBaseline(input.benchmark, input.baseline);
    gates.push({
      gate: "no_golden_regression",
      passed: verdict.passed,
      detail: verdict.passed ? "No regression against the incumbent." : verdict.reasons.join(" "),
    });
  }

  if (input.target === "canary") {
    gates.push({
      gate: "canary_observed",
      passed: true,
      detail: "Not required to enter canary.",
    });
  } else if (!input.canary) {
    gates.push({
      gate: "canary_observed",
      passed: false,
      blocked: true,
      detail: "This version has not run in canary; production requires observed traffic.",
    });
  } else {
    const enough = input.canary.requests >= MINIMUM_CANARY_REQUESTS;
    const healthy = input.canary.failure_rate <= MAXIMUM_CANARY_FAILURE_RATE;
    gates.push({
      gate: "canary_observed",
      passed: enough && healthy,
      detail: enough
        ? healthy
          ? `${input.canary.requests} canary requests at ` +
            `${(input.canary.failure_rate * 100).toFixed(1)}% failure.`
          : `Canary failure rate ${(input.canary.failure_rate * 100).toFixed(1)}% exceeds ` +
            `${(MAXIMUM_CANARY_FAILURE_RATE * 100).toFixed(0)}%.`
        : `Only ${input.canary.requests} canary requests; ${MINIMUM_CANARY_REQUESTS} are needed.`,
    });
  }

  const blockers = gates.filter((g) => !g.passed).map((g) => `${g.gate}: ${g.detail}`);

  return { allowed: blockers.length === 0, target: input.target, gates, blockers };
}

/**
 * Rollback is always allowed and always immediate.
 *
 * Nothing gates taking a model out of traffic: a rollback that had to pass
 * checks would be a rollback nobody could perform during an incident.
 */
export function rollback(modelId: string, version: string): {
  model_id: string;
  version: string;
  lifecycle: ModelLifecycle;
  canary_weight: number;
} {
  return { model_id: modelId, version, lifecycle: "approved", canary_weight: 0 };
}
