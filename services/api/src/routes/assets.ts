import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createAsset, currentVersion, listVersions, restoreVersion } from "@videoai/assets";
import { query, queryOne } from "@videoai/database";
import { storage } from "@videoai/storage";
import { authenticate, type Caller } from "../auth.js";
import { UploadRejected, checkSize, detectAndVerify, sanitizeLabel } from "../uploads.js";

/**
 * Uploads and media access.
 *
 * Uploads arrive as raw bytes with the declared type in a header. Content type
 * is decided by the bytes themselves, and the filename never becomes part of a
 * storage key.
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024 * 1024;

async function assertAssetOwned(assetId: string, caller: Caller): Promise<void> {
  const asset = await queryOne<{ organization_id: string }>(
    "select organization_id from public.assets where id = $1 and deleted_at is null",
    [assetId],
  );
  if (!asset || asset.organization_id !== caller.organization_id) {
    const error = new Error("Not found");
    (error as Error & { statusCode?: number }).statusCode = 404;
    throw error;
  }
}

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  // Media arrives as an octet stream rather than multipart: the browser sends
  // one file per request and the metadata travels in headers, which avoids
  // buffering a parsed multipart body on top of the bytes themselves.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: MAX_BODY_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.post("/api/assets", async (request, reply) => {
    const caller = await authenticate(request);
    const headers = z
      .object({
        "x-filename": z.string().max(512).default("upload"),
        "x-declared-mime": z.string().max(128).default(""),
        "x-role": z.enum(["image", "product", "video", "audio", "voice_reference"]),
        "x-project-id": z.string().uuid().optional(),
      })
      .parse(request.headers);

    const bytes = request.body as Buffer;
    if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
      throw new UploadRejected("Empty upload");
    }

    const detected = detectAndVerify(new Uint8Array(bytes), headers["x-declared-mime"]);
    const kind = headers["x-role"] === "product" ? "image" : headers["x-role"];
    checkSize(kind, bytes.byteLength);

    if (detected.kind !== (kind === "voice_reference" ? "audio" : kind)) {
      throw new UploadRejected(
        `This slot takes ${kind} but the file is ${detected.kind}.`,
      );
    }

    const created = await createAsset({
      organization_id: caller.organization_id,
      project_id: headers["x-project-id"] ?? null,
      kind: kind === "voice_reference" ? "voice_reference" : (kind as "image" | "video" | "audio"),
      role: headers["x-role"],
      label: sanitizeLabel(headers["x-filename"]),
      mime: detected.mime,
      extension: detected.extension,
      body: new Uint8Array(bytes),
      created_by: caller.user_id,
    });

    return reply.status(201).send(created);
  });

  app.get("/api/assets/:id", async (request) => {
    const caller = await authenticate(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await assertAssetOwned(id, caller);

    const version = await currentVersion(id);
    if (!version) {
      const error = new Error("Not found");
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    return {
      asset_id: id,
      version: version.version,
      mime: version.mime,
      width: version.width,
      height: version.height,
      // Signed and short-lived: the URL is not a permanent handle.
      url: await storage().signedUrl(version.storage_key, 900),
      versions: (await listVersions(id)).map((v) => ({
        version: v.version, sha256: v.sha256, created_at: (v as { created_at?: string }).created_at,
      })),
    };
  });

  app.post("/api/assets/:id/restore", async (request) => {
    const caller = await authenticate(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await assertAssetOwned(id, caller);
    const { version } = z.object({ version: z.number().int().positive() }).parse(request.body);

    await restoreVersion(id, version, caller.organization_id);
    return { restored_version: version };
  });

  /** Rights declarations, required before a face or voice may be used. */
  app.post("/api/assets/:id/rights", async (request, reply) => {
    const caller = await authenticate(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await assertAssetOwned(id, caller);

    const body = z
      .object({
        rights_type: z.enum(["face_likeness", "voice_clone", "copyrighted_product", "private_footage", "music"]),
        scope: z.string().min(1).max(2000),
      })
      .parse(request.body);

    const declaration = await queryOne<{ id: string }>(
      `insert into public.rights_declarations
         (organization_id, asset_id, rights_type, declared_by, scope)
       values ($1, $2, $3, $4, $5) returning id`,
      [caller.organization_id, id, body.rights_type, caller.user_id, body.scope],
    );

    return reply.status(201).send({ rights_declaration_id: declaration!.id });
  });

  app.get("/api/projects/:id/assets", async (request) => {
    const caller = await authenticate(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    return {
      assets: await query(
        `select a.id, a.kind, a.role, a.label, a.current_version, v.mime, v.width, v.height
         from public.assets a
         join public.asset_versions v on v.asset_id = a.id and v.version = a.current_version
         where a.project_id = $1 and a.organization_id = $2 and a.deleted_at is null
         order by a.created_at desc`,
        [id, caller.organization_id],
      ),
    };
  });
}
