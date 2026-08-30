import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

/** Minimal shape of the browser API used inside addInitScript. */
interface Storage {
  setItem(key: string, value: string): void;
}

/**
 * End to end against the real built app in a real browser (spec section 111).
 *
 * The API is stubbed, deliberately: what is under test here is that the pages
 * render, route and respond to a signed-in user. Generation itself needs a GPU
 * and is covered by the worker contract tests instead.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const API_PORT = 8799;
const WEB_PORT = 3799;

let api: ChildProcess;
let web: ChildProcess;
let browser: Browser;

/** A stub API serving the shapes the app expects. */
const STUB = `
import { createServer } from "node:http";

const project = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "A creator talking about the serum",
  status: "completed",
  quality_mode: "UGC",
  aspect_ratio: "9:16",
  target_duration_frames: "720",
  frame_rate_num: 24,
  frame_rate_den: 1,
  thumbnail_asset_id: null,
  updated_at: new Date().toISOString(),
  shot_count: "2",
};

const routes = {
  "/api/projects": { projects: [project] },
  "/api/projects/11111111-1111-4111-8111-111111111111": {
    project,
    scenes: [{ id: "s1", slug: "scene_01", index: 0, summary: "Creator at home" }],
    shots: [
      { id: "sh1", slug: "shot_01", scene_id: "s1", index: 0, duration_frames: "360",
        shot_type: "selfie", status: "approved", stale: false, stale_reasons: [],
        current_asset_id: null, current_version: 1,
        requires_identity_lock: true, requires_product_fidelity: false },
      { id: "sh2", slug: "shot_02", scene_id: "s1", index: 1, duration_frames: "360",
        shot_type: "product_hero", status: "needs_review", stale: false, stale_reasons: [],
        current_asset_id: null, current_version: 2,
        requires_identity_lock: false, requires_product_fidelity: true },
    ],
    job: { id: "j1", status: "needs_review", progress: {}, error_message: null, budget_spend: {} },
  },
  "/api/projects/11111111-1111-4111-8111-111111111111/timeline": {
    timeline: { id: "t1", current_version: 1, frame_rate_num: 24, frame_rate_den: 1,
                audio_sample_rate: 48000, duration_frames: 720, duration_seconds: 30,
                loudness_profile: "social" },
    tracks: [
      { id: "tv", slug: "video", kind: "VIDEO", index: 0, muted: false },
      { id: "td", slug: "dialogue", kind: "DIALOGUE", index: 1, muted: false },
    ],
    events: [
      { id: "e1", track_id: "tv", slug: "ev_shot_01", kind: "video", asset_id: null,
        shot_id: "sh1", start_frame: 0, end_frame: 360, start_sample: null, end_sample: null,
        text_content: null, display_start_seconds: 0 },
      { id: "e2", track_id: "tv", slug: "ev_shot_02", kind: "video", asset_id: null,
        shot_id: "sh2", start_frame: 360, end_frame: 720, start_sample: null, end_sample: null,
        text_content: null, display_start_seconds: 15 },
    ],
  },
  "/api/shots/sh1": {
    shot: { id: "sh1", slug: "shot_01", duration_frames: "360", current_version: 1,
            stale: false, stale_reasons: [], current_asset_id: null, status: "approved" },
    versions: [{ version: 1, asset_id: null, created_at: new Date().toISOString(), overall: 0.91, passed: true }],
    evaluation: { id: "q1", overall: 0.91, passed: true, coverage: 0.25,
      metrics: [{ dimension: "flicker", score: 0.94, threshold: 0.6, passed: true },
                { dimension: "av_sync", score: 0.88, threshold: 0.8, passed: true }],
      // The vision half of the panel needs hardware; a UGC shot gates on these
      // four and none of them ran.
      unmeasured: ["identity", "lip_sync", "hands", "product"] },
  },
  "/api/projects/11111111-1111-4111-8111-111111111111/renders": { renders: [] },
  "/api/library/characters": { entries: [{ id: "c1", slug: "character_001", label: "Maya", is_library_entity: true }] },
};

createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url ?? "/", "http://localhost");
  const body = routes[url.pathname];
  res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
  res.end(JSON.stringify(body ?? { error: "Not found" }));
}).listen(${API_PORT});
`;

/** Run a command to completion, failing loudly with its output. */
async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed:\n${output}`)),
    );
  });
}

async function waitFor(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up within ${timeoutMs}ms`);
}

/**
 * What a person can actually read on the page.
 *
 * textContent would also return the contents of inline scripts, so Next's
 * hydration payload gets scanned as if it were copy -- which is how a
 * "fontweight":500 in the payload reads as a leaked HTTP status.
 */
async function visibleText(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).toLowerCase();
}

/** Sign in by planting the session the app reads, then load the page. */
async function signedInPage(browser: Browser, path: string): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    // Runs in the browser, where localStorage exists; this file is typechecked
    // for Node, so the global is reached through globalThis rather than by
    // pulling the DOM lib into the whole test project.
    (globalThis as unknown as { localStorage: Storage }).localStorage.setItem(
      "videoai.session",
      JSON.stringify({ token: "e2e-token", organization_id: "org-1" }),
    );
  });
  const page = await context.newPage();
  await page.goto(`http://localhost:${WEB_PORT}${path}`, { waitUntil: "networkidle" });
  return page;
}

beforeAll(async () => {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(path.join(ROOT, "tests/e2e/.tmp"), { recursive: true });
  const stubPath = path.join(ROOT, "tests/e2e/.tmp/stub-api.mjs");
  writeFileSync(stubPath, STUB);

  api = spawn("node", [stubPath], { stdio: "ignore" });

  const webEnv = {
    ...process.env,
    NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
    NEXT_PUBLIC_APP_NAME: "Video AI",
  };
  const webDir = path.join(ROOT, "apps/web");

  // Built here rather than relying on whatever .next happens to be lying
  // around. NEXT_PUBLIC_* is inlined into the client bundle at build time, so
  // an app built without these reaches the browser with no API URL at all --
  // and the test then measures a build nobody in this file configured.
  await run("npx", ["next", "build"], webDir, webEnv);

  web = spawn("npx", ["next", "start", "--port", String(WEB_PORT)], {
    cwd: webDir,
    stdio: "ignore",
    env: webEnv,
  });

  await waitFor(`http://localhost:${API_PORT}/api/projects`);
  await waitFor(`http://localhost:${WEB_PORT}/`);

  // This environment ships a Chromium build that may not match what our
  // Playwright version would download, so the provided executable is used
  // directly rather than fetching another copy.
  const provided = "/opt/pw-browsers/chromium";
  browser = await chromium.launch(existsSync(provided) ? { executablePath: provided } : {});
}, 300_000);

afterAll(async () => {
  await browser?.close();
  api?.kill();
  web?.kill();
});

describe("the app in a browser", () => {
  it("lists projects on the dashboard", async () => {
    const page = await signedInPage(browser, "/");
    await expect.poll(() => page.getByText("A creator talking about the serum").count()).toBeGreaterThan(0);
    await page.close();
  });

  it("offers the create form without any generation terminology", async () => {
    const page = await signedInPage(browser, "/create");
    await expect.poll(() => page.getByText("Describe what you want to create").count()).toBeGreaterThan(0);

    const text = await visibleText(page);
    for (const banned of ["sampler", "cfg", "checkpoint", "diffusion", "seed", "steps"]) {
      expect(text, `create page exposed "${banned}"`).not.toContain(banned);
    }
    await page.close();
  });

  it("disables create until something has been described", async () => {
    const page = await signedInPage(browser, "/create");
    const button = page.getByRole("button", { name: "Create video" });
    expect(await button.isDisabled()).toBe(true);

    await page.getByRole("textbox").fill("a creator talking about a serum");
    expect(await button.isDisabled()).toBe(false);
    await page.close();
  });

  it("opens a project and draws its timeline", async () => {
    const page = await signedInPage(browser, "/projects/11111111-1111-4111-8111-111111111111");
    await expect.poll(() => page.getByText("Timeline").count()).toBeGreaterThan(0);
    await expect.poll(() => page.getByText("VIDEO").count()).toBeGreaterThan(0);
    await expect.poll(() => page.getByText("30.0s").count()).toBeGreaterThan(0);
    await page.close();
  });

  it("explains a shot that fell short instead of showing an error", async () => {
    const page = await signedInPage(browser, "/projects/11111111-1111-4111-8111-111111111111");
    await expect
      .poll(() => page.getByText(/could not reach the required quality/).count())
      .toBeGreaterThan(0);

    const text = await visibleText(page);
    for (const banned of ["inference", "traceback", "exception", "stack", "http 5", "internal server"]) {
      expect(text, `failure UI exposed "${banned}"`).not.toContain(banned);
    }

    // Every failure offers a way forward.
    await expect.poll(() => page.getByRole("button", { name: "Try repair" }).count()).toBeGreaterThan(0);
    await page.close();
  });

  it("shows a shot's quality when one is selected", async () => {
    const page = await signedInPage(browser, "/projects/11111111-1111-4111-8111-111111111111");
    await expect.poll(() => page.getByText("Quality").count()).toBeGreaterThan(0);
    await expect.poll(() => page.getByText("flicker").count()).toBeGreaterThan(0);
    await page.close();
  });

  it("says which quality checks could not run rather than implying they passed", async () => {
    const page = await signedInPage(browser, "/projects/11111111-1111-4111-8111-111111111111");
    // The fixture passes on 2 of a UGC shot's 6 gating dimensions. A green
    // score beside four silent failures-to-check is the claim this exists to
    // stop the UI making.
    await expect.poll(() => page.getByText(/could not run/).count()).toBeGreaterThan(0);

    const text = await visibleText(page);
    expect(text).toContain("passed the checks we can run");
    for (const missing of ["identity", "lip sync", "hands", "product"]) {
      expect(text, `the unmeasured dimension "${missing}" was not named`).toContain(missing);
    }
    await page.close();
  });

  it("shows the asset library", async () => {
    const page = await signedInPage(browser, "/library");
    await expect.poll(() => page.getByText("Maya").count()).toBeGreaterThan(0);
    await page.close();
  });

  it("shows a signed-out visitor a sign-in prompt rather than an empty page", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
    await expect.poll(() => page.getByText("Sign in").count()).toBeGreaterThan(0);
    await page.close();
  });
});
