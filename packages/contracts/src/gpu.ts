import { z } from "zod";
import { GpuProfile, Precision, Sha256, Slug, Uuid } from "./primitives.js";

/**
 * GPU worker registry, scheduling and the signed gateway envelope
 * (spec sections 51, 52, 56, 77, 80).
 *
 * Product logic asks for a profile and capabilities. It never asks for a card
 * by name, and it never talks to a worker directly.
 */

export const WorkerLifecycle = z.enum([
  "OFF",
  "STARTING",
  "PROVISIONING",
  "READY",
  "BUSY",
  "IDLE",
  "DRAINING",
  "UNHEALTHY",
]);
export type WorkerLifecycle = z.infer<typeof WorkerLifecycle>;

export const WorkerCapabilities = z.object({
  cuda_version: z.string().nullable(),
  driver_version: z.string().nullable(),
  compute_capability: z.string().nullable(),
  gpu_count: z.number().int().nonnegative(),
  vram_total_bytes: z.number().int().nonnegative(),
  vram_free_bytes: z.number().int().nonnegative(),
  supported_precisions: z.array(Precision).default([]),
  profile: GpuProfile,
  runtimes: z.array(z.string()).default([]),
});
export type WorkerCapabilities = z.infer<typeof WorkerCapabilities>;

export const WorkerHealth = z.object({
  worker_id: Slug,
  lifecycle: WorkerLifecycle,
  healthy: z.boolean(),
  temperature_c: z.number().nullable().default(null),
  utilization_pct: z.number().min(0).max(100).nullable().default(null),
  vram_free_bytes: z.number().int().nonnegative(),
  loaded_models: z.array(z.string()).default([]),
  queue_depth: z.number().int().nonnegative().default(0),
  uptime_seconds: z.number().int().nonnegative().default(0),
  last_seen_at: z.string().datetime(),
});
export type WorkerHealth = z.infer<typeof WorkerHealth>;

export const GpuWorker = z.object({
  worker_id: Slug,
  provider: z.string().min(1),
  provider_ref: z.string().min(1),
  endpoint: z.string().min(1),
  capabilities: WorkerCapabilities,
  lifecycle: WorkerLifecycle,
});
export type GpuWorker = z.infer<typeof GpuWorker>;

/** What the scheduler is asked for — capabilities, never hardware names. */
export const WorkerRequirement = z.object({
  required_profile: GpuProfile,
  required_vram_bytes: z.number().int().positive(),
  required_capabilities: z.array(z.string()).default([]),
  required_precision: Precision,
  required_runtime: z.string().min(1),
});
export type WorkerRequirement = z.infer<typeof WorkerRequirement>;

export const GpuReservation = z.object({
  reservation_id: Uuid,
  worker_id: Slug,
  job_id: Uuid,
  vram_bytes: z.number().int().positive(),
  expires_at: z.string().datetime(),
});
export type GpuReservation = z.infer<typeof GpuReservation>;

/**
 * Signed envelope for every backend to worker call (spec section 77). Workers
 * accept nothing that is unsigned, replayed, or expired.
 */
export const WorkerEnvelope = z.object({
  job_id: Uuid,
  nonce: z.string().min(16),
  issued_at: z.number().int().positive(),
  expires_at: z.number().int().positive(),
  signature: z.string().min(1),
});
export type WorkerEnvelope = z.infer<typeof WorkerEnvelope>;

export const ModelArtifactStatus = z.object({
  model_id: Slug,
  version: z.string(),
  file: z.string(),
  expected_sha256: Sha256,
  actual_sha256: Sha256.nullable(),
  present: z.boolean(),
  verified: z.boolean(),
});
export type ModelArtifactStatus = z.infer<typeof ModelArtifactStatus>;

/** GPU cost accounting buckets (spec section 79). */
export const GpuUsageKind = z.enum([
  "worker_boot",
  "worker_idle",
  "model_load",
  "generation",
  "upscale",
  "qc",
  "render",
]);
export type GpuUsageKind = z.infer<typeof GpuUsageKind>;
