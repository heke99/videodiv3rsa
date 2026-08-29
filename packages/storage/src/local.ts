import { createHmac, randomUUID } from "node:crypto";
import { mkdir, copyFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "@videoai/config";
import {
  StorageError,
  sha256,
  type ObjectMetadata,
  type PutOptions,
  type StorageAdapter,
} from "./adapter.js";

/**
 * Local filesystem implementation, used for development and for a fully
 * self-hosted deployment with no object store. Signed URLs are HMAC tokens
 * that the media service verifies before serving a file, so the local backend
 * has the same "nothing is public" property as the remote ones.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly provider = "local" as const;

  constructor(
    private readonly root: string,
    private readonly signingKey: string,
    private readonly publicBase: string,
  ) {}

  static fromConfig(cfg: AppConfig): LocalStorageAdapter {
    if (!cfg.STORAGE_LOCAL_ROOT) throw new Error("Local storage requires STORAGE_LOCAL_ROOT");
    return new LocalStorageAdapter(
      cfg.STORAGE_LOCAL_ROOT,
      cfg.GPU_GATEWAY_SIGNING_KEY,
      cfg.STORAGE_PUBLIC_BASE ?? `${cfg.PUBLIC_APP_URL}/media`,
    );
  }

  /** Resolve inside the root and refuse anything that escapes it. */
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    const root = path.resolve(this.root);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new StorageError("Key escapes the storage root", key);
    }
    return full;
  }

  async put(key: string, body: Uint8Array, options: PutOptions): Promise<ObjectMetadata> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    if (!options.upsert) {
      const existing = await this.head(key);
      // Keys are content addressed, so an existing object has identical bytes.
      if (existing) return existing;
    }
    // Write to a temporary name and rename, so a crash never leaves a partial
    // object at a key that callers treat as complete.
    const tmp = `${full}.${randomUUID()}.tmp`;
    await writeFile(tmp, body);
    const { rename } = await import("node:fs/promises");
    await rename(tmp, full);
    return { key, size_bytes: body.byteLength, mime: options.mime, sha256: sha256(body) };
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.resolve(key)));
    } catch (error) {
      throw new StorageError("Read failed", key, error);
    }
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = this.sign(key, expires);
    const url = new URL(`${this.publicBase.replace(/\/$/, "")}/${key}`);
    url.searchParams.set("expires", String(expires));
    url.searchParams.set("signature", signature);
    return url.toString();
  }

  /** Verification side, used by the media service before serving bytes. */
  verify(key: string, expires: number, signature: string): boolean {
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
    const expected = this.sign(key, expires);
    if (expected.length !== signature.length) return false;
    // Constant-time comparison so the signature cannot be probed byte by byte.
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return diff === 0;
  }

  private sign(key: string, expires: number): string {
    return createHmac("sha256", this.signingKey).update(`${key}:${expires}`).digest("hex");
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    const target = this.resolve(toKey);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(this.resolve(fromKey), target);
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    try {
      const info = await stat(this.resolve(key));
      return {
        key,
        size_bytes: info.size,
        mime: "application/octet-stream",
        updated_at: info.mtime.toISOString(),
      };
    } catch {
      return null;
    }
  }
}
