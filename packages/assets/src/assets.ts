import type { GenerationProvenance } from "@videoai/contracts";
import { queryOne, transaction, type AssetVersionRow } from "@videoai/database";
import { contentKey, sha256, storage, type StorageAdapter } from "@videoai/storage";

/**
 * Asset creation (spec sections 62, 63, 64).
 *
 * Everything that becomes an asset -- a generated shot, an uploaded reference,
 * a rendered export -- goes through here. Concentrating it in one function is
 * what makes the immutability rule hold: there is no second path that could
 * overwrite bytes, and no caller that could invent its own storage key.
 */

export interface MediaMetadata {
  width?: number | null;
  height?: number | null;
  frame_count?: number | null;
  frame_rate_num?: number | null;
  frame_rate_den?: number | null;
  duration_samples?: number | null;
  audio_sample_rate?: number | null;
  audio_channels?: number | null;
  video_codec?: string | null;
  audio_codec?: string | null;
  pixel_format?: string | null;
}

export interface CreateAssetInput {
  organization_id: string;
  project_id?: string | null;
  kind: "image" | "video" | "audio" | "voice_reference" | "caption" | "document" | "render";
  role?: string | null;
  label?: string | null;
  mime: string;
  extension: string;
  body: Uint8Array;
  metadata?: MediaMetadata;
  created_by?: string | null;
  /** Set when this asset is the output of a generation attempt. */
  generation_attempt_id?: string | null;
  provenance?: GenerationProvenance;
}

export interface AssetVersionRef {
  asset_id: string;
  version: number;
  storage_key: string;
  sha256: string;
  /** True when identical bytes already existed and were reused. */
  deduplicated: boolean;
}

/**
 * Write bytes and record them as version 1 of a new asset.
 *
 * Identical content in the same organisation is deduplicated: the same bytes
 * uploaded twice reuse the same object rather than paying for storage twice.
 * The asset row is still new, because two projects referencing the same file
 * are two assets with two lifecycles.
 */
export async function createAsset(
  input: CreateAssetInput,
  store: StorageAdapter = storage(),
): Promise<AssetVersionRef> {
  const digest = sha256(input.body);
  const key = contentKey({
    organizationId: input.organization_id,
    projectId: input.project_id ?? null,
    kind: input.kind,
    sha256: digest,
    extension: input.extension,
  });

  const existing = await store.head(key);
  if (!existing) {
    await store.put(key, input.body, { mime: input.mime });
  }

  const assetId = await transaction(async (client) => {
    const asset = await client.query<{ id: string }>(
      `insert into public.assets
         (organization_id, project_id, kind, role, label, current_version, created_by)
       values ($1, $2, $3, $4, $5, 1, $6)
       returning id`,
      [
        input.organization_id,
        input.project_id ?? null,
        input.kind,
        input.role ?? null,
        input.label ?? null,
        input.created_by ?? null,
      ],
    );
    const id = asset.rows[0]!.id;

    await client.query(
      `insert into public.asset_versions
         (asset_id, organization_id, version, storage_key, storage_provider, sha256, mime,
          size_bytes, original_filename, width, height, frame_count, frame_rate_num,
          frame_rate_den, duration_samples, audio_sample_rate, audio_channels,
          video_codec, audio_codec, pixel_format, generation_id, created_by)
       values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        id,
        input.organization_id,
        key,
        store.provider,
        digest,
        input.mime,
        input.body.byteLength,
        input.label ?? null,
        ...metadataParams(input.metadata),
        input.generation_attempt_id ?? null,
        input.created_by ?? null,
      ],
    );

    if (input.generation_attempt_id) {
      await client.query(
        `insert into public.generation_outputs (attempt_id, organization_id, asset_id, output_hash)
         values ($1, $2, $3, $4)`,
        [input.generation_attempt_id, input.organization_id, id, digest],
      );
      if (input.provenance) {
        await client.query(
          "update public.generation_attempts set provenance = $2 where id = $1",
          [input.generation_attempt_id, input.provenance],
        );
      }
    }

    return id;
  });

  return { asset_id: assetId, version: 1, storage_key: key, sha256: digest, deduplicated: Boolean(existing) };
}

/**
 * Add a new version to an existing asset.
 *
 * The previous version's bytes are untouched, which is what makes "restore
 * v2" possible after v3 turns out worse (spec section 100). The asset's
 * `current_version` moves; nothing is deleted.
 */
export async function addAssetVersion(
  assetId: string,
  input: Omit<CreateAssetInput, "kind" | "role" | "label">,
  store: StorageAdapter = storage(),
): Promise<AssetVersionRef> {
  const digest = sha256(input.body);
  const key = contentKey({
    organizationId: input.organization_id,
    projectId: input.project_id ?? null,
    kind: "version",
    sha256: digest,
    extension: input.extension,
  });

  const existing = await store.head(key);
  if (!existing) {
    await store.put(key, input.body, { mime: input.mime });
  }

  const version = await transaction(async (client) => {
    const owner = await client.query<{ organization_id: string }>(
      "select organization_id from public.assets where id = $1 for update",
      [assetId],
    );
    if (owner.rows[0]?.organization_id !== input.organization_id) {
      throw new Error(`Asset ${assetId} does not belong to this organisation`);
    }

    const next = await client.query<{ version: number }>(
      `select coalesce(max(version), 0) + 1 as version
       from public.asset_versions where asset_id = $1`,
      [assetId],
    );
    const versionNumber = next.rows[0]!.version;

    await client.query(
      `insert into public.asset_versions
         (asset_id, organization_id, version, storage_key, storage_provider, sha256, mime,
          size_bytes, original_filename, width, height, frame_count, frame_rate_num,
          frame_rate_den, duration_samples, audio_sample_rate, audio_channels,
          video_codec, audio_codec, pixel_format, generation_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
      [
        assetId,
        input.organization_id,
        versionNumber,
        key,
        store.provider,
        digest,
        input.mime,
        input.body.byteLength,
        null,
        ...metadataParams(input.metadata),
        input.generation_attempt_id ?? null,
        input.created_by ?? null,
      ],
    );

    await client.query("update public.assets set current_version = $2 where id = $1", [
      assetId,
      versionNumber,
    ]);

    return versionNumber;
  });

  return { asset_id: assetId, version, storage_key: key, sha256: digest, deduplicated: Boolean(existing) };
}

/**
 * Point an asset at an earlier version.
 *
 * Restoring is a pointer move, never a delete, so a user who restores v2 and
 * then changes their mind still has v3.
 */
export async function restoreVersion(
  assetId: string,
  version: number,
  organizationId: string,
): Promise<void> {
  const exists = await queryOne<{ version: number }>(
    "select version from public.asset_versions where asset_id = $1 and version = $2 and organization_id = $3",
    [assetId, version, organizationId],
  );
  if (!exists) throw new Error(`Asset ${assetId} has no version ${version}`);

  await queryOne("update public.assets set current_version = $2 where id = $1 returning id", [
    assetId,
    version,
  ]);
}

export async function currentVersion(assetId: string): Promise<AssetVersionRow | null> {
  return queryOne<AssetVersionRow>(
    `select v.* from public.asset_versions v
     join public.assets a on a.id = v.asset_id and a.current_version = v.version
     where v.asset_id = $1`,
    [assetId],
  );
}

export async function listVersions(assetId: string): Promise<AssetVersionRow[]> {
  const { query } = await import("@videoai/database");
  return query<AssetVersionRow>(
    "select * from public.asset_versions where asset_id = $1 order by version desc",
    [assetId],
  );
}

/** Record how one asset came from another, for provenance and repair history. */
export async function relate(
  organizationId: string,
  parentAssetId: string,
  childAssetId: string,
  relationship:
    | "derived_from"
    | "upscaled_from"
    | "repaired_from"
    | "reference_for"
    | "keyframe_of"
    | "alignment_of"
    | "thumbnail_of",
): Promise<void> {
  await queryOne(
    `insert into public.asset_relationships
       (organization_id, parent_asset_id, child_asset_id, relationship)
     values ($1, $2, $3, $4)
     on conflict (parent_asset_id, child_asset_id, relationship) do nothing
     returning id`,
    [organizationId, parentAssetId, childAssetId, relationship],
  );
}

function metadataParams(metadata: MediaMetadata | undefined): unknown[] {
  const m = metadata ?? {};
  return [
    m.width ?? null,
    m.height ?? null,
    m.frame_count ?? null,
    m.frame_rate_num ?? null,
    m.frame_rate_den ?? null,
    m.duration_samples ?? null,
    m.audio_sample_rate ?? null,
    m.audio_channels ?? null,
    m.video_codec ?? null,
    m.audio_codec ?? null,
    m.pixel_format ?? null,
  ];
}
