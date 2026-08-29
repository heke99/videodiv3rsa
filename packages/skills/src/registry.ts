import { query, queryOne, transaction } from "@videoai/database";
import { discoverSkillPackages, loadSkillPackage, type SkillPackage } from "./package.js";

/**
 * Registry sync (spec section 22).
 *
 * The filesystem holds the skills; the database holds what the router and the
 * admin UI read. Syncing on a package hash is what keeps them from drifting:
 * an edited skill whose version was not bumped is reported rather than
 * silently taking effect, because a change nobody versioned is a change nobody
 * can roll back.
 */

export interface SyncResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Edited without a version bump. These are refused, not applied. */
  drifted: Array<{ skill_id: string; version: string; stored_hash: string; actual_hash: string }>;
  /** In the database but no longer on disk. */
  orphaned: string[];
}

export async function loadCatalogue(root: string): Promise<Map<string, SkillPackage>> {
  const directories = await discoverSkillPackages(root);
  const catalogue = new Map<string, SkillPackage>();

  for (const directory of directories) {
    const skill = await loadSkillPackage(directory);
    const existing = catalogue.get(skill.skill_id);
    if (existing) {
      throw new Error(
        `Two skill packages claim the id "${skill.skill_id}": ` +
          `${existing.directory} and ${skill.directory}`,
      );
    }
    catalogue.set(skill.skill_id, skill);
  }

  return catalogue;
}

export async function syncRegistry(
  catalogue: Map<string, SkillPackage>,
  options: { allowDrift?: boolean } = {},
): Promise<SyncResult> {
  const result: SyncResult = { created: [], updated: [], unchanged: [], drifted: [], orphaned: [] };

  const stored = new Map(
    (
      await query<{ skill_id: string; version: string; package_hash: string | null }>(
        `select sv.skill_id, sv.version, sv.package_hash
         from public.skill_versions sv
         join public.skill_registry sr on sr.skill_id = sv.skill_id
         where sr.current_version = sv.version`,
      )
    ).map((r) => [r.skill_id, r]),
  );

  for (const skill of catalogue.values()) {
    const previous = stored.get(skill.skill_id);
    const version = skill.descriptor.version;

    if (previous && previous.version === version) {
      if (previous.package_hash === skill.package_hash) {
        result.unchanged.push(skill.skill_id);
        continue;
      }
      result.drifted.push({
        skill_id: skill.skill_id,
        version,
        stored_hash: previous.package_hash ?? "(none)",
        actual_hash: skill.package_hash,
      });
      if (!options.allowDrift) continue;
    }

    await upsert(skill);
    (previous ? result.updated : result.created).push(skill.skill_id);
  }

  for (const skillId of stored.keys()) {
    if (!catalogue.has(skillId)) result.orphaned.push(skillId);
  }

  return result;
}

async function upsert(skill: SkillPackage): Promise<void> {
  const d = skill.descriptor;
  await transaction(async (client) => {
    await client.query(
      `insert into public.skill_registry (skill_id, name, category, description, status, current_version)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (skill_id) do update
         set name = excluded.name,
             category = excluded.category,
             description = excluded.description,
             status = excluded.status,
             current_version = excluded.current_version`,
      [d.skill_id, d.name, d.category, d.description, d.status, d.version],
    );

    await client.query(
      `insert into public.skill_versions
         (skill_id, version, input_schema, output_schema, required_tools, supported_models,
          requires_skills, quality_profile, timeout_seconds, max_retries, license, package_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (skill_id, version) do update
         set input_schema = excluded.input_schema,
             output_schema = excluded.output_schema,
             required_tools = excluded.required_tools,
             supported_models = excluded.supported_models,
             requires_skills = excluded.requires_skills,
             quality_profile = excluded.quality_profile,
             timeout_seconds = excluded.timeout_seconds,
             max_retries = excluded.max_retries,
             license = excluded.license,
             package_hash = excluded.package_hash`,
      [
        d.skill_id, d.version, skill.input_schema, skill.output_schema,
        d.required_tools, d.supported_models, d.requires_skills,
        d.quality_profile, d.timeout_seconds, d.max_retries, d.license, skill.package_hash,
      ],
    );
  });
}

/** Active skill ids, for the Director's capability snapshot. */
export async function activeSkillIds(): Promise<string[]> {
  const rows = await query<{ skill_id: string }>(
    "select skill_id from public.skill_registry where status = 'active' order by skill_id",
  );
  return rows.map((r) => r.skill_id);
}

export async function recordSkillRun(input: {
  organization_id: string | null;
  job_id: string | null;
  skill_id: string;
  skill_version: string;
  status: "pass" | "fail" | "error" | "skipped";
  confidence?: number | null;
  latency_ms?: number | null;
  result?: unknown;
}): Promise<void> {
  await queryOne(
    `insert into public.skill_runs
       (organization_id, job_id, skill_id, skill_version, status, confidence, latency_ms, result)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      input.organization_id, input.job_id, input.skill_id, input.skill_version,
      input.status, input.confidence ?? null, input.latency_ms ?? null, input.result ?? {},
    ],
  );
}
