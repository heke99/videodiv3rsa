import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A whole job, in the order the production workflow runs it.
 *
 * This is the claim that has never been true. Every stage below has had its own
 * test for several batches -- dispatch, timeline assembly, the compositor,
 * export -- and none of them had ever run one after another, because
 * `generateDialogue` threw on the line immediately after routing and killed
 * every run before shot generation was even reached.
 *
 * So this drives the activities in the workflow's own order against a stub
 * worker that returns real media, and asserts what only the whole chain can
 * show: that the speech on the timeline is the length that was measured from
 * the file rather than the length the planner guessed.
 *
 * The stub is not a GPU and does not pretend to be. It answers each runtime
 * with a file ffmpeg made, through the real signing path -- it verifies every
 * envelope and refuses an unsigned one -- so what is left unproven is a model
 * producing frames, which is the honest boundary.
 */

const DATABASE_URL = process.env["DATABASE_URL"];
const SIGNING_KEY = "e".repeat(64);
const STORAGE_ROOT = `/tmp/videoai-production-${randomUUID().slice(0, 8)}`;

const ENV: Record<string, string> = {
  PUBLIC_APP_URL: "https://example.test",
  APP_NAME: "test",
  APP_DOMAIN: "example.test",
  AUTH_CALLBACK_URL: "https://example.test/auth/callback",
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
  STORAGE_PROVIDER: "local",
  STORAGE_BUCKET: "test",
  STORAGE_LOCAL_ROOT: STORAGE_ROOT,
  GPU_PROVIDER: "manual",
  GPU_GATEWAY_SIGNING_KEY: SIGNING_KEY,
  GPU_WORKER_TOKEN: "1".repeat(64),
  MODEL_ROOT: "/tmp/videoai-models",
  SKILLS_ROOT: "skills",
  TEMPORAL_ADDRESS: "127.0.0.1:7233",
  DIRECTOR_MODEL: "local/director",
  DIRECTOR_ENDPOINT: "http://127.0.0.1:1/v1",
  QC_MODEL: "local/qc",
};
for (const [key, value] of Object.entries(ENV)) process.env[key] ??= value;

const FPS = 24;
const SAMPLE_RATE = 48_000;

/**
 * The planned length of the shot, and the real length of the speech in it.
 *
 * Deliberately different: the whole point of measuring is that the plan is a
 * guess. Two seconds of picture, three seconds of speech, so the timeline has
 * to grow the shot rather than clip the line.
 */
const PLANNED_SHOT_FRAMES = 48;
const SPEECH_SECONDS = 3;

const ids = {
  user: randomUUID(),
  org: randomUUID(),
  project: randomUUID(),
  job: randomUUID(),
  scene: randomUUID(),
  shot: randomUUID(),
};
const workerId = `production-worker-${randomUUID().slice(0, 8)}`;

/**
 * Models and rules this test owns, rather than the ones the registry ships.
 *
 * The shipped registry is global: one row per model, deliberately
 * `pending_review` so nothing routes until a human approves it. Promoting those
 * rows here would change what every other test sees while it runs, and would
 * leave the licence gate open behind us. So the fleet this job routes across is
 * this test's own, torn down with it -- and the shipped rules are checked
 * separately, by reading them.
 */
const suffix = randomUUID().slice(0, 8);
const MODELS = {
  video: `t-video-${suffix}`,
  tts: `t-tts-${suffix}`,
  align: `t-align-${suffix}`,
  ambience: `t-ambience-${suffix}`,
  image: `t-image-${suffix}`,
} as const;

const FAMILIES: Array<{ model: string; kind: string; rule: string }> = [
  { model: MODELS.video, kind: "text_to_video", rule: "text_to_video" },
  { model: MODELS.tts, kind: "text_to_speech", rule: "text_to_speech" },
  { model: MODELS.align, kind: "alignment", rule: "alignment" },
  { model: MODELS.ambience, kind: "video_to_audio", rule: "video_to_audio" },
  { model: MODELS.image, kind: "image", rule: "image" },
];

const script = {
  schema_version: "1.0",
  title: "One line, one shot",
  logline: "",
  narration: [],
  dialogue: [
    {
      id: "line_01",
      character_id: "char_ada",
      voice_id: "voice_ada",
      text: "This is the only line in the film.",
      emotion: "neutral",
      pause_before_ms: 0,
      pause_after_ms: 0,
      pronunciation_hints: {},
    },
  ],
  on_screen_text: [],
} as never;

const bible = {
  schema_version: "1.0",
  characters: [
    {
      id: "char_ada",
      label: "Ada",
      notes: "a woman in her thirties, calm",
      reference_assets: [],
      appearance: {
        hair: "dark, shoulder length",
        eyes: "brown",
        skin: "olive",
        build: "slim",
        height: "170cm",
        distinctive_features: ["a small scar above the left eyebrow"],
      },
      wardrobe: { clothes: "grey linen shirt", shoes: "white trainers", accessories: [] },
      voice_id: "voice_ada",
      package: { views: {}, voice_reference_asset_id: null },
      forbidden_changes: ["hair colour", "the scar"],
    },
  ],
  products: [],
  locations: [],
  voices: [
    {
      id: "voice_ada",
      speaker_profile: "warm mid-range female",
      language: "en",
      accent: "southern English",
      style: "conversational",
      reference_asset_ids: [],
      voice_model: "qwen3-tts",
      model_version: "3.0.0",
      seed: 4242,
      speech_rate: 1,
    },
  ],
  style: { camera_style: "handheld", lighting: "window light", realism_profile: "documentary" },
} as never;

const shot = {
  id: "shot_01",
  scene_id: "scene_01",
  index: 0,
  description: "Ada at the window",
  action: "she says her line",
  shot_type: "medium",
  duration_frames: PLANNED_SHOT_FRAMES,
  camera: { framing: "medium", lens: "35mm", movement: "static", height: "eye_level", focus_behavior: "" },
  character_ids: ["char_ada"],
  product_ids: [],
  location_id: null,
  dialogue_line_ids: ["line_01"],
  motion_complexity: 0.5,
  continuity_requirement: 0.5,
  requires_identity_lock: false,
  requires_product_fidelity: false,
  preferred_generation_kind: "text_to_video",
  start_frame_asset: null,
  end_frame_asset: null,
  notes: "",
} as never;

const plan = {
  schema_version: "1.0",
  scenes: [{ id: "scene_01", index: 0, summary: "the only scene", location_id: null, shot_ids: ["shot_01"] }],
  shots: [shot],
  dependencies: [],
} as never;

/** Which model each rule routes to, and what the stub should hand back for it. */
type Produced = { key: string; mime: string };

let worker: FastifyInstance;
let client: Client;
const served: string[] = [];
let unsignedRefusals = 0;

describe.skipIf(!DATABASE_URL)("a whole job, stage by stage", () => {
  const produced: Record<string, Produced> = {};

  beforeAll(async () => {
    mkdirSync(`${STORAGE_ROOT}/workers/${workerId}`, { recursive: true });

    const { ffmpeg } = await import("../../services/render/src/index.js");
    const dir = `${STORAGE_ROOT}/workers/${workerId}`;

    // A picture of the planned length, speech that is longer than it, an
    // ambience bed, a reference still and an alignment document.
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=640x360:r=${FPS}:d=${PLANNED_SHOT_FRAMES / FPS}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      path.join(dir, "shot.mp4"),
    ]);
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=220:sample_rate=${SAMPLE_RATE}:duration=${SPEECH_SECONDS}`,
      "-af",
      "volume=0.2",
      "-c:a",
      "pcm_s16le",
      path.join(dir, "speech.wav"),
    ]);
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `anoisesrc=sample_rate=${SAMPLE_RATE}:duration=${PLANNED_SHOT_FRAMES / FPS}:amplitude=0.05`,
      "-c:a",
      "pcm_s16le",
      path.join(dir, "ambience.wav"),
    ]);
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=gray:s=512x512:d=1",
      "-frames:v",
      "1",
      path.join(dir, "reference.png"),
    ]);

    // Word timings across the measured speech, which is what the captions and
    // the lipsync repair are built from.
    const words = "This is the only line in the film".split(" ");
    const per = Math.floor((SPEECH_SECONDS * SAMPLE_RATE) / words.length);
    await writeFile(
      path.join(dir, "alignment.json"),
      JSON.stringify({
        words: words.map((word, index) => ({
          word,
          start_sample: index * per,
          end_sample: (index + 1) * per,
          confidence: 0.9,
        })),
        phonemes: [],
      }),
    );

    produced[MODELS.video] = { key: `workers/${workerId}/shot.mp4`, mime: "video/mp4" };
    produced[MODELS.tts] = { key: `workers/${workerId}/speech.wav`, mime: "audio/wav" };
    produced[MODELS.ambience] = { key: `workers/${workerId}/ambience.wav`, mime: "audio/wav" };
    produced[MODELS.image] = { key: `workers/${workerId}/reference.png`, mime: "image/png" };
    produced[MODELS.align] = { key: `workers/${workerId}/alignment.json`, mime: "application/json" };

    const { verifyEnvelope } = await import("../../services/gpu-manager/src/gateway.js");

    worker = Fastify();
    worker.post("/generate", async (request, reply) => {
      const body = JSON.stringify(request.body);
      const raw = request.headers["x-videoai-envelope"];
      const check = verifyEnvelope(
        SIGNING_KEY,
        JSON.parse(String(raw)) as never,
        createHash("sha256").update(body).digest("hex"),
        () => false,
      );
      if (!check.valid) {
        unsignedRefusals += 1;
        return reply.status(401).send({ error: check.reason });
      }

      const model = (request.body as { model_id: string }).model_id;
      const output = produced[model];
      if (!output) return reply.status(400).send({ error: `stub has nothing for ${model}` });
      served.push(model);

      const bytes = await readFile(path.join(STORAGE_ROOT, output.key));
      return {
        storage_key: output.key,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        runtime_ms: 1000,
        peak_vram_bytes: 8_000_000_000,
        model_version: (request.body as { model_version: string }).model_version,
        seed: (request.body as { seed: number }).seed,
        metadata: {},
      };
    });
    await worker.listen({ port: 0, host: "127.0.0.1" });

    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await seed();
  });

  afterAll(async () => {
    await client?.query("delete from public.routing_rules where id like $1", [`test-%-${suffix}`]);
    // model_licenses, model_versions and model_capabilities cascade from here.
    await client?.query("delete from public.model_registry where model_id = any($1)", [
      Object.values(MODELS),
    ]);
    await client?.query("delete from public.gpu_workers where worker_id = $1", [workerId]);
    await client?.query("delete from public.organizations where id = $1", [ids.org]);
    await client?.query("delete from auth.users where id = $1", [ids.user]);
    await client?.end();
    await worker?.close();
  });

  it("runs dialogue, alignment, references, shots, ambience, timeline and export in order", async () => {
    const { createActivities } =
      await import("../../services/orchestrator/src/activities/implementations.js");
    const activities = createActivities();

    // -- speech, and its measured length ------------------------------------
    const dialogue = await activities.generateDialogue({ job_id: ids.job, script, bible });
    expect(dialogue).toHaveLength(1);
    expect(dialogue[0]!.length_samples).toBe(SPEECH_SECONDS * SAMPLE_RATE);

    // -- alignment ----------------------------------------------------------
    const aligned = await activities.alignDialogue({ job_id: ids.job, dialogue });
    expect(aligned).toHaveLength(1);

    const alignment = await client.query<{ words: unknown[]; asset_id: string }>(
      "select words, asset_id from public.dialogue_alignments where project_id = $1",
      [ids.project],
    );
    expect(alignment.rows).toHaveLength(1);
    expect(alignment.rows[0]!.words.length).toBeGreaterThan(0);
    // The timings describe the audio, not the document they arrived in.
    expect(alignment.rows[0]!.asset_id).toBe(dialogue[0]!.asset_id);

    // And the edge that says what they were measured from, which nothing has
    // ever written before.
    const edge = await client.query(
      `select 1 from public.asset_relationships
       where parent_asset_id = $1 and relationship = 'alignment_of'`,
      [dialogue[0]!.asset_id],
    );
    expect(edge.rows).toHaveLength(1);

    // -- reference views ----------------------------------------------------
    const references = await activities.generateReferences({ job_id: ids.job, bible });
    expect(references.asset_ids.length).toBeGreaterThan(0);

    const views = await client.query<{ view_kind: string; qc_status: string }>(
      `select r.view_kind, r.qc_status
       from public.character_references r
       join public.characters c on c.id = r.character_id
       where c.project_id = $1`,
      [ids.project],
    );
    expect(views.rows.map((r) => r.view_kind)).toContain("face_master");
    // Generated views are canonical only after QC.
    expect(views.rows.every((r) => r.qc_status === "pending")).toBe(true);

    // A second call generates nothing: the views already exist.
    const again = await activities.generateReferences({ job_id: ids.job, bible });
    expect(again.asset_ids).toEqual([]);

    // -- the shot -----------------------------------------------------------
    const routes = await activities.routeShots({ job_id: ids.job, plan, quality_mode: "STANDARD" });
    const decision = routes[0]!.decision;
    const generated = await activities.generateShot({
      job_id: ids.job,
      organization_id: ids.org,
      project_id: ids.project,
      shot,
      decision,
      attempt: 1,
      idempotency_key: `${ids.job}:shot_01:1`,
    });

    // -- ambience -----------------------------------------------------------
    const ambience = await activities.generateAmbience({
      job_id: ids.job,
      shots: [{ shot_id: "shot_01", asset_id: generated.asset_id }],
    });
    expect(ambience.asset_ids).toHaveLength(1);

    // -- the timeline, which is where the two clocks meet -------------------
    const { timeline_id } = await activities.buildTimeline({
      job_id: ids.job,
      plan,
      shot_assets: { shot_01: generated.asset_id },
    });

    const stored = await client.query<{
      document: { duration_frames: number; events: Array<Record<string, unknown>> };
    }>(
      `select v.document from public.timeline_versions v
       join public.timelines t on t.id = v.timeline_id and t.current_version = v.version
       where t.id = $1`,
      [timeline_id],
    );
    const document = stored.rows[0]!.document;

    // The claim the whole chain exists to support: three seconds of speech in
    // a two second shot grows the shot, rather than the line being clipped.
    expect(document.duration_frames).toBe(SPEECH_SECONDS * FPS);
    expect(document.duration_frames).toBeGreaterThan(PLANNED_SHOT_FRAMES);

    const kinds = document.events.map((e) => String(e["track_id"]));
    expect(kinds).toContain("dialogue");
    // The ambience bed reaches the timeline. Generating it into an asset
    // nothing used would be the exact mistake this pass is correcting.
    expect(kinds).toContain("ambience");
    expect(kinds).toContain("captions");

    // -- composition and export ---------------------------------------------
    const render = await activities.composeFinal({ job_id: ids.job, timeline_id });
    const exported = await activities.exportRenders({
      job_id: ids.job,
      render_asset_id: render.asset_id,
    });
    expect(exported.export_ids.length).toBeGreaterThan(0);

    const { materialise } = await import("../../services/orchestrator/src/activities/media.js");
    const { probe } = await import("../../services/render/src/index.js");
    const media = await materialise([render.asset_id]);
    try {
      const measured = await probe(media.paths[render.asset_id]!);
      expect(measured.container_ok).toBe(true);
      expect(measured.frame_count).toBe(document.duration_frames);
      expect(measured.audio_sample_rate).toBe(SAMPLE_RATE);
    } finally {
      await media.cleanup();
    }

    // Every family the job needed was actually asked for, through the real
    // signing path, and nothing arrived unsigned.
    expect(new Set(served)).toEqual(new Set(Object.values(MODELS)));
    expect(unsignedRefusals).toBe(0);
  }, 120_000);

  it("skips a stage that has no work rather than failing on it", async () => {
    const { createActivities } =
      await import("../../services/orchestrator/src/activities/implementations.js");
    const activities = createActivities();

    // Skipping and failing must not be the same code path. A film with no
    // spoken lines needs no TTS model to exist, and says so by doing nothing
    // rather than by reporting that nothing could be routed.
    const silent = { ...(script as unknown as Record<string, unknown>), dialogue: [], narration: [] };
    await expect(
      activities.generateDialogue({ job_id: ids.job, script: silent as never, bible }),
    ).resolves.toEqual([]);
    await expect(activities.alignDialogue({ job_id: ids.job, dialogue: [] })).resolves.toEqual([]);
    await expect(activities.generateAmbience({ job_id: ids.job, shots: [] })).resolves.toEqual({
      asset_ids: [],
    });
  });

  it("ships a rule for every family a production needs", async () => {
    // Read-only, on the rules the migration seeded. Until 0015 the registry had
    // carried capability rows for speech, alignment and ambience since the
    // first seed with no rule ever pointing at them, so the router could
    // describe those models and never choose one.
    const rules = await client.query<{ id: string; match: { generation_kind?: string[] } }>(
      "select id, match from public.routing_rules where id like 'default-%'",
    );
    const kinds = new Set(rules.rows.flatMap((r) => r.match.generation_kind ?? []));
    for (const kind of ["text_to_speech", "alignment", "video_to_audio", "lipsync", "image"]) {
      expect(kinds, `no shipped rule routes ${kind}`).toContain(kind);
    }
  });

  it("fails, saying what is missing, when there is work and no model for it", async () => {
    await client.query("update public.routing_rules set enabled = false where id like $1", [
      `test-text_to_speech-${suffix}`,
    ]);
    await client.query("update public.routing_rules set enabled = false where id = 'default-tts'");
    try {
      const { createActivities } =
        await import("../../services/orchestrator/src/activities/implementations.js");
      // There is a line to speak and nothing that can speak it. That is an
      // error, not a stage to skip over, and the message has to name the kind.
      await expect(createActivities().generateDialogue({ job_id: ids.job, script, bible })).rejects.toThrow(
        /text_to_speech/,
      );
    } finally {
      await client.query("update public.routing_rules set enabled = true where id like $1", [
        `test-text_to_speech-${suffix}`,
      ]);
      await client.query("update public.routing_rules set enabled = true where id = 'default-tts'");
    }
  });
});

/**
 * A project, a job, a shot and a fleet that can serve every family.
 *
 * The registry ships every model as a candidate with an unreviewed licence,
 * which is the fail-closed default. Promoting them here is the human review
 * the licence gate is waiting for, done explicitly rather than by relaxing the
 * gate.
 */
async function seed(): Promise<void> {
  const port = (worker.server.address() as { port: number }).port;

  await client.query("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    ids.user,
    `${ids.user}@test.invalid`,
  ]);
  await client.query(
    "insert into public.organizations (id, name, slug, created_by) values ($1, 'P', $2, $3)",
    [ids.org, `p-${ids.org.slice(0, 8)}`, ids.user],
  );
  await client.query(
    `insert into public.projects (id, organization_id, title, aspect_ratio, quality_mode,
                                  frame_rate_num, frame_rate_den, audio_sample_rate)
     values ($1, $2, 'P', '9:16', 'STANDARD', $3, 1, $4)`,
    [ids.project, ids.org, FPS, SAMPLE_RATE],
  );
  await client.query(
    `insert into public.generation_jobs (id, organization_id, project_id, quality_mode)
     values ($1, $2, $3, 'STANDARD')`,
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
     values ($1, $2, $3, $4, 'shot_01', 0, $5, 'medium', 'text_to_video')`,
    [ids.shot, ids.project, ids.scene, ids.org, PLANNED_SHOT_FRAMES],
  );

  const bibleRow = await client.query<{ id: string }>(
    `insert into public.scene_bibles (project_id, organization_id, current_version)
     values ($1, $2, 1) returning id`,
    [ids.project, ids.org],
  );
  await client.query(
    `insert into public.scene_bible_versions (scene_bible_id, organization_id, version, document, schema_version)
     values ($1, $2, 1, $3, '1.0')`,
    [bibleRow.rows[0]!.id, ids.org, bible],
  );

  for (const family of FAMILIES) {
    await client.query(
      `insert into public.model_registry (model_id, family, display_name, kind, adapter, runtime)
       values ($1, 'test', $1, 'video', 'TestAdapter', 'runtime-test')`,
      [family.model],
    );
    await client.query(
      `insert into public.model_licenses (model_id, license_name, commercial_use, status)
       values ($1, 'Apache-2.0', true, 'approved')`,
      [family.model],
    );
    const version = await client.query<{ id: string }>(
      `insert into public.model_versions
         (model_id, version, lifecycle, required_profile, required_vram_gib, supported_precisions)
       values ($1, '1.0.0', 'production', 'GPU_PROFILE_ECONOMY', 8, '{bf16,fp16,fp8}')
       returning id`,
      [family.model],
    );
    await client.query(
      `insert into public.model_capabilities
         (model_version_id, generation_kind, max_duration_frames, accepts_reference_images,
          accepts_driving_audio, produces_audio)
       values ($1, $2, 0, true, true, true)`,
      [version.rows[0]!.id, family.kind],
    );
    // Above every shipped rule, so this job routes to the test fleet without
    // touching what the registry ships.
    await client.query(
      `insert into public.routing_rules (id, priority, enabled, match, target, reason)
       values ($1, 500, true, $2, $3, 'test fleet')`,
      [
        `test-${family.rule}-${suffix}`,
        JSON.stringify({ generation_kind: [family.kind] }),
        JSON.stringify({
          model_id: family.model,
          precision: "fp16",
          generation_profile: "test",
          qc_profile: "STANDARD",
          skills: [],
        }),
      ],
    );
  }

  await client.query(
    `insert into public.gpu_workers
       (worker_id, provider, provider_ref, endpoint, lifecycle, profile, vram_total_bytes,
        vram_free_bytes, supported_precisions, healthy, last_seen_at, cuda_version, compute_capability)
     values ($1, 'manual', $1, $2, 'READY', 'GPU_PROFILE_ULTRA', $3, $3,
             '{bf16,fp8,fp16}', true, now(), '12.4', '9.0')
     on conflict (worker_id) do update
       set endpoint = excluded.endpoint, lifecycle = 'READY', healthy = true, last_seen_at = now()`,
    [workerId, `http://127.0.0.1:${port}`, 103_079_215_104],
  );

  // The model scan the supervisor would have reported. A worker is only a
  // candidate for a model it actually holds.
  for (const family of FAMILIES) {
    await client.query(
      `insert into public.gpu_worker_models (worker_id, model_id, model_version, present, verified, loaded)
       values ($1, $2, '1.0.0', true, true, true)`,
      [workerId, family.model],
    );
  }
}
