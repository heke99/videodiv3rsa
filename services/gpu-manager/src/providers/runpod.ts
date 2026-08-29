import { query, queryOne, type GpuWorkerRow } from "@videoai/database";
import type { CreateWorkerSpec, GpuProvider, ProviderWorker } from "./provider.js";
import { toProviderWorker } from "./manual.js";

/**
 * A provider that can actually allocate hardware on demand.
 *
 * It is written against the same interface as the others and is only reachable
 * when GPU_PROVIDER selects it and credentials are present. Without an API key
 * it refuses at construction rather than half-working, so a misconfigured
 * deployment fails loudly instead of quietly queueing forever.
 *
 * The endpoint is configuration, never a literal, so pointing this at a
 * different compatible API is an environment change.
 */
export class RunPodProvider implements GpuProvider {
  readonly name = "runpod";
  readonly canProvision = true;

  constructor(
    private readonly opts: {
      apiBase: string;
      apiKey: string;
      imageRef: string;
      /** Maps our capability profiles onto the provider's own sizing names. */
      profileToInstanceType: Record<string, string>;
    },
  ) {
    if (!opts.apiKey) {
      throw new Error("RunPodProvider requires an API key; set it or select a different GPU_PROVIDER");
    }
  }

  async createWorker(spec: CreateWorkerSpec): Promise<ProviderWorker> {
    const instanceType = this.opts.profileToInstanceType[spec.profile];
    if (!instanceType) {
      throw new Error(
        `No instance type is mapped for ${spec.profile}. ` +
          `Add it to the provider's profile mapping rather than hardcoding a GPU model.`,
      );
    }

    const created = await this.call<{ id: string; endpoint?: string }>("POST", "/workers", {
      instance_type: instanceType,
      image: this.opts.imageRef,
      volume: spec.model_volume,
      env: { RUNTIMES: spec.runtimes.join(",") },
      labels: spec.labels ?? {},
    });

    const workerId = `runpod-${created.id}`;
    await queryOne(
      `insert into public.gpu_workers
         (worker_id, provider, provider_ref, endpoint, lifecycle, profile)
       values ($1, 'runpod', $2, $3, 'PROVISIONING', $4)
       on conflict (worker_id) do update set lifecycle = 'PROVISIONING'
       returning worker_id`,
      [workerId, created.id, created.endpoint ?? "", spec.profile],
    );

    return {
      worker_id: workerId,
      provider_ref: created.id,
      endpoint: created.endpoint ?? "",
      lifecycle: "PROVISIONING",
      capabilities: null,
    };
  }

  async startWorker(workerId: string): Promise<void> {
    await this.call("POST", `/workers/${await this.ref(workerId)}/start`);
  }

  async stopWorker(workerId: string): Promise<void> {
    await this.call("POST", `/workers/${await this.ref(workerId)}/stop`);
  }

  async getWorker(workerId: string): Promise<ProviderWorker | null> {
    const row = await queryOne<GpuWorkerRow>(
      "select * from public.gpu_workers where worker_id = $1 and provider = 'runpod'",
      [workerId],
    );
    return row ? toProviderWorker(row) : null;
  }

  async listWorkers(): Promise<ProviderWorker[]> {
    const rows = await query<GpuWorkerRow>("select * from public.gpu_workers where provider = 'runpod'");
    return rows.map(toProviderWorker);
  }

  async getHealth(workerId: string): Promise<{ healthy: boolean; detail: string }> {
    try {
      const status = await this.call<{ status: string }>("GET", `/workers/${await this.ref(workerId)}`);
      return { healthy: status.status === "RUNNING", detail: status.status };
    } catch (error) {
      return { healthy: false, detail: (error as Error).message };
    }
  }

  async attachVolume(workerId: string, volume: string): Promise<void> {
    await this.call("POST", `/workers/${await this.ref(workerId)}/volumes`, { volume });
  }

  private async ref(workerId: string): Promise<string> {
    const row = await queryOne<{ provider_ref: string }>(
      "select provider_ref from public.gpu_workers where worker_id = $1 and provider = 'runpod'",
      [workerId],
    );
    if (!row) throw new Error(`Worker ${workerId} is not registered with the runpod provider`);
    return row.provider_ref;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.opts.apiBase.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.apiKey}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw new Error(`GPU provider returned ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  }
}
