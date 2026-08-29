"use client";

import { useEffect, useState } from "react";
import { api, type RequestOptions } from "@/lib/api";

/**
 * Export (spec section 41).
 *
 * One completed render, delivered in as many shapes as the user needs, rather
 * than a re-render per platform.
 */

const ASPECTS = [
  { value: "9:16", label: "Vertical 1080×1920" },
  { value: "16:9", label: "Widescreen 1920×1080" },
  { value: "1:1", label: "Square 1080×1080" },
];

interface RenderRow {
  id: string;
  status: string;
  exports: Array<{ id: string; aspect_ratio: string; status: string; burned_captions: boolean }>;
}

export function ExportPanel({ projectId, session }: { projectId: string; session: RequestOptions }) {
  const [renders, setRenders] = useState<RenderRow[]>([]);
  const [aspect, setAspect] = useState("9:16");
  const [captions, setCaptions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const result = await api.renders(projectId, session).catch(() => ({ renders: [] }));
    setRenders(result.renders as unknown as RenderRow[]);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const ready = renders.some((r) => r.status === "completed");

  async function create() {
    setBusy(true);
    setMessage(null);
    try {
      await api.createExport(projectId, { aspect_ratio: aspect, burned_captions: captions }, session);
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download(exportId: string) {
    try {
      const { url } = await api.downloadExport(exportId, session);
      window.location.href = url;
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  return (
    <div className="card stack">
      <strong>Export</strong>

      {!ready && (
        <p className="muted" style={{ margin: 0 }}>
          Export becomes available once the video has finished rendering.
        </p>
      )}

      <div className="row" style={{ flexWrap: "wrap", gap: "0.4rem" }}>
        {ASPECTS.map((option) => (
          <button
            key={option.value}
            onClick={() => setAspect(option.value)}
            aria-pressed={aspect === option.value}
            className={aspect === option.value ? "primary" : ""}
            style={{ fontSize: "0.85rem" }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="row" style={{ gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={captions}
          onChange={(e) => setCaptions(e.target.checked)}
          style={{ width: "auto" }}
        />
        <span>Burn captions into the video</span>
      </label>

      <button className="primary" onClick={create} disabled={!ready || busy}>
        {busy ? "Preparing…" : "Create export"}
      </button>

      {message && <p style={{ color: "var(--danger)", margin: 0 }}>{message}</p>}

      {renders.flatMap((r) => r.exports).length > 0 && (
        <div className="stack" style={{ gap: "0.4rem" }}>
          {renders
            .flatMap((r) => r.exports)
            .map((item) => (
              <div key={item.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  {item.aspect_ratio}
                  {item.burned_captions ? " · captions" : ""}
                </span>
                {item.status === "completed" ? (
                  <button onClick={() => download(item.id)} style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}>
                    Download
                  </button>
                ) : (
                  <span className="badge">{item.status}</span>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
