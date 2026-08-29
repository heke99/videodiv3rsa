import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { query, queryOne, type GpuWorkerRow } from "@videoai/database";
import type { CreateWorkerSpec, GpuProvider, ProviderWorker } from "./provider.js";
import { toProviderWorker } from "./manual.js";

const exec = promisify(execFile);

/**
 * A machine we can reach over SSH and drive with docker compose. This covers
 * a rented dedicated GPU host, which is the common case between "registered by
 * hand" and "an API that allocates hardware".
 *
 * Host details come from the registry rather than from configuration, so
 * adding a second machine is a row rather than a redeploy.
 */
export class GenericSshProvider implements GpuProvider {
  readonly name = "ssh";
  /** The machine exists already; we start and stop its containers, not it. */
  readonly canProvision = false;

  constructor(
    private readonly opts: {
      identityFile: string;
      composeFile: string;
      commandTimeoutMs?: number;
    },
  ) {}

  async createWorker(spec: CreateWorkerSpec): Promise<ProviderWorker> {
    throw new Error(
      `The ssh provider cannot allocate hardware. Register the host first, then ` +
        `startWorker brings up its ${spec.runtimes.join(", ")} runtimes.`,
    );
  }

  async startWorker(workerId: string): Promise<void> {
    await this.ssh(workerId, ["docker", "compose", "-f", this.opts.composeFile, "up", "-d"]);
  }

  async stopWorker(workerId: string): Promise<void> {
    await this.ssh(workerId, ["docker", "compose", "-f", this.opts.composeFile, "down"]);
  }

  async getWorker(workerId: string): Promise<ProviderWorker | null> {
    const row = await queryOne<GpuWorkerRow>(
      "select * from public.gpu_workers where worker_id = $1 and provider = 'ssh'",
      [workerId],
    );
    return row ? toProviderWorker(row) : null;
  }

  async listWorkers(): Promise<ProviderWorker[]> {
    const rows = await query<GpuWorkerRow>("select * from public.gpu_workers where provider = 'ssh'");
    return rows.map(toProviderWorker);
  }

  async getHealth(workerId: string): Promise<{ healthy: boolean; detail: string }> {
    try {
      const { stdout } = await this.ssh(workerId, ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"]);
      const gpus = stdout.trim().split("\n").filter(Boolean);
      return gpus.length > 0
        ? { healthy: true, detail: `${gpus.length} GPU(s) visible` }
        : { healthy: false, detail: "no GPU visible to the host" };
    } catch (error) {
      return { healthy: false, detail: `ssh probe failed: ${(error as Error).message}` };
    }
  }

  async attachVolume(workerId: string, volume: string): Promise<void> {
    // The model cache is a bind mount on the host, so attaching means making
    // sure the path exists before the runtimes come up.
    await this.ssh(workerId, ["mkdir", "-p", volume]);
  }

  /**
   * `provider_ref` holds the ssh destination for the worker. Arguments are
   * passed as a list rather than a shell string so nothing from the registry
   * can be interpreted as shell syntax.
   */
  private async ssh(workerId: string, argv: string[]) {
    const row = await queryOne<{ provider_ref: string }>(
      "select provider_ref from public.gpu_workers where worker_id = $1 and provider = 'ssh'",
      [workerId],
    );
    if (!row) throw new Error(`Worker ${workerId} is not registered with the ssh provider`);
    return exec(
      "ssh",
      ["-i", this.opts.identityFile, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", row.provider_ref, "--", ...argv],
      { timeout: this.opts.commandTimeoutMs ?? 60_000 },
    );
  }
}
