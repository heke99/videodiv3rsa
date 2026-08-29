"use client";

import { use, useCallback, useEffect, useState } from "react";
import type { JobStatus } from "@videoai/contracts";
import { api, type JobState, type ShotSummary, type TimelineView } from "@/lib/api";
import { useSession } from "@videoai/ui";
import { ProgressPanel } from "@/components/progress";
import { TimelineTracks } from "@/components/timeline";
import { ShotInspector } from "@/components/shot-inspector";
import { ExportPanel } from "@/components/export";
import { MODE_LABELS, STATUS_LABELS } from "@/lib/format";

/**
 * The project editor (spec section 42).
 *
 * While a job is running this is a progress view; once shots exist it becomes
 * the editor. The two are one page because they are one thing to the user:
 * the video, in whatever state it is in.
 */
export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const session = useSession();

  const [project, setProject] = useState<Awaited<ReturnType<typeof api.getProject>> | null>(null);
  const [timeline, setTimeline] = useState<TimelineView | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const [detail, tl] = await Promise.all([
        api.getProject(id, session),
        api.getTimeline(id, session).catch(() => null),
      ]);
      setProject(detail);
      setTimeline(tl);
      setJob(detail.job);
      setSelectedShotId((current) => current ?? detail.shots[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, session]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while something is actually running. A finished project is
  // static, and polling it forever is a waste of the user's battery.
  const running = job !== null && !isTerminal(job.status as JobStatus);
  useEffect(() => {
    if (!session || !job || !running) return;
    // Guarded against overlap: a poll that outlives the interval must not have
    // a second one started on top of it, or a slow API turns into a queue of
    // requests that answer out of order and flicker the status backwards.
    let inFlight = false;
    let stopped = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void (async () => {
        try {
          const next = await api.getJob(job.id, session);
          if (stopped) return;
          setJob(next);
          if (isTerminal(next.status as JobStatus)) await load();
        } catch {
          // A transient failure while polling should not clear the page.
        } finally {
          inFlight = false;
        }
      })();
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [session, job, running, load]);

  if (!session) return <div className="page muted">Sign in to open this project.</div>;
  if (error) return <div className="page" style={{ color: "var(--danger)" }}>{error}</div>;
  if (!project) return <div className="page muted">Loading…</div>;

  const live = job?.live;
  const shotsNeedingReview = project.shots
    .filter((s) => s.status === "needs_review")
    .map((s) => s.slug);

  return (
    <div className="page stack">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ margin: "0 0 0.35rem", fontSize: "1.4rem" }}>{project.project.title}</h1>
          <div className="row" style={{ gap: "0.4rem" }}>
            <span className="badge">{STATUS_LABELS[project.project.status] ?? project.project.status}</span>
            <span className="badge">
              {MODE_LABELS[project.project.quality_mode] ?? project.project.quality_mode}
            </span>
            <span className="badge">{project.project.aspect_ratio}</span>
          </div>
        </div>
        {running && job && (
          <button onClick={() => api.cancelJob(job.id, session).then(load)}>Stop</button>
        )}
      </div>

      {job && (
        <ProgressPanel
          status={job.status as JobStatus}
          completedUnits={live?.completed_units ?? 0}
          totalUnits={live?.total_units ?? project.shots.length}
          shotsNeedingReview={shotsNeedingReview}
          onAction={async (action) => {
            if (action === "retry") {
              await api.generate(id, session);
              void load();
            }
            if (action === "repair" && selectedShotId) {
              await api.repairShot(selectedShotId, "auto", session);
              void load();
            }
          }}
        />
      )}

      {project.shots.length > 0 && (
        <>
          <SceneStrip
            shots={project.shots}
            scenes={project.scenes}
            selectedShotId={selectedShotId}
            onSelect={setSelectedShotId}
          />

          {timeline && (
            <TimelineTracks
              data={timeline}
              selectedShotId={selectedShotId}
              onSelectShot={setSelectedShotId}
              onToggleMute={async (trackId, muted) => {
                setTimeline((current) =>
                  current
                    ? {
                        ...current,
                        tracks: current.tracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
                      }
                    : current,
                );
                await fetch(`${process.env["NEXT_PUBLIC_API_URL"]}/api/timeline-tracks/${trackId}`, {
                  method: "PATCH",
                  headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${session.token}`,
                  },
                  body: JSON.stringify({ muted }),
                });
              }}
            />
          )}

          <div
            style={{
              display: "grid",
              gap: "1rem",
              gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)",
            }}
          >
            <ExportPanel projectId={id} session={session} />
            {selectedShotId && (
              <ShotInspector
                shotId={selectedShotId}
                session={session}
                fpsNum={project.project.frame_rate_num}
                fpsDen={project.project.frame_rate_den}
                onChanged={load}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SceneStrip({
  shots,
  scenes,
  selectedShotId,
  onSelect,
}: {
  shots: ShotSummary[];
  scenes: Array<{ id: string; slug: string; index: number; summary: string }>;
  selectedShotId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="card stack" style={{ gap: "0.75rem" }}>
      {scenes.map((scene) => (
        <div key={scene.id} className="stack" style={{ gap: "0.4rem" }}>
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {scene.summary || scene.slug}
          </span>
          <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
            {shots
              .filter((shot) => shot.scene_id === scene.id)
              .map((shot) => (
                <button
                  key={shot.id}
                  onClick={() => onSelect(shot.id)}
                  aria-pressed={shot.id === selectedShotId}
                  className={shot.id === selectedShotId ? "primary" : ""}
                  style={{
                    fontSize: "0.8rem",
                    // Anything not approved is visibly not approved, so a user
                    // is never surprised by what ends up in the export.
                    borderColor:
                      shot.status === "needs_review" || shot.status === "failed"
                        ? "var(--danger)"
                        : shot.stale
                          ? "var(--warning)"
                          : undefined,
                  }}
                >
                  {shot.slug.replace(/^shot_/, "")}
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function isTerminal(status: JobStatus): boolean {
  return ["completed", "failed", "cancelled", "needs_review"].includes(status);
}
