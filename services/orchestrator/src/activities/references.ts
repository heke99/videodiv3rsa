import { ApplicationFailure } from "@temporalio/activity";
import type { Character, CharacterViewKind, Product, ProductViewKind, SceneBible } from "@videoai/contracts";
import { query, queryOne, transaction } from "@videoai/database";

import { jobContext } from "./delivery.js";
import { dispatch } from "./generate.js";
import { digest, guidanceFor, routeSupport } from "./support.js";

/**
 * The canonical reference views a character and a product are judged against
 * (spec sections 12, 13).
 *
 * These are the images every later shot has to match. Generating them once, up
 * front, is what makes identity lock and product fidelity checkable at all: the
 * identity judge compares a frame to the face master, and the product text
 * judge compares packaging to the text crop. Without them the judges have
 * nothing to compare to and the whole consistency story is an assertion.
 *
 * A generated view lands as `pending`. It becomes canonical only after QC,
 * which is what the `qc_status` column has always been for.
 */

/** The views every character needs before a shot can be locked to their identity. */
const CHARACTER_VIEWS: CharacterViewKind[] = [
  "face_master",
  "front",
  "three_quarter_left",
  "profile_left",
  "full_body",
];

/** The views the product, logo and pack-text judges compare against. */
const PRODUCT_VIEWS: ProductViewKind[] = ["front", "back", "packaging", "logo_crop", "text_crop"];

export async function generateReferences(input: {
  job_id: string;
  bible: SceneBible;
}): Promise<{ asset_ids: string[] }> {
  const ctx = await jobContext(input.job_id);

  // The Scene Bible's entities have to exist as rows before a reference can
  // point at one, and until now nothing ever wrote them: the document was
  // stored and the relational half of the schema stayed empty.
  const entities = await persistEntities(ctx.organization_id, ctx.project_id, input.bible);

  const missing = [
    ...pending(input.bible.characters, entities.characters, CHARACTER_VIEWS, (c, v) =>
      hasCharacterView(c, v),
    ),
    ...pending(input.bible.products, entities.products, PRODUCT_VIEWS, (p, v) => hasProductView(p, v)),
  ];

  const already = await existingViews(ctx.project_id);
  const wanted = missing.filter((m) => !already.has(`${m.row_id}:${m.view_kind}`));
  if (wanted.length === 0) return { asset_ids: [] };

  const decision = await routeSupport("image", ctx.quality_mode);
  const guidance = await guidanceFor("image", ctx.quality_mode, decision.skills, {
    has_humans: input.bible.characters.length > 0,
  });

  const assetIds: string[] = [];
  for (const view of wanted) {
    const output = await dispatch({
      job_id: input.job_id,
      organization_id: ctx.organization_id,
      project_id: ctx.project_id,
      attempt: 1,
      idempotency_key: `${input.job_id}:ref:${view.slug}:${view.view_kind}:${digest(view.prompt)}`,
      decision,
      request: {
        shot_id: null,
        model_id: decision.model_id,
        model_version: decision.model_version,
        precision: decision.precision,
        prompt: [view.prompt, guidance.instructions].filter((p) => p.trim()).join("\n\n"),
        negative_prompt: NEGATIVE,
        references: [],
        driving_audio: null,
        // Derived from the unit of work, so a re-run of the same view
        // reproduces the same image and a genuine regeneration does not.
        seed: seedFrom(`${view.slug}:${view.view_kind}:${view.prompt}`),
        duration_frames: 1,
        resolution: { width: 1024, height: 1024 },
        settings: { view_kind: view.view_kind },
      },
      asset: { kind: "image", role: `${view.entity}_reference`, mime: "image/png", extension: ".png" },
      provenance: { skill_versions: guidance.skill_versions },
    });

    await recordView(ctx.organization_id, view, output.asset_id);
    assetIds.push(output.asset_id);
  }

  return { asset_ids: assetIds };
}

const NEGATIVE = [
  "busy background",
  "multiple subjects",
  "cropped head",
  "motion blur",
  "text artefacts",
  "watermark",
].join(", ");

// -- what is missing --------------------------------------------------------

interface WantedView {
  entity: "character" | "product";
  slug: string;
  row_id: string;
  view_kind: string;
  prompt: string;
}

function pending<T extends { id: string; label: string; notes: string }, V extends string>(
  entities: T[],
  rows: Map<string, string>,
  views: V[],
  has: (entity: T, view: V) => boolean,
): WantedView[] {
  const wanted: WantedView[] = [];
  for (const entity of entities) {
    const rowId = rows.get(entity.id);
    if (!rowId) continue;
    for (const view of views) {
      // A view the Scene Bible already carries is a reference someone uploaded
      // or a previous run approved. Regenerating it would replace a canonical
      // image with a pending one.
      if (has(entity, view)) continue;
      wanted.push({
        entity: "appearance" in entity ? "character" : "product",
        slug: entity.id,
        row_id: rowId,
        view_kind: view,
        prompt: describe(entity, view),
      });
    }
  }
  return wanted;
}

function hasCharacterView(character: Character, view: CharacterViewKind): boolean {
  return Boolean(character.package.views[view]);
}

function hasProductView(product: Product, view: ProductViewKind): boolean {
  return Boolean(product.views[view]);
}

/**
 * What the image model is told to draw.
 *
 * The Scene Bible's own words, verbatim, plus the framing this view needs. The
 * wording has to be identical between the reference and the shots generated
 * from it, or the reference stops being the thing they are matching.
 */
function describe(entity: { label: string; notes: string } & Record<string, unknown>, view: string): string {
  const parts = [`Reference photograph: ${entity.label}`, entity.notes.trim(), FRAMING[view] ?? view];

  const appearance = entity["appearance"] as Character["appearance"] | undefined;
  if (appearance) {
    parts.push(
      [
        appearance.hair && `hair ${appearance.hair}`,
        appearance.eyes && `eyes ${appearance.eyes}`,
        appearance.skin && `skin ${appearance.skin}`,
        appearance.build && `build ${appearance.build}`,
        ...appearance.distinctive_features,
      ]
        .filter(Boolean)
        .join(", "),
    );
    const wardrobe = entity["wardrobe"] as Character["wardrobe"];
    parts.push([wardrobe.clothes, wardrobe.shoes, ...wardrobe.accessories].filter(Boolean).join(", "));
  }

  const physical = entity["physical"] as Product["physical"] | undefined;
  if (physical) {
    parts.push([physical.material, physical.shape, physical.colors.join(" and ")].filter(Boolean).join(", "));
    const branding = entity["branding"] as Product["branding"];
    if (branding.on_pack_text.length > 0) {
      // Quoted so the model renders the string rather than describing it; the
      // pack-text judge checks it survived.
      parts.push(`packaging reads ${branding.on_pack_text.map((t) => `"${t}"`).join(", ")}`);
    }
    if (branding.logo_description) parts.push(`logo: ${branding.logo_description}`);
  }

  parts.push("neutral studio background, even lighting, sharp focus, no motion blur");
  return parts.filter((p) => typeof p === "string" && p.trim()).join(". ");
}

/** How each view is framed. The judges depend on these being what they say. */
const FRAMING: Record<string, string> = {
  face_master: "tight head-and-shoulders portrait, facing camera, neutral expression",
  front: "front view, whole subject in frame",
  three_quarter_left: "three-quarter view turned to the left",
  three_quarter_right: "three-quarter view turned to the right",
  profile_left: "left profile, exact side view",
  profile_right: "right profile, exact side view",
  full_body: "full body, head to feet, standing",
  clothing: "wardrobe laid flat, every garment visible",
  expression: "head and shoulders, expressive",
  back: "rear view",
  left: "left side view",
  right: "right side view",
  top: "top-down view",
  packaging: "packaging front, upright, whole pack in frame",
  logo_crop: "close crop on the logo, filling the frame",
  text_crop: "close crop on the pack text, every character legible",
  material_reference: "macro close-up of the surface material",
  scale_reference: "the product beside a common object for scale",
};

/** Seeded from the view itself, so the same reference reproduces. */
function seedFrom(key: string): number {
  return Number.parseInt(digest(key).slice(0, 8), 16) & 0x7fffffff;
}

// -- persistence ------------------------------------------------------------

interface PersistedEntities {
  characters: Map<string, string>;
  products: Map<string, string>;
}

/**
 * Write the Scene Bible's entities into the relational half of the schema.
 *
 * The document is the source of truth and stays so; these rows exist because
 * dependency invalidation, the asset library and the reference tables all have
 * to reach an entity without unpacking a whole Scene Bible, which is what the
 * schema comment beside them has said since Batch 2. Nothing had ever written
 * them, so the library was empty and `voice_profiles` -- which the capability
 * snapshot offers the Director as the voices it may cast -- held nothing.
 *
 * Called when the Scene Bible is saved, and again from reference generation,
 * which needs the row ids. Safe to call twice: the entity rows upsert, and a
 * version row is written only when the document has actually changed, so a
 * re-run does not fill the history with identical versions.
 */
export async function persistEntities(
  organizationId: string,
  projectId: string,
  bible: SceneBible,
): Promise<PersistedEntities> {
  return transaction(async (client) => {
    const characters = new Map<string, string>();
    const products = new Map<string, string>();

    for (const voice of bible.voices) {
      await client.query(
        `insert into public.voice_profiles
           (organization_id, project_id, slug, speaker_profile, language, accent, style,
            voice_model, model_version, seed, speech_rate, reference_asset_ids)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (organization_id, project_id, slug) do update
           set speaker_profile = excluded.speaker_profile,
               language = excluded.language,
               accent = excluded.accent,
               style = excluded.style,
               voice_model = excluded.voice_model,
               model_version = excluded.model_version,
               seed = excluded.seed,
               speech_rate = excluded.speech_rate,
               updated_at = now()`,
        [
          organizationId,
          projectId,
          voice.id,
          voice.speaker_profile,
          voice.language,
          voice.accent,
          voice.style,
          voice.voice_model,
          voice.model_version,
          voice.seed,
          voice.speech_rate,
          voice.reference_asset_ids,
        ],
      );
    }

    for (const character of bible.characters) {
      const row = await client.query<{ id: string }>(
        `insert into public.characters (organization_id, project_id, slug, label)
         values ($1, $2, $3, $4)
         on conflict (organization_id, project_id, slug) do update
           set label = excluded.label, updated_at = now()
         returning id`,
        [organizationId, projectId, character.id, character.label],
      );
      const id = row.rows[0]!.id;
      characters.set(character.id, id);
      await client.query(
        `insert into public.character_versions (character_id, organization_id, version, document)
         select $1, $2, coalesce(max(version), 0) + 1, $3
         from public.character_versions where character_id = $1
         having coalesce(
           (select v.document from public.character_versions v
            where v.character_id = $1 order by v.version desc limit 1),
           'null'::jsonb
         ) is distinct from $3::jsonb`,
        [id, organizationId, character],
      );
    }

    for (const product of bible.products) {
      const row = await client.query<{ id: string }>(
        `insert into public.products (organization_id, project_id, slug, label)
         values ($1, $2, $3, $4)
         on conflict (organization_id, project_id, slug) do update
           set label = excluded.label, updated_at = now()
         returning id`,
        [organizationId, projectId, product.id, product.label],
      );
      const id = row.rows[0]!.id;
      products.set(product.id, id);
      await client.query(
        `insert into public.product_versions (product_id, organization_id, version, document)
         select $1, $2, coalesce(max(version), 0) + 1, $3
         from public.product_versions where product_id = $1
         having coalesce(
           (select v.document from public.product_versions v
            where v.product_id = $1 order by v.version desc limit 1),
           'null'::jsonb
         ) is distinct from $3::jsonb`,
        [id, organizationId, product],
      );
    }

    for (const location of bible.locations) {
      const row = await client.query<{ id: string }>(
        `insert into public.locations (organization_id, project_id, slug, label)
         values ($1, $2, $3, $4)
         on conflict (organization_id, project_id, slug) do update
           set label = excluded.label, updated_at = now()
         returning id`,
        [organizationId, projectId, location.id, location.label],
      );
      await client.query(
        `insert into public.location_versions (location_id, organization_id, version, document)
         select $1, $2, coalesce(max(version), 0) + 1, $3
         from public.location_versions where location_id = $1
         having coalesce(
           (select v.document from public.location_versions v
            where v.location_id = $1 order by v.version desc limit 1),
           'null'::jsonb
         ) is distinct from $3::jsonb`,
        [row.rows[0]!.id, organizationId, location],
      );
    }

    return { characters, products };
  });
}

/** Views already generated, so a re-run costs nothing for the ones that exist. */
async function existingViews(projectId: string): Promise<Set<string>> {
  const rows = await query<{ owner_id: string; view_kind: string }>(
    `select r.character_id as owner_id, r.view_kind
     from public.character_references r
     join public.characters c on c.id = r.character_id
     where c.project_id = $1 and r.qc_status <> 'rejected'
     union all
     select r.product_id as owner_id, r.view_kind
     from public.product_references r
     join public.products p on p.id = r.product_id
     where p.project_id = $1 and r.qc_status <> 'rejected'`,
    [projectId],
  );
  return new Set(rows.map((r) => `${r.owner_id}:${r.view_kind}`));
}

async function recordView(organizationId: string, view: WantedView, assetId: string): Promise<void> {
  const table = view.entity === "character" ? "character_references" : "product_references";
  const column = view.entity === "character" ? "character_id" : "product_id";

  const row = await queryOne<{ id: string }>(
    `insert into public.${table} (${column}, organization_id, view_kind, asset_id, qc_status)
     values ($1, $2, $3, $4, 'pending')
     on conflict (${column}, view_kind, asset_id) do update set qc_status = 'pending'
     returning id`,
    [view.row_id, organizationId, view.view_kind, assetId],
  );
  if (!row) {
    throw ApplicationFailure.nonRetryable(
      `Could not record the ${view.view_kind} reference for ${view.slug}`,
    );
  }
}
