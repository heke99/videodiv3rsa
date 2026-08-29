"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { text, useSession } from "@videoai/ui";

/**
 * The asset library (spec section 99).
 *
 * Characters, products, locations and voices survive the project they were
 * made for. Recreating a character in a new project produces a different
 * person, so reuse is the only way identity holds across a campaign.
 */

const KINDS = [
  { id: "characters", label: "Characters" },
  { id: "products", label: "Products" },
  { id: "locations", label: "Locations" },
  { id: "voices", label: "Voices" },
] as const;

export default function LibraryPage() {
  const session = useSession();
  const [kind, setKind] = useState<string>("characters");
  const [entries, setEntries] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    setEntries(null);
    api
      .library(kind, session)
      .then((r) => setEntries(r.entries))
      .catch((e: Error) => setError(e.message));
  }, [kind, session]);

  if (!session) return <div className="page muted">Sign in to see your library.</div>;

  return (
    <div className="page stack">
      <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Library</h1>

      <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        {KINDS.map((option) => (
          <button
            key={option.id}
            onClick={() => setKind(option.id)}
            aria-pressed={kind === option.id}
            className={kind === option.id ? "primary" : ""}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {entries === null && !error && <p className="muted">Loading…</p>}

      {entries?.length === 0 && (
        <div className="card muted">
          Nothing here yet. Characters, products and voices created in a project can be kept here and reused,
          which is how they stay identical between videos.
        </div>
      )}

      {entries && entries.length > 0 && (
        <div className="grid">
          {entries.map((entry) => (
            <div key={String(entry["id"])} className="card">
              <strong style={{ display: "block", marginBottom: "0.3rem" }}>
                {text(entry["label"]) || text(entry["slug"], "Untitled")}
              </strong>
              <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                <span className="badge">{text(entry["slug"])}</span>
                {entry["is_library_entity"] === true && <span className="badge">shared</span>}
                {text(entry["language"]) !== "" && <span className="badge">{text(entry["language"])}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
