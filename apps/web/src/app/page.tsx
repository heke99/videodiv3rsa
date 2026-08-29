"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type ProjectSummary } from "@/lib/api";
import { useSession } from "@/components/session";
import { MODE_LABELS, STATUS_LABELS, framesToClock, relativeTime } from "@/lib/format";

/**
 * The project dashboard (spec section 98).
 *
 * Deliberately plain: a card carries a thumbnail, a state and enough context
 * to tell two projects apart. Everything else belongs inside the project.
 */
export default function Dashboard() {
  const session = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    api
      .listProjects(session)
      .then((r) => setProjects(r.projects))
      .catch((e: ApiError) => setError(e.message));
  }, [session]);

  if (!session) return <SignInPrompt />;

  return (
    <div className="page stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Projects</h1>
        <a href="/create">
          <button className="primary">New video</button>
        </a>
      </div>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {projects === null && !error && <p className="muted">Loading…</p>}
      {projects?.length === 0 && (
        <div className="card">
          <p style={{ marginTop: 0 }}>Nothing here yet.</p>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            Describe the video you want and it will be planned, generated and assembled for you.
          </p>
          <a href="/create">
            <button className="primary">Create your first video</button>
          </a>
        </div>
      )}

      {projects && projects.length > 0 && (
        <div className="grid">
          {projects.map((project) => (
            <a
              key={project.id}
              href={`/projects/${project.id}`}
              className="card"
              style={{ textDecoration: "none", display: "block" }}
            >
              <div
                style={{
                  aspectRatio: project.aspect_ratio.replace(":", " / "),
                  background: "var(--surface-raised)",
                  borderRadius: "6px",
                  marginBottom: "0.75rem",
                  display: "grid",
                  placeItems: "center",
                }}
                className="muted"
              >
                {project.thumbnail_asset_id ? "" : "No preview yet"}
              </div>
              <strong style={{ display: "block", marginBottom: "0.35rem" }}>{project.title}</strong>
              <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                <span className="badge">{STATUS_LABELS[project.status] ?? project.status}</span>
                <span className="badge">{MODE_LABELS[project.quality_mode] ?? project.quality_mode}</span>
                {Number(project.target_duration_frames) > 0 && (
                  <span className="badge">
                    {framesToClock(
                      Number(project.target_duration_frames),
                      project.frame_rate_num,
                      project.frame_rate_den,
                    )}
                  </span>
                )}
              </div>
              <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
                {relativeTime(project.updated_at)}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function SignInPrompt() {
  return (
    <div className="page">
      <div className="card" style={{ maxWidth: 420 }}>
        <h1 style={{ marginTop: 0, fontSize: "1.25rem" }}>Sign in</h1>
        <p className="muted">You need to be signed in to see your projects.</p>
      </div>
    </div>
  );
}
