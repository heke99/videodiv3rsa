import { config } from "@videoai/config";
import { closeDb } from "@videoai/database";
import { configureTelemetry } from "@videoai/telemetry";
import { tick } from "./maintenance.js";

/**
 * The fleet maintenance process.
 *
 * A loop rather than an HTTP server: nothing calls the GPU manager, it watches.
 * The interval is a fraction of the idle timeout so a worker is stopped near
 * the deadline rather than up to a full timeout late, and floored so a very
 * short timeout cannot turn this into a busy loop against the database.
 */

const cfg = config();
configureTelemetry({ otlpEndpoint: cfg.OTEL_EXPORTER_OTLP_ENDPOINT });

const intervalMs = Math.max(15_000, Math.floor((cfg.GPU_IDLE_TIMEOUT_SECONDS * 1000) / 4));

let stopping = false;

async function loop(): Promise<void> {
  while (!stopping) {
    try {
      const report = await tick();
      if (
        report.reservations_expired > 0 ||
        report.workers_marked_unhealthy.length > 0 ||
        report.workers_suspended.length > 0 ||
        report.suspend_unsupported.length > 0
      ) {
        // Quiet when there is nothing to say. A line every fifteen seconds
        // saying nothing happened is how a log stops being read.
        console.log(JSON.stringify({ event: "maintenance", ...report }));
      }
    } catch (error) {
      // One bad pass must not end the process: the next one may well succeed,
      // and a maintenance loop that exits on a transient database error is
      // worse than no loop, because it looks like it is running.
      console.error(JSON.stringify({ event: "maintenance_failed", error: (error as Error).message }));
    }
    await sleep(intervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Never hold the process open on the timer alone; a shutdown signal should
    // not wait out the interval.
    timer.unref();
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    void closeDb().finally(() => process.exit(0));
  });
}

console.log(
  JSON.stringify({ event: "maintenance_started", interval_ms: intervalMs, provider: cfg.GPU_PROVIDER }),
);
await loop();
