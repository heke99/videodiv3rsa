/**
 * Row shapes for the tables the backend reads directly. Hand written rather
 * than generated so that the columns each service depends on are visible and
 * a schema change that breaks one shows up as a type error here.
 *
 * Postgres bigint comes back as a string over the wire; columns typed as
 * bigint are declared as string and converted at the edge that needs a number.
 */

export interface ModelRegistryRow {
  model_id: string;
  family: string;
  display_name: string;
  kind: string;
  adapter: string;
  runtime: string;
  upstream_url: string | null;
}

export interface ModelVersionRow {
  id: string;
  model_id: string;
  version: string;
  lifecycle: string;
  required_profile: string;
  required_vram_gib: string;
  supported_precisions: string[];
  canary_weight: string;
}

export interface ModelLicenseRow {
  model_id: string;
  license_name: string;
  license_url: string | null;
  commercial_use: boolean;
  territories: string[];
  attribution_required: boolean;
  restrictions: string[];
  reviewed_at: string | null;
  reviewed_by: string | null;
  status: string;
}

export interface ModelCapabilityRow {
  model_version_id: string;
  generation_kind: string;
  max_duration_frames: string;
  supported_resolutions: unknown;
  accepts_reference_images: boolean;
  accepts_driving_audio: boolean;
  produces_audio: boolean;
}

export interface RoutingRuleRow {
  id: string;
  priority: number;
  enabled: boolean;
  match: Record<string, unknown>;
  target: Record<string, unknown>;
  reason: string;
}

export interface GpuWorkerRow {
  worker_id: string;
  provider: string;
  provider_ref: string;
  endpoint: string;
  lifecycle: string;
  profile: string;
  vram_total_bytes: string;
  vram_free_bytes: string;
  cuda_version: string | null;
  driver_version: string | null;
  compute_capability: string | null;
  gpu_count: number;
  supported_precisions: string[];
  temperature_c: string | null;
  utilization_pct: string | null;
  queue_depth: number;
  healthy: boolean;
  drain_requested: boolean;
  last_seen_at: string | null;
  started_at: string | null;
}

export interface ShotRow {
  id: string;
  project_id: string;
  scene_id: string;
  organization_id: string;
  slug: string;
  index: number;
  duration_frames: string;
  shot_type: string;
  preferred_generation_kind: string;
  requires_identity_lock: boolean;
  requires_product_fidelity: boolean;
  motion_complexity: string;
  continuity_requirement: string;
  current_asset_id: string | null;
  current_version: number;
  stale: boolean;
  stale_reasons: string[];
  status: string;
}

export interface ShotDependencyRow {
  id: string;
  project_id: string;
  organization_id: string;
  shot_id: string;
  kind: string;
  ref: string;
}

export interface GenerationJobRow {
  id: string;
  organization_id: string;
  project_id: string;
  workflow_id: string | null;
  run_id: string | null;
  status: string;
  quality_mode: string;
  retry_budget: Record<string, unknown>;
  budget_spend: Record<string, unknown>;
  progress: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  cancel_requested: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AssetVersionRow {
  id: string;
  asset_id: string;
  organization_id: string;
  version: number;
  storage_key: string;
  storage_provider: string;
  sha256: string;
  mime: string;
  size_bytes: string;
  width: number | null;
  height: number | null;
  frame_count: string | null;
  frame_rate_num: number | null;
  frame_rate_den: number | null;
  duration_samples: string | null;
  audio_sample_rate: number | null;
}

/** bigint columns arrive as strings; convert only where a number is needed. */
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`Expected a numeric value, got ${value}`);
  return n;
}
