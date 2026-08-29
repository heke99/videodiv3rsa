import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { queryOne } from "@videoai/database";
import { storage } from "@videoai/storage";

/**
 * Moving bytes between storage and the local disk that ffmpeg needs.
 *
 * The compositor and technical QC work on files, and assets live in whatever
 * storage backend is configured. This is the one place that bridges the two,
 * so no activity has to know which backend it is talking to or clean up after
 * itself twice.
 */

export interface Materialised {
  /** Local paths, keyed by asset id. */
  paths: Record<string, string>;
  directory: string;
  cleanup(): Promise<void>;
}

interface VersionRow {
  storage_key: string;
  mime: string;
}

/** Download the current version of each asset into a scratch directory. */
export async function materialise(assetIds: string[]): Promise<Materialised> {
  const directory = await mkdtemp(path.join(tmpdir(), "videoai-render-"));
  const paths: Record<string, string> = {};
  const store = storage();

  for (const assetId of new Set(assetIds)) {
    const version = await queryOne<VersionRow>(
      `select v.storage_key, v.mime
       from public.asset_versions v
       join public.assets a on a.id = v.asset_id and a.current_version = v.version
       where v.asset_id = $1`,
      [assetId],
    );
    if (!version) {
      throw new Error(`Asset ${assetId} has no current version to render from`);
    }

    // The extension matters: ffmpeg picks a demuxer from it when the container
    // is ambiguous, and guessing wrong turns a valid file into a decode error.
    const extension = path.extname(version.storage_key) || extensionFor(version.mime);
    const local = path.join(directory, `${assetId}${extension}`);
    await writeFile(local, await store.get(version.storage_key));
    paths[assetId] = local;
  }

  return {
    paths,
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

/** A scratch directory for output, cleaned up by the caller. */
export async function scratch(): Promise<{ directory: string; cleanup(): Promise<void> }> {
  const directory = await mkdtemp(path.join(tmpdir(), "videoai-out-"));
  await mkdir(directory, { recursive: true });
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

export async function readLocal(file: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(file));
}

function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/aac": ".m4a",
    "audio/flac": ".flac",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
  };
  return map[mime] ?? ".bin";
}
