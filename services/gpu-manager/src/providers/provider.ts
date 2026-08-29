import type { GpuProfile, GpuWorker, WorkerCapabilities } from "@videoai/contracts";

/**
 * GPU provider abstraction (spec section 56).
 *
 * Business logic never learns which provider is in use. It asks for a worker
 * with a capability profile, and a provider implementation is responsible for
 * making one exist. Adding a provider means adding a file here; it must never
 * mean touching the scheduler, the router, the workflows or the UI.
 */

export interface CreateWorkerSpec {
  profile: GpuProfile;
  /** Runtime images the worker must be able to serve. */
  runtimes: string[];
  /** Persistent volume holding the model cache, attached rather than copied. */
  model_volume: string;
  labels?: Record<string, string>;
}

export interface ProviderWorker {
  worker_id: string;
  provider_ref: string;
  endpoint: string;
  lifecycle: GpuWorker["lifecycle"];
  capabilities: WorkerCapabilities | null;
}

export interface GpuProvider {
  readonly name: string;
  /**
   * Whether this provider can bring capacity into existence on demand. Manual
   * and SSH providers cannot: the scheduler must queue rather than scale.
   */
  readonly canProvision: boolean;

  createWorker(spec: CreateWorkerSpec): Promise<ProviderWorker>;
  startWorker(workerId: string): Promise<void>;
  stopWorker(workerId: string): Promise<void>;
  getWorker(workerId: string): Promise<ProviderWorker | null>;
  listWorkers(): Promise<ProviderWorker[]>;
  getHealth(workerId: string): Promise<{ healthy: boolean; detail: string }>;
  attachVolume(workerId: string, volume: string): Promise<void>;
}

export class ProviderUnsupportedError extends Error {
  constructor(provider: string, operation: string) {
    super(
      `The ${provider} provider cannot ${operation}. ` +
        `Capacity has to be provisioned out of band for this provider.`,
    );
    this.name = "ProviderUnsupportedError";
  }
}
