import { query, toNumber } from "@videoai/database";
import type { CapabilitySnapshot, GpuProfile, Precision, RoutingRule } from "@videoai/contracts";
import type { RoutableModel } from "./router.js";

/**
 * Reads the registries the router and preflight depend on. Everything here is
 * a database read, so operations can change routing, promote a version or
 * block a licence without a deploy.
 */

interface ModelJoinRow {
  model_id: string;
  version: string;
  adapter: string;
  runtime: string;
  lifecycle: string;
  required_profile: string;
  required_vram_gib: string;
  supported_precisions: string[];
  generation_kinds: string[];
  max_duration_frames: string;
  license_status: string;
  commercial_use: boolean;
  territories: string[];
}

const MODEL_QUERY = `
  select
    mv.model_id,
    mv.version,
    mr.adapter,
    mr.runtime,
    mv.lifecycle,
    mv.required_profile,
    mv.required_vram_gib,
    mv.supported_precisions,
    coalesce(array_agg(mc.generation_kind) filter (where mc.generation_kind is not null), '{}') as generation_kinds,
    coalesce(max(mc.max_duration_frames), 0) as max_duration_frames,
    ml.status as license_status,
    ml.commercial_use,
    ml.territories
  from public.model_versions mv
  join public.model_registry mr on mr.model_id = mv.model_id
  left join public.model_licenses ml on ml.model_id = mv.model_id
  left join public.model_capabilities mc on mc.model_version_id = mv.id
  group by mv.id, mv.model_id, mv.version, mr.adapter, mr.runtime, mv.lifecycle,
           mv.required_profile, mv.required_vram_gib, mv.supported_precisions,
           ml.status, ml.commercial_use, ml.territories
`;

export async function loadRoutableModels(): Promise<RoutableModel[]> {
  const rows = await query<ModelJoinRow>(MODEL_QUERY);
  return rows.map((r) => ({
    model_id: r.model_id,
    version: r.version,
    adapter: r.adapter,
    runtime: r.runtime,
    lifecycle: r.lifecycle,
    required_profile: r.required_profile as GpuProfile,
    required_vram_gib: toNumber(r.required_vram_gib),
    supported_precisions: r.supported_precisions as Precision[],
    generation_kinds: r.generation_kinds,
    max_duration_frames: toNumber(r.max_duration_frames),
    license: {
      // A model with no licence row at all is treated as unknown, which denies.
      license_status: r.license_status ?? "unknown",
      commercial_use: r.commercial_use ?? false,
      territories: r.territories ?? [],
    },
  }));
}

export async function loadRoutingRules(): Promise<RoutingRule[]> {
  const rows = await query<{
    id: string;
    priority: number;
    enabled: boolean;
    match: RoutingRule["match"];
    target: RoutingRule["target"];
    reason: string;
  }>("select id, priority, enabled, match, target, reason from public.routing_rules order by priority desc");
  return rows.map((r) => ({
    id: r.id,
    priority: r.priority,
    enabled: r.enabled,
    match: r.match,
    target: { ...r.target, skills: r.target.skills ?? [] },
    reason: r.reason,
  }));
}

/**
 * Capability snapshot for the Director (spec section 108). Only models that
 * pass the gate appear here, which is what stops the Director from planning
 * around something it may not use.
 */
export async function buildCapabilitySnapshot(availableProfiles: GpuProfile[]): Promise<CapabilitySnapshot> {
  const models = await loadRoutableModels();
  const routable = models.filter(
    (m) =>
      m.license.license_status === "approved" &&
      m.license.commercial_use &&
      (m.lifecycle === "production" || m.lifecycle === "canary"),
  );

  const skills = await query<{ skill_id: string; version: string }>(
    `select sr.skill_id, coalesce(sr.current_version, '0.0') as version
     from public.skill_registry sr where sr.status = 'active'`,
  );
  const voices = await query<{ slug: string }>("select distinct slug from public.voice_profiles");

  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    models: routable.map((m) => ({
      model_id: m.model_id,
      version: m.version,
      generation_kinds: m.generation_kinds as CapabilitySnapshot["models"][number]["generation_kinds"],
      max_duration_frames: m.max_duration_frames || 1,
    })),
    skills: skills.map((s) => ({ skill_id: s.skill_id, version: s.version })),
    available_profiles: availableProfiles,
    voices: voices.map((v) => v.slug),
    quality_modes: ["PREVIEW", "STANDARD", "REALISTIC", "UGC", "CINEMATIC", "PRODUCT", "AVATAR", "ULTRA"],
  };
}
