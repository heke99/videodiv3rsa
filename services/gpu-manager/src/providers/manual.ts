import { query, queryOne, type GpuWorkerRow } from "@videoai/database";
import type { WorkerCapabilities } from "@videoai/contracts";
import {
  ProviderUnsupportedError,
  type CreateWorkerSpec,
  type GpuProvider,
  type ProviderWorker,
} from "./provider.js";

/**
 * Workers an operator registered by hand: a rented box, a machine under a
 * desk, anything already running our worker image. The registry is the source
 * of truth and this provider only reads it.
 *
 * This is the provider that makes the whole abstraction honest — if the system
 * works with no ability to provision at all, nothing above it has smuggled in
 * an assumption that capacity can be conjured.
 */
export class ManualGpuProvider implements GpuProvider {
  readonly name = "manual";
  readonly canProvision = false;

  async createWorker(_spec: CreateWorkerSpec): Promise<ProviderWorker> {
    throw new ProviderUnsupportedError(this.name, "create workers");
  }

  async startWorker(_workerId: string): Promise<void> {
    throw new ProviderUnsupportedError(this.name, "start workers");
  }

  async stopWorker(_workerId: string): Promise<void> {
    throw new ProviderUnsupportedError(this.name, "stop workers");
  }

  async getWorker(workerId: string): Promise<ProviderWorker | null> {
    const row = await queryOne<GpuWorkerRow>(
      "select * from public.gpu_workers where worker_id = $1",
      [workerId],
    );
    return row ? toProviderWorker(row) : null;
  }

  async listWorkers(): Promise<ProviderWorker[]> {
    const rows = await query<GpuWorkerRow>(
      "select * from public.gpu_workers where provider = 'manual'",
    );
    return rows.map(toProviderWorker);
  }

  async getHealth(workerId: string): Promise<{ healthy: boolean; detail: string }> {
    const row = await queryOne<GpuWorkerRow>(
      "select healthy, last_seen_at from public.gpu_workers where worker_id = $1",
      [workerId],
    );
    if (!row) return { healthy: false, detail: "worker is not registered" };
    if (!row.healthy) return { healthy: false, detail: "worker reported unhealthy" };
    // A worker that stopped reporting is not healthy regardless of its last flag.
    const seen = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
    const age = (Date.now() - seen) / 1000;
    if (age > 120) return { healthy: false, detail: `no heartbeat for ${Math.round(age)}s` };
    return { healthy: true, detail: "heartbeat current" };
  }

  async attachVolume(_workerId: string, _volume: string): Promise<void> {
    throw new ProviderUnsupportedError(this.name, "attach volumes");
  }
}

export function toProviderWorker(row: GpuWorkerRow): ProviderWorker {
  const capabilities: WorkerCapabilities = {
    cuda_version: row.cuda_version,
    driver_version: row.driver_version,
    compute_capability: row.compute_capability,
    gpu_count: row.gpu_count,
    vram_total_bytes: Number(row.vram_total_bytes),
    vram_free_bytes: Number(row.vram_free_bytes),
    supported_precisions: row.supported_precisions as WorkerCapabilities["supported_precisions"],
    profile: row.profile as WorkerCapabilities["profile"],
    runtimes: [],
  };
  return {
    worker_id: row.worker_id,
    provider_ref: row.provider_ref,
    endpoint: row.endpoint,
    lifecycle: row.lifecycle as ProviderWorker["lifecycle"],
    capabilities,
  };
}
