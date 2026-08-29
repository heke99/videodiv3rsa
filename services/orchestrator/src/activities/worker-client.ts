import { createHash } from "node:crypto";
import { config } from "@videoai/config";
import type { GenerateRequest, WorkerEnvelope } from "@videoai/contracts";
import { signEnvelope } from "@videoai/gpu-manager";

/**
 * The only path from our backend to a GPU worker.
 *
 * Every call is signed over its body, so an intercepted request cannot be
 * replayed against a different job, and the worker rejects anything unsigned
 * (spec section 77).
 */

export interface WorkerCallResult {
  storage_key: string;
  sha256: string;
  runtime_ms: number;
  peak_vram_bytes: number;
  model_version: string;
  seed: number;
  metadata: Record<string, unknown>;
}

export async function callWorker(
  endpoint: string,
  runtime: string,
  request: GenerateRequest,
): Promise<WorkerCallResult> {
  const cfg = config();
  const body = JSON.stringify(request);
  const envelope: WorkerEnvelope = signEnvelope(cfg.GPU_GATEWAY_SIGNING_KEY, {
    jobId: request.job_id,
    bodyHash: createHash("sha256").update(body).digest("hex"),
    ttlSeconds: cfg.GPU_ENVELOPE_TTL_SECONDS,
  });

  const response = await fetch(`${endpoint.replace(/\/$/, "")}/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-videoai-envelope": JSON.stringify(envelope),
      "x-videoai-runtime": runtime,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Worker ${runtime} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as WorkerCallResult;
}

export async function cancelOnWorker(endpoint: string, jobId: string): Promise<void> {
  const cfg = config();
  const body = JSON.stringify({ job_id: jobId });
  const envelope = signEnvelope(cfg.GPU_GATEWAY_SIGNING_KEY, {
    jobId,
    bodyHash: createHash("sha256").update(body).digest("hex"),
    ttlSeconds: cfg.GPU_ENVELOPE_TTL_SECONDS,
  });
  await fetch(`${endpoint.replace(/\/$/, "")}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-videoai-envelope": JSON.stringify(envelope) },
    body,
  });
}
