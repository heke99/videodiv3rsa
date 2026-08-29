import { Client, Connection } from "@temporalio/client";
import { config, type AppConfig } from "@videoai/config";
import type { JobProgress } from "@videoai/contracts";
import type { ProductionInput, ProductionResult } from "./workflows/production.js";

/**
 * How the API starts, watches and cancels a production. The API never runs
 * workflow code itself; it hands work to Temporal and reads back state.
 */

let client: Client | null = null;

export async function temporal(cfg: AppConfig = config()): Promise<Client> {
  if (client) return client;
  const connection = await Connection.connect({ address: cfg.TEMPORAL_ADDRESS });
  client = new Client({ connection, namespace: cfg.TEMPORAL_NAMESPACE });
  return client;
}

export async function startProduction(
  input: ProductionInput,
  cfg: AppConfig = config(),
): Promise<{ workflow_id: string; run_id: string }> {
  const c = await temporal(cfg);
  // The job id is the workflow id, so submitting the same job twice attaches
  // to the running production rather than starting a second one.
  const handle = await c.workflow.start("production", {
    taskQueue: cfg.TEMPORAL_TASK_QUEUE,
    workflowId: `production-${input.job_id}`,
    args: [input],
    workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
  });
  return { workflow_id: handle.workflowId, run_id: handle.firstExecutionRunId };
}

export async function getProgress(jobId: string, cfg: AppConfig = config()): Promise<JobProgress> {
  const c = await temporal(cfg);
  return c.workflow.getHandle(`production-${jobId}`).query<JobProgress>("progress");
}

export async function cancelProduction(jobId: string, cfg: AppConfig = config()): Promise<void> {
  const c = await temporal(cfg);
  // A signal rather than a Temporal cancellation: the workflow stops future
  // stages, keeps finished assets and releases its GPU reservation, which a
  // hard cancel would not do (spec section 50).
  await c.workflow.getHandle(`production-${jobId}`).signal("cancel");
}

export async function awaitResult(jobId: string, cfg: AppConfig = config()): Promise<ProductionResult> {
  const c = await temporal(cfg);
  return c.workflow.getHandle(`production-${jobId}`).result() as Promise<ProductionResult>;
}
