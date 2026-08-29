"use client";

import type { JobStatus } from "@videoai/contracts";
import { failureFor, stepsFor } from "@/lib/progress";

/**
 * Production progress (spec sections 46, 105).
 *
 * Shows the steps a person would recognise from a film production. When
 * something fails, it says what could not be achieved and offers the choices
 * that exist, never an inference error.
 */

export function ProgressPanel({
  status,
  completedUnits,
  totalUnits,
  shotsNeedingReview,
  onAction,
}: {
  status: JobStatus;
  completedUnits: number;
  totalUnits: number;
  shotsNeedingReview: string[];
  onAction: (id: "repair" | "edit" | "accept" | "retry") => void;
}) {
  const failure = failureFor(status, shotsNeedingReview);

  if (failure) {
    return (
      <div className="card stack" style={{ borderColor: "var(--warning)" }}>
        <strong>{failure.headline}</strong>
        <p className="muted" style={{ margin: 0 }}>
          {failure.explanation}
        </p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {failure.actions.map((action) => (
            <button key={action.id} onClick={() => onAction(action.id)}>
              {action.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card stack" style={{ gap: "0.5rem" }}>
      {stepsFor(status, completedUnits, totalUnits).map((step) => (
        <div
          key={step.step}
          className="row"
          style={{
            justifyContent: "space-between",
            opacity: step.state === "pending" ? 0.45 : 1,
          }}
        >
          <span className="row" style={{ gap: "0.6rem" }}>
            <span
              aria-hidden
              style={{
                width: "1rem",
                display: "inline-block",
                color: step.state === "done" ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              {step.state === "done" ? "✓" : step.state === "active" ? "•" : ""}
            </span>
            <span style={{ fontWeight: step.state === "active" ? 550 : 400 }}>{step.label}</span>
          </span>
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {step.detail || (step.state === "active" ? "…" : "")}
          </span>
        </div>
      ))}
    </div>
  );
}
