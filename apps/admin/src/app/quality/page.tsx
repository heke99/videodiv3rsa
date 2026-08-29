"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { useSession } from "@videoai/ui";

/** Quality across the fleet: what fails, how often, and how much is repaired. */
export default function QualityPage() {
  const session = useSession();
  const [data, setData] = useState<Awaited<ReturnType<typeof adminApi.quality>> | null>(null);

  useEffect(() => {
    if (session) adminApi.quality(session).then(setData).catch(() => setData(null));
  }, [session]);

  if (!session) return <div className="page muted">Sign in as platform staff.</div>;
  if (!data) return <div className="page muted">Loading…</div>;

  return (
    <div className="page stack">
      <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Quality</h1>
      <p className="muted" style={{ margin: 0 }}>
        Last 30 days. Repair rate {Math.round(data.repair_rate * 100)}% of evaluations.
      </p>

      <div className="card stack" style={{ gap: "0.4rem" }}>
        <strong>By dimension</strong>
        {data.dimensions.map((row) => {
          const failures = Number(row.failures);
          const samples = Number(row.samples);
          return (
            <div key={row.dimension} className="row" style={{ justifyContent: "space-between" }}>
              <span>{row.dimension.replace(/_/g, " ")}</span>
              <span className="row" style={{ gap: "1rem" }}>
                <span className="muted">avg {Number(row.average).toFixed(2)}</span>
                <span style={{ color: failures > 0 ? "var(--danger)" : "var(--text-muted)" }}>
                  {failures} / {samples} failed
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="card stack" style={{ gap: "0.4rem" }}>
        <strong>Most common findings</strong>
        {data.failure_reasons.map((row) => (
          <div key={`${row.code}-${row.severity}`} className="row" style={{ justifyContent: "space-between" }}>
            <span className="row" style={{ gap: "0.5rem" }}>
              <span>{row.code.replace(/_/g, " ")}</span>
              <span className="badge">{row.severity}</span>
            </span>
            <span className="muted">{row.occurrences}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
