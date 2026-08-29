"use client";

import { useState } from "react";
import { AspectRatio } from "@videoai/contracts";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@videoai/ui";
import { CREATE_MODES, MODE_LABELS } from "@/lib/format";

/**
 * Create (spec section 43).
 *
 * One description field and four choices. No sampler, no CFG, no checkpoint
 * dropdown, no diffusion vocabulary anywhere: everything technical is decided
 * by the router from what the shot needs.
 */

/**
 * Copy for the shapes offered here. The set itself comes from the contract, so
 * an aspect ratio added there appears rather than being silently unavailable;
 * one without copy shows its ratio and where it is typically used stays blank.
 */
const ASPECT_COPY: Partial<Record<AspectRatio, { label: string; hint: string }>> = {
  "9:16": { label: "Vertical", hint: "TikTok, Reels, Shorts" },
  "16:9": { label: "Widescreen", hint: "YouTube, web" },
  "1:1": { label: "Square", hint: "Feed posts" },
};

const ASPECTS = AspectRatio.options
  .filter((value) => value in ASPECT_COPY)
  .map((value) => ({ value, ...ASPECT_COPY[value]! }));

const DURATIONS = [15, 30, 45, 60];

export default function CreatePage() {
  const session = useSession();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<string>("REALISTIC");
  const [aspect, setAspect] = useState("9:16");
  const [duration, setDuration] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!session || prompt.trim().length === 0) return;

    setSubmitting(true);
    setError(null);
    try {
      const { project_id } = await api.createProject(
        { prompt: prompt.trim(), mode, aspect_ratio: aspect, target_duration_seconds: duration },
        session,
      );
      await api.generate(project_id, session);
      window.location.href = `/projects/${project_id}`;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="page stack" style={{ maxWidth: 720 }}>
      <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Create video</h1>

      <form onSubmit={submit} className="stack">
        <label className="stack" style={{ gap: "0.4rem" }}>
          <span style={{ fontWeight: 550 }}>Describe what you want to create</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="A creator talking to camera about a serum that finally worked after she gave up on retinol"
            autoFocus
          />
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            Say what should happen and who it is for. Everything else is worked out for you.
          </span>
        </label>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }} className="stack">
          <legend style={{ fontWeight: 550, padding: 0, marginBottom: "0.5rem" }}>Style</legend>
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            {CREATE_MODES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={mode === value ? "primary" : ""}
              >
                {MODE_LABELS[value]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }} className="stack">
          <legend style={{ fontWeight: 550, padding: 0, marginBottom: "0.5rem" }}>Shape</legend>
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            {ASPECTS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setAspect(option.value)}
                aria-pressed={aspect === option.value}
                className={aspect === option.value ? "primary" : ""}
                title={option.hint}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }} className="stack">
          <legend style={{ fontWeight: 550, padding: 0, marginBottom: "0.5rem" }}>Length</legend>
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            {DURATIONS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                onClick={() => setDuration(seconds)}
                aria-pressed={duration === seconds}
                className={duration === seconds ? "primary" : ""}
              >
                {seconds}s
              </button>
            ))}
          </div>
        </fieldset>

        {error && <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>}

        <div className="row">
          <button type="submit" className="primary" disabled={!session || submitting || !prompt.trim()}>
            {submitting ? "Starting…" : "Create video"}
          </button>
          {!session && <span className="muted">Sign in first.</span>}
        </div>
      </form>
    </div>
  );
}
