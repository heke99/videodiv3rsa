/**
 * The browser's only route to the backend.
 *
 * Every call carries the caller's token and the organisation they are acting
 * in. The base URL is configuration; nothing in the app knows a hostname.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function baseUrl(): string {
  const url = process.env["NEXT_PUBLIC_API_URL"];
  if (!url) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured; the app cannot reach its API.");
  }
  return url.replace(/\/$/, "");
}

export interface RequestOptions {
  token: string;
  organizationId?: string;
  signal?: AbortSignal;
}

async function request<T>(
  path: string,
  options: RequestOptions & { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      authorization: `Bearer ${options.token}`,
      ...(options.organizationId ? { "x-organization-id": options.organizationId } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      (detail as { error?: string })?.error ?? `Request failed (${response.status})`,
      detail,
    );
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export interface ProjectSummary {
  id: string;
  title: string;
  status: string;
  quality_mode: string;
  aspect_ratio: string;
  target_duration_frames: string;
  frame_rate_num: number;
  frame_rate_den: number;
  thumbnail_asset_id: string | null;
  updated_at: string;
  shot_count: string;
}

export interface ShotSummary {
  id: string;
  slug: string;
  scene_id: string;
  index: number;
  duration_frames: string;
  shot_type: string;
  status: string;
  stale: boolean;
  stale_reasons: string[];
  current_asset_id: string | null;
  current_version: number;
  requires_identity_lock: boolean;
  requires_product_fidelity: boolean;
}

export interface JobState {
  id: string;
  status: string;
  progress: Record<string, unknown>;
  error_message: string | null;
  budget_spend: Record<string, number>;
  live?: { status: string; step: string | null; completed_units: number; total_units: number };
}

export interface TimelineEventView {
  id: string;
  track_id: string;
  slug: string;
  kind: "video" | "audio" | "caption";
  asset_id: string | null;
  shot_id: string | null;
  start_frame: number | null;
  end_frame: number | null;
  start_sample: number | null;
  end_sample: number | null;
  text_content: string | null;
  display_start_seconds: number;
}

export interface TimelineView {
  timeline: {
    id: string;
    current_version: number;
    frame_rate_num: number;
    frame_rate_den: number;
    audio_sample_rate: number;
    duration_frames: number;
    duration_seconds: number;
    loudness_profile: string;
  } | null;
  tracks: Array<{ id: string; slug: string; kind: string; index: number; muted: boolean }>;
  events: TimelineEventView[];
}

export const api = {
  listProjects: (o: RequestOptions) => request<{ projects: ProjectSummary[] }>("/api/projects", o),

  createProject: (
    body: {
      prompt: string;
      mode: string;
      aspect_ratio: string;
      target_duration_seconds: number;
      approval_gates?: boolean;
    },
    o: RequestOptions,
  ) => request<{ project_id: string }>("/api/projects", { ...o, method: "POST", body }),

  getProject: (id: string, o: RequestOptions) =>
    request<{
      project: ProjectSummary;
      scenes: Array<{ id: string; slug: string; index: number; summary: string }>;
      shots: ShotSummary[];
      job: JobState | null;
    }>(`/api/projects/${id}`, o),

  generate: (id: string, o: RequestOptions) =>
    request<{ job_id: string }>(`/api/projects/${id}/generate`, { ...o, method: "POST" }),

  getJob: (id: string, o: RequestOptions) => request<JobState>(`/api/jobs/${id}`, o),

  cancelJob: (id: string, o: RequestOptions) =>
    request<{ cancelled: boolean }>(`/api/jobs/${id}/cancel`, { ...o, method: "POST" }),

  getTimeline: (projectId: string, o: RequestOptions) =>
    request<TimelineView>(`/api/projects/${projectId}/timeline`, o),

  getShot: (id: string, o: RequestOptions) =>
    request<{
      shot: ShotSummary;
      versions: Array<{ version: number; asset_id: string | null; created_at: string; overall: number | null; passed: boolean | null }>;
      evaluation: { id: string; overall: number; passed: boolean; metrics: Array<{ dimension: string; score: number; threshold: number | null; passed: boolean }> } | null;
    }>(`/api/shots/${id}`, o),

  repairShot: (id: string, scope: string, o: RequestOptions) =>
    request<{ job_id: string }>(`/api/shots/${id}/repair`, { ...o, method: "POST", body: { scope } }),

  restoreShot: (id: string, version: number, o: RequestOptions) =>
    request<{ restored_version: number }>(`/api/shots/${id}/restore`, {
      ...o, method: "POST", body: { version },
    }),

  reorderShots: (projectId: string, order: string[], o: RequestOptions) =>
    request<{ reordered: number }>(`/api/projects/${projectId}/shots/reorder`, {
      ...o, method: "POST", body: { order },
    }),

  getAsset: (id: string, o: RequestOptions) =>
    request<{ asset_id: string; version: number; mime: string; url: string; versions: Array<{ version: number }> }>(
      `/api/assets/${id}`, o,
    ),

  library: (kind: string, o: RequestOptions & { projectId?: string }) =>
    request<{ entries: Array<Record<string, unknown>> }>(
      `/api/library/${kind}${o.projectId ? `?project_id=${o.projectId}` : ""}`, o,
    ),

  renders: (projectId: string, o: RequestOptions) =>
    request<{ renders: Array<Record<string, unknown>> }>(`/api/projects/${projectId}/renders`, o),

  createExport: (
    projectId: string,
    body: { aspect_ratio: string; burned_captions: boolean; container?: string },
    o: RequestOptions,
  ) => request<{ export_id: string }>(`/api/projects/${projectId}/exports`, { ...o, method: "POST", body }),

  downloadExport: (id: string, o: RequestOptions) =>
    request<{ url: string }>(`/api/exports/${id}/download`, o),
};
