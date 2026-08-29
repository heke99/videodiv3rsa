/**
 * Admin API client.
 *
 * Every endpoint behind /api/admin requires platform staff. A non-staff caller
 * gets 404 rather than 403, so the admin surface does not announce itself.
 */

import type { Session } from "@videoai/ui";

export type RequestOptions = Session;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function baseUrl(): string {
  const url = process.env["NEXT_PUBLIC_API_URL"];
  if (!url) throw new Error("NEXT_PUBLIC_API_URL is not configured.");
  return url.replace(/\/$/, "");
}

async function request<T>(
  path: string,
  options: RequestOptions & { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${options.token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, detail?.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export interface ModelRow {
  model_id: string;
  display_name: string;
  kind: string;
  adapter: string;
  runtime: string;
  version: string | null;
  lifecycle: string | null;
  required_profile: string | null;
  required_vram_gib: string | null;
  canary_weight: string | null;
  license_name: string | null;
  license_status: string | null;
  commercial_use: boolean | null;
  territories: string[] | null;
  reviewed_at: string | null;
  installed: boolean;
}

export interface WorkerRow {
  worker_id: string;
  provider: string;
  lifecycle: string;
  profile: string;
  healthy: boolean;
  drain_requested: boolean;
  vram_total_bytes: string;
  vram_free_bytes: string;
  temperature_c: string | null;
  utilization_pct: string | null;
  queue_depth: number;
  last_seen_at: string | null;
}

export const adminApi = {
  overview: (o: RequestOptions) =>
    request<{
      jobs: { total: number; completed: number; failed: number; needs_review: number; success_rate: number };
      queue: { queued: number; running: number };
      workers: { total: number; healthy: number };
      cost: { approved_shots: number; gpu_seconds: number; cost_units: number; per_shot: number };
    }>("/api/admin/overview", o),

  workers: (o: RequestOptions) => request<{ workers: WorkerRow[] }>("/api/admin/workers", o),

  drain: (workerId: string, drain: boolean, o: RequestOptions) =>
    request<{ draining: boolean }>(`/api/admin/workers/${workerId}/drain`, {
      ...o,
      method: "POST",
      body: { drain },
    }),

  models: (o: RequestOptions) => request<{ models: ModelRow[] }>("/api/admin/models", o),

  reviewLicense: (
    modelId: string,
    body: { status: string; commercial_use: boolean; territories: string[] },
    o: RequestOptions,
  ) => request<{ status: string }>(`/api/admin/models/${modelId}/license`, { ...o, method: "POST", body }),

  setLifecycle: (
    modelId: string,
    body: { version: string; lifecycle: string; canary_weight: number },
    o: RequestOptions,
  ) => request<unknown>(`/api/admin/models/${modelId}/lifecycle`, { ...o, method: "POST", body }),

  skills: (o: RequestOptions) => request<{ skills: Array<Record<string, unknown>> }>("/api/admin/skills", o),

  quality: (o: RequestOptions) =>
    request<{
      dimensions: Array<{ dimension: string; average: string; samples: string; failures: string }>;
      failure_reasons: Array<{ code: string; severity: string; occurrences: string }>;
      repair_rate: number;
    }>("/api/admin/quality", o),

  costs: (dimension: string, o: RequestOptions) =>
    request<{
      dimension: string;
      breakdown: Array<{ dimension_value: string; gpu_seconds: number; cost_units: number; share: number }>;
      per_approved_shot: { approved_shots: number; cost_units: number; per_shot: number };
    }>(`/api/admin/costs?dimension=${dimension}`, o),

  jobs: (o: RequestOptions) => request<{ jobs: Array<Record<string, unknown>> }>("/api/admin/jobs", o),
};
