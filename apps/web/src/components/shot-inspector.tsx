"use client";

import { useEffect, useState } from "react";
import { api, type RequestOptions, type ShotSummary } from "@/lib/api";
import { framesToSecondsLabel } from "@/lib/format";

/**
 * The selected shot (spec sections 42, 100).
 *
 * Shows what the judges said, which takes exist, and the repairs available.
 * Restoring an earlier take is a pointer move, so a user can compare v2 and v3
 * freely without losing either.
 */

interface ShotDetail {
  shot: ShotSummary;
  versions: Array<{
    version: number;
    asset_id: string | null;
    created_at: string;
    overall: number | null;
    passed: boolean | null;
  }>;
  evaluation: {
    id: string;
    overall: number;
    passed: boolean;
    /** Fraction of this mode's gating checks that could be run. Null if unknown. */
    coverage: number | null;
    metrics: Array<{ dimension: string; score: number; threshold: number | null; passed: boolean }>;
    /** Gating checks that could not run, by name. */
    unmeasured: string[];
  } | null;
}

const REPAIR_SCOPES: Array<{ id: string; label: string; hint: string }> = [
  { id: "auto", label: "Repair", hint: "Fix the smallest thing that failed" },
  { id: "lipsync", label: "Fix lip sync", hint: "Keeps the shot, corrects the mouth" },
  { id: "audio", label: "Fix audio", hint: "Remix without regenerating" },
  { id: "caption", label: "Fix captions", hint: "Rebuild from the final dialogue" },
  { id: "shot", label: "Regenerate", hint: "Generate this shot again" },
];

export function ShotInspector({
  shotId,
  session,
  fpsNum,
  fpsDen,
  onChanged,
}: {
  shotId: string;
  session: RequestOptions;
  fpsNum: number;
  fpsDen: number;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ShotDetail | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setPreviewUrl(null);
    api
      .getShot(shotId, session)
      .then(async (d) => {
        setDetail(d);
        if (d.shot.current_asset_id) {
          const asset = await api.getAsset(d.shot.current_asset_id, session).catch(() => null);
          setPreviewUrl(asset?.url ?? null);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [shotId, session]);

  async function repair(scope: string) {
    setBusy(scope);
    setError(null);
    try {
      await api.repairShot(shotId, scope, session);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function restore(version: number) {
    setBusy(`restore-${version}`);
    try {
      await api.restoreShot(shotId, version, session);
      onChanged();
      setDetail(await api.getShot(shotId, session));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error)
    return (
      <div className="card" style={{ color: "var(--danger)" }}>
        {error}
      </div>
    );
  if (!detail) return <div className="card muted">Loading shot…</div>;

  const { shot, versions, evaluation } = detail;

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{shot.slug}</strong>
        <span className="badge">{framesToSecondsLabel(Number(shot.duration_frames), fpsNum, fpsDen)}</span>
      </div>

      {previewUrl ? (
        <video src={previewUrl} controls style={{ width: "100%", borderRadius: 6, background: "#000" }} />
      ) : (
        <div
          className="muted"
          style={{
            background: "var(--surface-raised)",
            borderRadius: 6,
            padding: "2rem",
            textAlign: "center",
          }}
        >
          Not generated yet
        </div>
      )}

      {shot.stale && (
        <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
          {/* Stale means something it depends on changed, not that it failed. */}
          Out of date: {shot.stale_reasons.join(", ") || "something it depends on changed"}
        </p>
      )}

      {evaluation && (
        <div className="stack" style={{ gap: "0.35rem" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span style={{ fontWeight: 550 }}>Quality</span>
            <span className="badge" style={{ color: evaluation.passed ? "var(--accent)" : "var(--danger)" }}>
              {Math.round(evaluation.overall * 100)}
            </span>
          </div>
          {evaluation.unmeasured.length > 0 && (
            // A score with half the checks missing is not the same claim as a
            // score, and the difference is exactly the one a user would want to
            // know about. Said in the open rather than left to the badge.
            <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
              {evaluation.passed ? "Passed the checks we can run." : "Scored on the checks we can run."}{" "}
              {evaluation.unmeasured.length === 1 ? "One check" : `${evaluation.unmeasured.length} checks`}{" "}
              could not run: {evaluation.unmeasured.map((d) => d.replace(/_/g, " ")).join(", ")}.
            </p>
          )}
          {evaluation.metrics
            .filter((m) => m.threshold !== null)
            .map((metric) => (
              <div key={metric.dimension} className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted" style={{ fontSize: "0.85rem" }}>
                  {metric.dimension.replace(/_/g, " ")}
                </span>
                <span
                  style={{
                    fontSize: "0.85rem",
                    color: metric.passed ? "var(--text-muted)" : "var(--danger)",
                  }}
                >
                  {Math.round(metric.score * 100)}
                </span>
              </div>
            ))}
        </div>
      )}

      <div className="stack" style={{ gap: "0.4rem" }}>
        <span style={{ fontWeight: 550 }}>Fix</span>
        <div className="row" style={{ flexWrap: "wrap", gap: "0.4rem" }}>
          {REPAIR_SCOPES.map((scope) => (
            <button
              key={scope.id}
              onClick={() => repair(scope.id)}
              disabled={busy !== null}
              title={scope.hint}
              style={{ fontSize: "0.85rem" }}
            >
              {busy === scope.id ? "Working…" : scope.label}
            </button>
          ))}
        </div>
      </div>

      {versions.length > 1 && (
        <div className="stack" style={{ gap: "0.4rem" }}>
          <span style={{ fontWeight: 550 }}>Takes</span>
          {versions.map((version) => (
            <div key={version.version} className="row" style={{ justifyContent: "space-between" }}>
              <span className="row" style={{ gap: "0.5rem" }}>
                <span>v{version.version}</span>
                {version.version === shot.current_version && <span className="badge">current</span>}
                {version.overall !== null && (
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    {Math.round(version.overall * 100)}
                  </span>
                )}
              </span>
              {version.version !== shot.current_version && (
                <button
                  onClick={() => restore(version.version)}
                  disabled={busy !== null}
                  style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                >
                  Use this
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
