import { NativeConnection, Worker } from "@temporalio/worker";
import { config } from "@videoai/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Temporal worker process. Self-hosted; the address is configuration
 * (spec section 48).
 */
const cfg = config();

const connection = await NativeConnection.connect({ address: cfg.TEMPORAL_ADDRESS });

const worker = await Worker.create({
  connection,
  namespace: cfg.TEMPORAL_NAMESPACE,
  taskQueue: cfg.TEMPORAL_TASK_QUEUE,
  workflowsPath: path.join(path.dirname(fileURLToPath(import.meta.url)), "workflows/index.js"),
  // Activities are injected by the API service, which owns the database and
  // storage handles; the workflow layer stays free of them.
  activities: (await import("./activities/implementations.js")).createActivities(),
});

await worker.run();
