"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { useSession } from "@videoai/ui";

/** Operations overview (spec section 83). */
export default function Overview() {
  const session = useSession();
  const [data, setData] = useState<Awaited<ReturnType<typeof adminApi.overview>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    adminApi.overview(session).then(setData).catch((e: Error) => setError(e.message));
  }, [session]);

  if (!session) return <div className="page muted">Sign in as platform staff.</div>;
  if (error) return <div className="page" style={{ color: "var(--danger)" }}>{error}</div>;
  if (!data) return <div className="page muted">Loading…</div>;

  return (
    <div className="page stack">
      <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Overview</h1>
      <p className="muted" style={{ margin: 0 }}>Last 7 days.</p>

      <div className="grid">
        <Stat label="Jobs" value={String(data.jobs.total)} detail={`${data.jobs.completed} completed`} />
        <Stat
          label="Success rate"
          value={`${Math.round(data.jobs.success_rate * 100)}%`}
          detail={`${data.jobs.failed} failed, ${data.jobs.needs_review} to review`}
        />
        <Stat label="Queue" value={String(data.queue.queued)} detail={`${data.queue.running} running`} />
        <Stat
          label="Workers"
          value={`${data.workers.healthy} / ${data.workers.total}`}
          detail="healthy"
          warn={data.workers.total > 0 && data.workers.healthy === 0}
        />
        <Stat
          label="Cost per approved shot"
          value={data.cost.per_shot.toFixed(2)}
          // The metric that matters: spend per shot that passed, not per shot
          // generated, which flatters a system that regenerates a lot.
          detail={`${data.cost.approved_shots} approved`}
        />
        <Stat
          label="GPU time"
          value={`${Math.round(data.cost.gpu_seconds / 60)}m`}
          detail={`${data.cost.cost_units.toFixed(0)} units`}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, detail, warn }: { label: string; value: string; detail: string; warn?: boolean }) {
  return (
    <div className="card">
      <div className="muted" style={{ fontSize: "0.85rem" }}>{label}</div>
      <div style={{ fontSize: "1.6rem", fontWeight: 600, color: warn ? "var(--danger)" : undefined }}>
        {value}
      </div>
      <div className="muted" style={{ fontSize: "0.8rem" }}>{detail}</div>
    </div>
  );
}
