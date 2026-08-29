import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "@videoai/config";
import {
  StorageError,
  sha256,
  type ObjectMetadata,
  type PutOptions,
  type StorageAdapter,
} from "./adapter.js";

/** Supabase Storage backed implementation. The bucket must be private. */
export class SupabaseStorageAdapter implements StorageAdapter {
  readonly provider = "supabase" as const;
  private readonly client: SupabaseClient;

  constructor(
    private readonly bucket: string,
    url: string,
    serviceRoleKey: string,
  ) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  static fromConfig(cfg: AppConfig): SupabaseStorageAdapter {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    }
    return new SupabaseStorageAdapter(cfg.STORAGE_BUCKET, cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);
  }

  async put(key: string, body: Uint8Array, options: PutOptions): Promise<ObjectMetadata> {
    const { error } = await this.client.storage.from(this.bucket).upload(key, body, {
      contentType: options.mime,
      cacheControl: options.cacheControl ?? "3600",
      upsert: options.upsert ?? false,
    });
    if (error) throw new StorageError(`Upload failed: ${error.message}`, key, error);
    return { key, size_bytes: body.byteLength, mime: options.mime, sha256: sha256(body) };
  }

  async get(key: string): Promise<Uint8Array> {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) throw new StorageError(`Download failed: ${error?.message}`, key, error);
    return new Uint8Array(await data.arrayBuffer());
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(key, expiresInSeconds);
    if (error || !data) throw new StorageError(`Signing failed: ${error?.message}`, key, error);
    return data.signedUrl;
  }

  async delete(key: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([key]);
    if (error) throw new StorageError(`Delete failed: ${error.message}`, key, error);
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).copy(fromKey, toKey);
    if (error) throw new StorageError(`Copy failed: ${error.message}`, fromKey, error);
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const slash = key.lastIndexOf("/");
    const prefix = slash === -1 ? "" : key.slice(0, slash);
    const name = key.slice(slash + 1);
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .list(prefix, { search: name, limit: 1 });
    if (error) throw new StorageError(`Head failed: ${error.message}`, key, error);
    const found = data?.find((o) => o.name === name);
    if (!found) return null;
    return {
      key,
      size_bytes: Number(found.metadata?.["size"] ?? 0),
      mime: String(found.metadata?.["mimetype"] ?? "application/octet-stream"),
      updated_at: found.updated_at ?? undefined,
    };
  }
}
