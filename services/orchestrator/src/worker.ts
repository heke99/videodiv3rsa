import { NativeConnection, Worker } from "@temporalio/worker";
import { config } from "@videoai/config";
import { configureTelemetry } from "@videoai/telemetry";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Temporal worker process. Self-hosted; the address is configuration
 * (spec section 48).
 */
const cfg = config();

// Spans and metrics go nowhere until an exporter is attached, and this is the
// only place in the worker process that runs once at startup.
configureTelemetry({ otlpEndpoint: cfg.OTEL_EXPORTER_OTLP_ENDPOINT });

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
