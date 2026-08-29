import { config, type AppConfig } from "@videoai/config";
import type { GpuProvider } from "./provider.js";
import { ManualGpuProvider } from "./manual.js";
import { GenericSshProvider } from "./ssh.js";
import { RunPodProvider } from "./runpod.js";

export * from "./provider.js";
export { ManualGpuProvider } from "./manual.js";
export { GenericSshProvider } from "./ssh.js";
export { RunPodProvider } from "./runpod.js";

/**
 * Resolve the configured provider. This is the only place in the codebase that
 * knows the concrete provider names; everything else takes a GpuProvider.
 */
export function createGpuProvider(cfg: AppConfig = config(), env = process.env): GpuProvider {
  switch (cfg.GPU_PROVIDER) {
    case "manual":
      return new ManualGpuProvider();
    case "ssh":
      return new GenericSshProvider({
        identityFile: required(env, "GPU_SSH_IDENTITY_FILE"),
        composeFile: required(env, "GPU_SSH_COMPOSE_FILE"),
      });
    case "runpod":
      return new RunPodProvider({
        apiBase: required(env, "GPU_PROVIDER_API_BASE"),
        apiKey: required(env, "GPU_PROVIDER_API_KEY"),
        imageRef: required(env, "GPU_WORKER_IMAGE"),
        profileToInstanceType: JSON.parse(required(env, "GPU_PROFILE_INSTANCE_MAP")) as Record<string, string>,
      });
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required when GPU_PROVIDER selects this provider`);
  }
  return value;
}
