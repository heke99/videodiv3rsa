"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { useSession } from "@/lib/session";

/** The skill catalogue, with what is active and how it is performing. */
export default function SkillsPage() {
  const session = useSession();
  const [skills, setSkills] = useState<Array<Record<string, unknown>> | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);

  useEffect(() => {
    if (session) adminApi.skills(session).then((r) => setSkills(r.skills)).catch(() => setSkills([]));
  }, [session]);

  if (!session) return <div className="page muted">Sign in as platform staff.</div>;
  if (!skills) return <div className="page muted">Loading…</div>;

  const active = skills.filter((s) => s["status"] === "active");
  const visible = showDrafts ? skills : active;

  const byCategory = new Map<string, Array<Record<string, unknown>>>();
  for (const skill of visible) {
    const category = String(skill["category"]);
    byCategory.set(category, [...(byCategory.get(category) ?? []), skill]);
  }

  return (
    <div className="page stack">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Skills</h1>
        <button onClick={() => setShowDrafts(!showDrafts)}>
          {showDrafts ? "Active only" : "Include drafts"}
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {/* Drafts are registered so the catalogue is complete, and can never be
            selected by the router. */}
        {active.length} active of {skills.length} registered. Drafts are never routed to.
      </p>

      {[...byCategory.entries()].map(([category, entries]) => (
        <div key={category} className="card stack" style={{ gap: "0.4rem" }}>
          <strong style={{ textTransform: "capitalize" }}>{category}</strong>
          {entries.map((skill) => {
            const runs = Number(skill["runs"] ?? 0);
            const failures = Number(skill["failures"] ?? 0);
            return (
              <div key={String(skill["skill_id"])} className="row" style={{ justifyContent: "space-between" }}>
                <span className="row" style={{ gap: "0.5rem" }}>
                  <span>{String(skill["name"])}</span>
                  {skill["status"] !== "active" && <span className="badge">{String(skill["status"])}</span>}
                </span>
                <span className="row" style={{ gap: "0.75rem" }}>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    v{String(skill["current_version"] ?? "-")}
                  </span>
                  {runs > 0 && (
                    <span
                      className="muted"
                      style={{ fontSize: "0.85rem", color: failures > 0 ? "var(--danger)" : undefined }}
                    >
                      {failures}/{runs} failed
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
