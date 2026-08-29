import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { JOB_STATUS_TO_STEP, type JobStatus } from "@videoai/contracts";
import { STEP_ORDER, failureFor, stepsFor } from "../../apps/web/src/lib/progress.js";

/**
 * What the user is told while a video is being made (spec sections 46, 105).
 *
 * Two rules under test: internal stage names never surface, and a failure is
 * always a sentence about the video with choices attached, never an error.
 */

describe("progress steps", () => {
  it("marks earlier steps done and later steps pending", () => {
    const steps = stepsFor("generating_shots");
    const active = steps.findIndex((s) => s.state === "active");

    expect(steps[active]!.step).toBe("generating_scenes");
    expect(steps.slice(0, active).every((s) => s.state === "done")).toBe(true);
    expect(steps.slice(active + 1).every((s) => s.state === "pending")).toBe(true);
  });

  it("shows a count only on the step that has one", () => {
    const steps = stepsFor("generating_shots", 4, 8);
    expect(steps.find((s) => s.step === "generating_scenes")!.detail).toBe("4 / 8");
    expect(steps.find((s) => s.step === "creating_sound")!.detail).toBe("");
  });

  it("omits the count when the total is unknown", () => {
    expect(stepsFor("generating_shots", 0, 0).find((s) => s.step === "generating_scenes")!.detail).toBe("");
  });

  it("marks every step done when the video is finished", () => {
    expect(stepsFor("completed").every((s) => s.state === "done")).toBe(true);
  });

  it("maps every job status to a step or to a terminal state", () => {
    // A status with no mapping would render as a blank progress panel.
    for (const [status, step] of Object.entries(JOB_STATUS_TO_STEP)) {
      const terminal = ["completed", "failed", "cancelled", "needs_review"].includes(status);
      expect(step === null, status).toBe(terminal);
      if (step) expect(STEP_ORDER, status).toContain(step);
    }
  });

  it("never shows an internal stage name to the user", () => {
    const internalWords = ["preflight", "shot_qc", "generating_shots", "audio_qc", "final_render", "syncing"];
    for (const status of Object.keys(JOB_STATUS_TO_STEP) as JobStatus[]) {
      const labels = stepsFor(status).map((s) => s.label.toLowerCase()).join(" ");
      for (const word of internalWords) {
        expect(labels, `${status} leaked ${word}`).not.toContain(word);
      }
    }
  });
});

describe("failure messages", () => {
  it("says nothing while the job is running", () => {
    expect(failureFor("generating_shots")).toBeNull();
  });

  it("names the scene that fell short and offers three choices", () => {
    const failure = failureFor("needs_review", ["shot_04"])!;
    expect(failure.headline).toContain("shot_04");
    expect(failure.actions.map((a) => a.id)).toEqual(["repair", "edit", "accept"]);
  });

  it("counts the scenes when several fell short", () => {
    expect(failureFor("needs_review", ["a", "b", "c"])!.headline).toContain("3 scenes");
  });

  it("says work was kept when the user stopped it", () => {
    expect(failureFor("cancelled")!.explanation).toContain("kept");
  });

  it("never surfaces a technical error to the user", () => {
    const technical = ["inference", "500", "cuda", "traceback", "exception", "null", "timeout"];
    for (const status of ["failed", "cancelled", "needs_review"] as JobStatus[]) {
      const failure = failureFor(status, ["shot_01"])!;
      const text = `${failure.headline} ${failure.explanation}`.toLowerCase();
      for (const word of technical) {
        expect(text, `${status} leaked ${word}`).not.toContain(word);
      }
    }
  });

  it("always offers at least one way forward", () => {
    for (const status of ["failed", "cancelled", "needs_review"] as JobStatus[]) {
      expect(failureFor(status, ["shot_01"])!.actions.length).toBeGreaterThan(0);
    }
  });
});

describe("the create screen's vocabulary", () => {
  const WEB_SRC = path.resolve(import.meta.dirname, "../../apps/web/src");

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) sourceFiles(full, out);
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
  }

  /**
   * Comments are stripped before scanning: the rule is about what a user
   * reads on screen, and a comment explaining that a term is banned would
   * otherwise trip the check that enforces it.
   */
  function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  }

  it("exposes no diffusion terminology anywhere in the app", () => {
    // Spec 43 forbids exposing generation internals on the Create screen; the
    // user describes a video and the router decides the rest.
    const banned = [
      "cfg scale", "classifier-free", "sampler", "checkpoint", "denois",
      "diffusion step", "lora", "vae", "latent",
    ];
    const hits: string[] = [];

    for (const file of sourceFiles(WEB_SRC)) {
      const text = withoutComments(readFileSync(file, "utf8")).toLowerCase();
      for (const word of banned) {
        if (text.includes(word)) hits.push(`${path.relative(WEB_SRC, file)}: ${word}`);
      }
    }

    expect(hits, `Diffusion terminology in the UI:\n${hits.join("\n")}`).toEqual([]);
  });

  it("hardcodes no API host", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(WEB_SRC)) {
      const text = withoutComments(readFileSync(file, "utf8"));
      if (/https?:\/\/(?!localhost)[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) {
        hits.push(path.relative(WEB_SRC, file));
      }
    }
    expect(hits, `Hardcoded hosts: ${hits.join(", ")}`).toEqual([]);
  });
});
