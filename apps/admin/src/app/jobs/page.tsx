"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { text, useSession } from "@videoai/ui";

/** Recent generation jobs, newest first. */
export default function JobsPage() {
  const session = useSession();
  const [jobs, setJobs] = useState<Array<Record<string, unknown>> | null>(null);

  useEffect(() => {
    if (session)
      adminApi
        .jobs(session)
        .then((r) => setJobs(r.jobs))
        .catch(() => setJobs([]));
  }, [session]);

  if (!session) return <div className="page muted">Sign in as platform staff.</div>;
  if (!jobs) return <div className="page muted">Loading…</div>;

  return (
    <div className="page stack">
      <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Jobs</h1>

      <div className="card stack" style={{ gap: "0.5rem" }}>
        {jobs.map((job) => {
          const spend = (job["budget_spend"] ?? {}) as Record<string, number>;
          const status = String(job["status"]);
          const bad = ["failed", "needs_review"].includes(status);
          return (
            <div key={String(job["id"])} className="stack" style={{ gap: "0.2rem" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <span>{String(job["title"])}</span>
                <span className="row" style={{ gap: "0.5rem" }}>
                  <span className="badge">{String(job["quality_mode"])}</span>
                  <span className="badge" style={{ color: bad ? "var(--danger)" : undefined }}>
                    {status}
                  </span>
                </span>
              </div>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                {Math.round(spend["gpu_seconds"] ?? 0)}s GPU · {spend["generation_attempts"] ?? 0} generations
                · {spend["repair_attempts"] ?? 0} repairs
                {text(job["error_message"]) ? ` · ${text(job["error_message"]).slice(0, 120)}` : ""}
              </span>
            </div>
          );
        })}
        {jobs.length === 0 && <span className="muted">No jobs yet.</span>}
      </div>
    </div>
  );
}
