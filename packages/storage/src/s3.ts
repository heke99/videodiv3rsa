import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppConfig } from "@videoai/config";
import {
  StorageError,
  sha256,
  type ObjectMetadata,
  type PutOptions,
  type StorageAdapter,
} from "./adapter.js";

/**
 * S3 compatible implementation. Works against AWS, R2, MinIO or anything else
 * speaking the same API; the endpoint is configuration, never a literal.
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly provider = "s3" as const;
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    opts: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string },
  ) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      forcePathStyle: true,
    });
  }

  static fromConfig(cfg: AppConfig): S3StorageAdapter {
    if (!cfg.S3_ENDPOINT || !cfg.S3_REGION || !cfg.S3_ACCESS_KEY_ID || !cfg.S3_SECRET_ACCESS_KEY) {
      throw new Error("S3 storage requires S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
    }
    return new S3StorageAdapter(cfg.STORAGE_BUCKET, {
      endpoint: cfg.S3_ENDPOINT,
      region: cfg.S3_REGION,
      accessKeyId: cfg.S3_ACCESS_KEY_ID,
      secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
    });
  }

  async put(key: string, body: Uint8Array, options: PutOptions): Promise<ObjectMetadata> {
    const digest = sha256(body);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: options.mime,
          CacheControl: options.cacheControl,
          Metadata: { sha256: digest },
        }),
      );
    } catch (error) {
      throw new StorageError("Upload failed", key, error);
    }
    return { key, size_bytes: body.byteLength, mime: options.mime, sha256: digest };
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return new Uint8Array(await res.Body!.transformToByteArray());
    } catch (error) {
      throw new StorageError("Download failed", key, error);
    }
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      throw new StorageError("Delete failed", key, error);
    }
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${fromKey}`,
          Key: toKey,
        }),
      );
    } catch (error) {
      throw new StorageError("Copy failed", fromKey, error);
    }
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        key,
        size_bytes: res.ContentLength ?? 0,
        mime: res.ContentType ?? "application/octet-stream",
        sha256: res.Metadata?.["sha256"],
        updated_at: res.LastModified?.toISOString(),
      };
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === "NotFound" || name === "NoSuchKey") return null;
      throw new StorageError("Head failed", key, error);
    }
  }
}
