import { createHash } from "node:crypto";

/**
 * Storage contract (spec section 59). Business logic only ever sees this
 * interface, so moving from Supabase Storage to S3 or to a local volume is a
 * configuration change rather than a rewrite.
 */

export interface ObjectMetadata {
  key: string;
  size_bytes: number;
  mime: string;
  sha256?: string;
  updated_at?: string;
}

export interface PutOptions {
  mime: string;
  /** Objects are private by default; nothing is world readable unless asked. */
  cacheControl?: string;
  upsert?: boolean;
}

export interface StorageAdapter {
  readonly provider: "supabase" | "s3" | "local";
  put(key: string, body: Uint8Array, options: PutOptions): Promise<ObjectMetadata>;
  get(key: string): Promise<Uint8Array>;
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
  copy(fromKey: string, toKey: string): Promise<void>;
  head(key: string): Promise<ObjectMetadata | null>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly key: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Content-addressed keys. A user's filename never becomes part of a path
 * (spec section 76): it is stored as metadata, while the key is derived from
 * the tenant, the project and the content hash. This makes traversal and
 * collision attacks structurally impossible and makes duplicate uploads free.
 */
export function contentKey(params: {
  organizationId: string;
  projectId?: string | null;
  kind: string;
  sha256: string;
  extension: string;
}): string {
  const ext = params.extension.replace(/^\.+/, "").toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) {
    throw new Error(`Refusing to build a storage key with extension "${params.extension}"`);
  }
  if (!/^[a-f0-9]{64}$/.test(params.sha256)) {
    throw new Error("contentKey requires a hex sha256 digest");
  }
  const scope = params.projectId ? `projects/${params.projectId}` : "library";
  // Two-level fan-out on the hash keeps directory listings usable at scale.
  const shard = params.sha256.slice(0, 2);
  return `${params.organizationId}/${scope}/${params.kind}/${shard}/${params.sha256}.${ext}`;
}
