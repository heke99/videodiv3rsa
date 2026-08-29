import {
  GPU_PROFILE_VRAM_GIB,
  type GpuProfile,
  type Precision,
  type RoutingDecision,
  type RoutingRequest,
  type RoutingRule,
} from "@videoai/contracts";
import { checkLicenseGate, type LicenseGateInput } from "./license.js";

/**
 * Model Router (spec section 17).
 *
 * Rules are data, loaded from routing_rules, so routing changes without a
 * deploy and without a UI migration. The router's job is to turn a description
 * of what a shot needs into a concrete model choice, and to refuse rather than
 * substitute when nothing qualifies. There is deliberately no fallback to a
 * different model family and no fallback to anything external: a shot that
 * cannot be routed is an error the caller must handle.
 */

export interface RoutableModel {
  model_id: string;
  version: string;
  adapter: string;
  runtime: string;
  lifecycle: string;
  required_profile: GpuProfile;
  required_vram_gib: number;
  supported_precisions: Precision[];
  generation_kinds: string[];
  max_duration_frames: number;
  license: Omit<LicenseGateInput, "model_id" | "lifecycle">;
}

export interface RouterContext {
  rules: RoutingRule[];
  models: RoutableModel[];
  target_territory?: string | null;
}

export class RoutingError extends Error {
  constructor(
    message: string,
    readonly considered: Array<{ rule_id: string; model_id: string; reason: string }>,
  ) {
    super(
      considered.length === 0
        ? message
        : `${message}\nConsidered:\n${considered.map((c) => `  - ${c.rule_id} -> ${c.model_id}: ${c.reason}`).join("\n")}`,
    );
    this.name = "RoutingError";
  }
}

export function route(request: RoutingRequest, ctx: RouterContext): RoutingDecision {
  const rejected: Array<{ rule_id: string; model_id: string; reason: string }> = [];

  const candidates = ctx.rules
    .filter((r) => r.enabled && matches(r, request))
    .sort((a, b) => b.priority - a.priority);

  for (const rule of candidates) {
    const model = pickVersion(ctx.models, rule.target.model_id);
    if (!model) {
      rejected.push({
        rule_id: rule.id,
        model_id: rule.target.model_id,
        reason: "no version of this model is registered",
      });
      continue;
    }

    const reason = disqualify(model, rule, request, ctx);
    if (reason) {
      rejected.push({ rule_id: rule.id, model_id: model.model_id, reason });
      continue;
    }

    return {
      model_id: model.model_id,
      model_version: model.version,
      adapter: model.adapter,
      runtime: model.runtime,
      precision: choosePrecision(rule.target.precision, model.supported_precisions),
      generation_profile: rule.target.generation_profile,
      required_profile: model.required_profile,
      skills: rule.target.skills ?? [],
      qc_profile: rule.target.qc_profile,
      rule_id: rule.id,
      reason: rule.reason,
    };
  }

  throw new RoutingError(
    `No approved model can serve a ${request.generation_kind} shot of ` +
      `${request.duration_frames} frames in ${request.quality_mode} mode.`,
    rejected,
  );
}

function matches(rule: RoutingRule, req: RoutingRequest): boolean {
  const m = rule.match;
  if (m.generation_kind && !m.generation_kind.includes(req.generation_kind)) return false;
  if (m.quality_mode && !m.quality_mode.includes(req.quality_mode)) return false;
  if (m.has_dialogue !== undefined && m.has_dialogue !== req.has_dialogue) return false;
  if (m.requires_identity_lock !== undefined && m.requires_identity_lock !== req.requires_identity_lock) {
    return false;
  }
  if (
    m.requires_product_fidelity !== undefined &&
    m.requires_product_fidelity !== req.requires_product_fidelity
  ) {
    return false;
  }
  if (m.min_motion_complexity !== undefined && req.motion_complexity < m.min_motion_complexity) {
    return false;
  }
  if (m.max_duration_frames !== undefined && req.duration_frames > m.max_duration_frames) return false;
  return true;
}

/**
 * Everything that can disqualify a candidate, checked in the order that gives
 * the most useful error: licence first, because that is a decision someone has
 * to make, then capability, then the fleet we actually have.
 */
function disqualify(
  model: RoutableModel,
  rule: RoutingRule,
  req: RoutingRequest,
  ctx: RouterContext,
): string | null {
  const gate = checkLicenseGate({
    model_id: model.model_id,
    lifecycle: model.lifecycle,
    license_status: model.license.license_status,
    commercial_use: model.license.commercial_use,
    territories: model.license.territories,
    target_territory: ctx.target_territory ?? null,
  });
  if (!gate.allowed) return gate.reason;

  if (!model.generation_kinds.includes(req.generation_kind)) {
    return `does not implement ${req.generation_kind}`;
  }
  if (model.max_duration_frames > 0 && req.duration_frames > model.max_duration_frames) {
    return `handles at most ${model.max_duration_frames} frames, shot needs ${req.duration_frames}`;
  }
  if (req.has_reference_images && !model.generation_kinds.some((k) => k !== "text_to_video")) {
    return "cannot accept reference images";
  }

  if (!hasSufficientProfile(req.available_profiles, model.required_profile)) {
    return (
      `needs ${model.required_profile} (${model.required_vram_gib} GiB) ` +
      `but the fleet offers ${req.available_profiles.join(", ") || "nothing"}`
    );
  }
  if (!model.supported_precisions.includes(rule.target.precision)) {
    return `does not support ${rule.target.precision}`;
  }
  return null;
}

/**
 * A profile satisfies a requirement when it carries at least as much VRAM, so
 * an ULTRA worker can serve a STANDARD requirement but never the reverse. This
 * is the only place profiles are compared, and it compares capacity rather
 * than any hardware identity.
 */
function hasSufficientProfile(available: GpuProfile[], required: GpuProfile): boolean {
  const needed = GPU_PROFILE_VRAM_GIB[required];
  return available.some((p) => GPU_PROFILE_VRAM_GIB[p] >= needed);
}

/** Pick the highest-precedence registered version of a model. */
function pickVersion(models: RoutableModel[], modelId: string): RoutableModel | null {
  const versions = models.filter((m) => m.model_id === modelId);
  if (versions.length === 0) return null;
  const rank = (m: RoutableModel) => (m.lifecycle === "production" ? 2 : m.lifecycle === "canary" ? 1 : 0);
  return versions.sort((a, b) => rank(b) - rank(a) || b.version.localeCompare(a.version))[0]!;
}

function choosePrecision(requested: Precision, supported: Precision[]): Precision {
  if (supported.includes(requested)) return requested;
  // Prefer the highest-fidelity option the model actually supports rather than
  // silently dropping to something faster.
  const order: Precision[] = ["bf16", "fp16", "fp32", "fp8"];
  const found = order.find((p) => supported.includes(p));
  if (!found) throw new Error(`Model supports no known precision (${supported.join(", ")})`);
  return found;
}
