import { config, type AppConfig } from "@videoai/config";
import type { StorageAdapter } from "./adapter.js";
import { LocalStorageAdapter } from "./local.js";
import { S3StorageAdapter } from "./s3.js";
import { SupabaseStorageAdapter } from "./supabase.js";

export * from "./adapter.js";
export { LocalStorageAdapter } from "./local.js";
export { S3StorageAdapter } from "./s3.js";
export { SupabaseStorageAdapter } from "./supabase.js";

let cached: StorageAdapter | null = null;

/** Resolve the configured backend. Callers depend on the interface only. */
export function storage(cfg: AppConfig = config()): StorageAdapter {
  cached ??= createStorage(cfg);
  return cached;
}

export function createStorage(cfg: AppConfig): StorageAdapter {
  switch (cfg.STORAGE_PROVIDER) {
    case "supabase":
      return SupabaseStorageAdapter.fromConfig(cfg);
    case "s3":
      return S3StorageAdapter.fromConfig(cfg);
    case "local":
      return LocalStorageAdapter.fromConfig(cfg);
  }
}

export function resetStorageCache(): void {
  cached = null;
}
