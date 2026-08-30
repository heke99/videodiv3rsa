import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * What the pipeline writes, read back the way the product reads it.
 *
 * The editor's version history, its quality badge and its restore button all
 * read columns -- `shot_versions.asset_id`, `shot_versions.quality_evaluation_id`,
 * `shots.current_asset_id`, `shots.status` -- that nothing in the generation
 * path ever wrote. Every generated shot would have appeared as `planned` with
 * an empty history, and no test noticed, because the tests that cover this code
 * do not touch a database and the ones that touch a database do not run it.
 *
 * So this seeds a project the way the pipeline would leave one, runs the real
 * activity, and then asks the same questions the API asks.
 *
 * Skipped when DATABASE_URL is unset, as the schema and RLS suites are.
 */

const DATABASE_URL = process.env["DATABASE_URL"];

const ENV: Record<string, string> = {
  PUBLIC_APP_URL: "https://example.test",
  APP_NAME: "test",
  APP_DOMAIN: "example.test",
  AUTH_CALLBACK_URL: "https://example.test/auth/callback",
  STORAGE_PROVIDER: "local",
  STORAGE_BUCKET: "test",
  STORAGE_LOCAL_ROOT: "/tmp/videoai-persistence-test",
  GPU_PROVIDER: "manual",
  GPU_GATEWAY_SIGNING_KEY: "0".repeat(64),
  MODEL_ROOT: "/tmp/videoai-models",
  SKILLS_ROOT: "skills",
  TEMPORAL_ADDRESS: "127.0.0.1:7233",
  DIRECTOR_MODEL: "local/director",
  DIRECTOR_ENDPOINT: "http://127.0.0.1:1/v1",
  QC_MODEL: "local/qc",
};
for (const [key, value] of Object.entries(ENV)) process.env[key] ??= value;

const ids = {
  user: randomUUID(),
  org: randomUUID(),
  project: randomUUID(),
  job: randomUUID(),
  scene: randomUUID(),
  shot: randomUUID(),
  assetA: randomUUID(),
  assetB: randomUUID(),
  evaluationA: randomUUID(),
  evaluationB: randomUUID(),
};

let client: Client;

describe.skipIf(!DATABASE_URL)("what the editor reads back", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    // A project mid-production: planned shot, two takes generated, each with
    // its own evaluation. Written directly so the test is about what
    // recordShotTake does, not about how it got here.
    await client.query("begin");
    await client.query("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
      ids.user,
      `${ids.user}@test.invalid`,
    ]);
    await client.query(
      "insert into public.organizations (id, name, slug, created_by) values ($1, 'T', $2, $3)",
      [ids.org, `t-${ids.org.slice(0, 8)}`, ids.user],
    );
    await client.query(
      `insert into public.projects (id, organization_id, title, aspect_ratio, quality_mode,
                                    frame_rate_num, frame_rate_den, audio_sample_rate)
       values ($1, $2, 'T', '9:16', 'UGC', 24, 1, 48000)`,
      [ids.project, ids.org],
    );
    await client.query(
      `insert into public.generation_jobs (id, organization_id, project_id, quality_mode)
       values ($1, $2, $3, 'UGC')`,
      [ids.job, ids.org, ids.project],
    );
    await client.query(
      `insert into public.scenes (id, project_id, organization_id, slug, index, summary)
       values ($1, $2, $3, 'scene_01', 0, 's')`,
      [ids.scene, ids.project, ids.org],
    );
    await client.query(
      `insert into public.shots (id, project_id, scene_id, organization_id, slug, index,
                                 duration_frames, shot_type, preferred_generation_kind)
       values ($1, $2, $3, $4, 'shot_01', 0, 48, 'medium', 'text_to_video')`,
      [ids.shot, ids.project, ids.scene, ids.org],
    );

    for (const [asset, evaluation, overall, passed] of [
      [ids.assetA, ids.evaluationA, 0.55, false],
      [ids.assetB, ids.evaluationB, 0.91, true],
    ] as const) {
      await client.query(
        "insert into public.assets (id, organization_id, project_id, kind) values ($1, $2, $3, 'video')",
        [asset, ids.org, ids.project],
      );
      await client.query(
        `insert into public.quality_evaluations
           (id, organization_id, project_id, job_id, subject_kind, subject_id, asset_id,
            quality_profile, overall, passed, coverage)
         values ($1, $2, $3, $4, 'shot', 'shot_01', $5, 'UGC', $6, $7, 0.375)`,
        [evaluation, ids.org, ids.project, ids.job, asset, overall, passed],
      );
    }
    await client.query("commit");
  });

  afterAll(async () => {
    if (!client) return;
    await client.query("delete from public.organizations where id = $1", [ids.org]).catch(() => {});
    await client.query("delete from auth.users where id = $1", [ids.user]).catch(() => {});
    await client.end();
  });

  it("records a take that the version history can show", async () => {
    const { recordShotTake } = await import("../../services/orchestrator/src/activities/delivery.js");

    const first = await recordShotTake({
      job_id: ids.job,
      shot_id: "shot_01",
      asset_id: ids.assetA,
      evaluation_id: ids.evaluationA,
      passed: false,
    });
    expect(first.version).toBe(1);

    const second = await recordShotTake({
      job_id: ids.job,
      shot_id: "shot_01",
      asset_id: ids.assetB,
      evaluation_id: ids.evaluationB,
      passed: true,
    });
    expect(second.version).toBe(2);

    // The API's own query for the version list, verbatim in shape: this is the
    // thing that returned rows with null asset and null quality before.
    const versions = await client.query<{
      version: number;
      asset_id: string | null;
      quality_evaluation_id: string | null;
      overall: string | null;
      passed: boolean | null;
    }>(
      `select v.version, v.asset_id, v.quality_evaluation_id, e.overall, e.passed
       from public.shot_versions v
       left join public.quality_evaluations e on e.id = v.quality_evaluation_id
       where v.shot_id = $1 order by v.version desc`,
      [ids.shot],
    );

    expect(versions.rows).toHaveLength(2);
    for (const row of versions.rows) {
      expect(row.asset_id).not.toBeNull();
      expect(row.quality_evaluation_id).not.toBeNull();
      expect(row.overall).not.toBeNull();
    }
    expect(versions.rows[0]!.version).toBe(2);
    expect(Number(versions.rows[0]!.overall)).toBeCloseTo(0.91, 2);
  });

  it("moves the shot's own pointer to the take that passed", async () => {
    const shot = await client.query<{
      current_version: number;
      current_asset_id: string | null;
      status: string;
      stale: boolean;
    }>("select current_version, current_asset_id, status, stale from public.shots where id = $1", [ids.shot]);

    const row = shot.rows[0]!;
    expect(row.current_version).toBe(2);
    expect(row.current_asset_id).toBe(ids.assetB);
    expect(row.status).toBe("approved");
    expect(row.stale).toBe(false);
  });

  it("keeps coverage with the evaluation, so a pass cannot overstate itself", async () => {
    const row = await client.query<{ coverage: string | null; passed: boolean }>(
      "select coverage, passed from public.quality_evaluations where id = $1",
      [ids.evaluationB],
    );
    // Passed, but on well under half the profile's gating dimensions. Both
    // facts have to survive to the screen or the badge is a lie.
    expect(row.rows[0]!.passed).toBe(true);
    expect(Number(row.rows[0]!.coverage)).toBeLessThan(0.5);
  });
});
