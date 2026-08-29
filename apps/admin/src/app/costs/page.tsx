"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { useSession } from "@videoai/ui";

const DIMENSIONS = ["model", "project", "user", "kind", "worker"] as const;

/** Where the GPU budget goes (spec section 79). */
export default function CostsPage() {
  const session = useSession();
  const [dimension, setDimension] = useState<string>("model");
  const [data, setData] = useState<Awaited<ReturnType<typeof adminApi.costs>> | null>(null);

  useEffect(() => {
    if (session) adminApi.costs(dimension, session).then(setData).catch(() => setData(null));
  }, [session, dimension]);

  if (!session) return <div className="page muted">Sign in as platform staff.</div>;

  return (
    <div className="page stack">
      <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Costs</h1>

      <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        {DIMENSIONS.map((d) => (
          <button
            key={d}
            onClick={() => setDimension(d)}
            aria-pressed={dimension === d}
            className={dimension === d ? "primary" : ""}
          >
            By {d}
          </button>
        ))}
      </div>

      {data && (
        <>
          <div className="card">
            <div className="muted" style={{ fontSize: "0.85rem" }}>Cost per approved shot</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 600 }}>
              {data.per_approved_shot.per_shot.toFixed(2)}
            </div>
            <div className="muted" style={{ fontSize: "0.8rem" }}>
              {data.per_approved_shot.approved_shots} shots approved over 30 days
            </div>
          </div>

          <div className="card stack" style={{ gap: "0.5rem" }}>
            {data.breakdown.map((row) => (
              <div key={row.dimension_value} className="stack" style={{ gap: "0.25rem" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span>{row.dimension_value}</span>
                  <span className="muted">
                    {row.cost_units.toFixed(1)} units · {Math.round(row.gpu_seconds)}s
                  </span>
                </div>
                <div style={{ height: 6, background: "var(--surface-raised)", borderRadius: 3 }}>
                  <div
                    style={{
                      width: `${Math.max(row.share * 100, 1)}%`,
                      height: "100%",
                      background: "var(--accent)",
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            ))}
            {data.breakdown.length === 0 && <span className="muted">No usage recorded yet.</span>}
          </div>
        </>
      )}
    </div>
  );
}
