"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi, type WorkerRow } from "@/lib/api";
import { useSession } from "@videoai/ui";

/** The GPU fleet, and the one control that matters: draining a worker. */
export default function GpuPage() {
  const session = useSession();
  const [workers, setWorkers] = useState<WorkerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    adminApi
      .workers(session)
      .then((r) => setWorkers(r.workers))
      .catch((e: Error) => setError(e.message));
  }, [session]);

  useEffect(load, [load]);

  if (!session) return <div className="page muted">Sign in as platform staff.</div>;
  if (error)
    return (
      <div className="page" style={{ color: "var(--danger)" }}>
        {error}
      </div>
    );

  return (
    <div className="page stack">
      <h1 style={{ margin: 0, fontSize: "1.4rem" }}>GPU fleet</h1>

      {workers?.length === 0 && (
        <div className="card muted">
          No workers registered. Generation will fail preflight until one is attached; there is no remote
          fallback by design.
        </div>
      )}

      <div className="stack">
        {workers?.map((worker) => {
          const total = Number(worker.vram_total_bytes);
          const free = Number(worker.vram_free_bytes);
          const usedPct = total === 0 ? 0 : Math.round(((total - free) / total) * 100);
          const stale = !worker.last_seen_at || Date.now() - Date.parse(worker.last_seen_at) > 120_000;

          return (
            <div key={worker.worker_id} className="card stack" style={{ gap: "0.6rem" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <strong>{worker.worker_id}</strong>
                <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                  <span className="badge">{worker.provider}</span>
                  <span className="badge">{worker.profile.replace("GPU_PROFILE_", "")}</span>
                  <span
                    className="badge"
                    style={{ color: worker.healthy && !stale ? "var(--accent)" : "var(--danger)" }}
                  >
                    {/* A worker without a recent heartbeat is not healthy, whatever its flag says. */}
                    {stale ? "no heartbeat" : worker.lifecycle}
                  </span>
                </div>
              </div>

              <div className="row" style={{ gap: "1.25rem", flexWrap: "wrap" }}>
                <span className="muted">
                  VRAM {usedPct}% used of {(total / 1024 ** 3).toFixed(0)} GiB
                </span>
                {worker.utilization_pct && <span className="muted">GPU {worker.utilization_pct}%</span>}
                {worker.temperature_c && <span className="muted">{worker.temperature_c}°C</span>}
                <span className="muted">queue {worker.queue_depth}</span>
              </div>

              <div className="row">
                <button
                  onClick={() =>
                    adminApi.drain(worker.worker_id, !worker.drain_requested, session).then(load)
                  }
                >
                  {worker.drain_requested ? "Return to service" : "Drain"}
                </button>
                {worker.drain_requested && (
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    Finishing its current work; no new jobs.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
