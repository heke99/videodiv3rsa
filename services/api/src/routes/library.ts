import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne } from "@videoai/database";
import { authenticate, notFound } from "../auth.js";

/**
 * The asset library (spec section 99): characters, products, locations and
 * voices, reusable across projects inside one tenant.
 */

const ENTITY_TABLES = {
  characters: "characters",
  products: "products",
  locations: "locations",
  voices: "voice_profiles",
} as const;

type EntityKind = keyof typeof ENTITY_TABLES;

export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/library/:kind", async (request) => {
    const caller = await authenticate(request);
    const { kind } = z
      .object({ kind: z.enum(["characters", "products", "locations", "voices"]) })
      .parse(request.params);
    const { project_id } = z.object({ project_id: z.string().uuid().optional() }).parse(request.query);

    const table = ENTITY_TABLES[kind];

    if (kind === "voices") {
      return {
        entries: await query(
          `select id, slug, speaker_profile, language, accent, style, voice_model, project_id
           from public.voice_profiles
           where organization_id = $1 and ($2::uuid is null or project_id = $2 or project_id is null)
           order by slug`,
          [caller.organization_id, project_id ?? null],
        ),
      };
    }

    return {
      entries: await query(
        `select e.id, e.slug, e.label, e.current_version, e.is_library_entity, e.project_id, e.updated_at
         from public.${table} e
         where e.organization_id = $1
           and ($2::uuid is null or e.project_id = $2 or e.is_library_entity)
         order by e.label`,
        [caller.organization_id, project_id ?? null],
      ),
    };
  });

  app.get("/api/library/:kind/:id", async (request) => {
    const caller = await authenticate(request);
    const { kind, id } = z
      .object({
        kind: z.enum(["characters", "products", "locations"]),
        id: z.string().uuid(),
      })
      .parse(request.params);

    const table = ENTITY_TABLES[kind as EntityKind];
    const entity = await queryOne(`select * from public.${table} where id = $1 and organization_id = $2`, [
      id,
      caller.organization_id,
    ]);
    if (!entity) {
      throw notFound();
    }

    const versions = await query(
      `select version, document, created_at from public.${table.replace(/s$/, "")}_versions
       where ${table.replace(/s$/, "")}_id = $1 order by version desc`,
      [id],
    );

    return { entity, versions };
  });

  /**
   * Promote a project entity into the shared library.
   *
   * A character created for one project is often wanted in the next, and the
   * alternative is recreating them, which produces a different person.
   */
  app.post("/api/library/:kind/:id/promote", async (request) => {
    const caller = await authenticate(request);
    const { kind, id } = z
      .object({ kind: z.enum(["characters", "products", "locations"]), id: z.string().uuid() })
      .parse(request.params);

    const table = ENTITY_TABLES[kind as EntityKind];
    const updated = await queryOne<{ id: string }>(
      `update public.${table} set is_library_entity = true
       where id = $1 and organization_id = $2 returning id`,
      [id, caller.organization_id],
    );
    if (!updated) {
      throw notFound();
    }
    return { promoted: true };
  });
}
