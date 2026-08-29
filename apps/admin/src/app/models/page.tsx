"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi, type ModelRow } from "@/lib/api";
import { useSession } from "@videoai/ui";

/**
 * Models and licence review (spec sections 65, 83, 85).
 *
 * This screen is the gate. A model is routable only when its licence is
 * approved here and its version separately promoted, and the page is built to
 * make the current state of both obvious at a glance.
 */
export default function ModelsPage() {
  const session = useSession();
  const [models, setModels] = useState<ModelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    adminApi.models(session).then((r) => setModels(r.models)).catch((e: Error) => setError(e.message));
  }, [session]);

  useEffect(load, [load]);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!session) return <div className="page muted">Sign in as platform staff.</div>;

  const routable = models?.filter(
    (m) => m.license_status === "approved" && m.commercial_use && ["production", "canary"].includes(m.lifecycle ?? ""),
  ).length;

  return (
    <div className="page stack">
      <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Models</h1>
      <p className="muted" style={{ margin: 0 }}>
        {routable ?? 0} of {models?.length ?? 0} are routable. A model reaches traffic only with an
        approved licence and a promoted version.
      </p>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <div className="stack">
        {models?.map((model) => {
          const key = `${model.model_id}@${model.version}`;
          const approved = model.license_status === "approved" && model.commercial_use;
          const live = ["production", "canary"].includes(model.lifecycle ?? "");

          return (
            <div key={key} className="card stack" style={{ gap: "0.6rem" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <strong>{model.display_name}</strong>{" "}
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    {model.model_id} {model.version && `· ${model.version}`}
                  </span>
                </div>
                <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                  <span className="badge">{model.kind}</span>
                  <span
                    className="badge"
                    style={{ color: approved ? "var(--accent)" : "var(--danger)" }}
                    title={model.license_name ?? ""}
                  >
                    licence: {model.license_status ?? "unknown"}
                  </span>
                  <span className="badge" style={{ color: live ? "var(--accent)" : undefined }}>
                    {model.lifecycle ?? "unregistered"}
                  </span>
                  <span className="badge" style={{ color: model.installed ? undefined : "var(--warning)" }}>
                    {model.installed ? "installed" : "not on any worker"}
                  </span>
                </div>
              </div>

              <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                <button
                  disabled={busy !== null}
                  onClick={() =>
                    act(`${key}-approve`, () =>
                      adminApi.reviewLicense(
                        model.model_id,
                        { status: "approved", commercial_use: true, territories: ["*"] },
                        session,
                      ),
                    )
                  }
                >
                  Approve licence
                </button>
                <button
                  disabled={busy !== null}
                  onClick={() =>
                    act(`${key}-block`, () =>
                      adminApi.reviewLicense(
                        model.model_id,
                        { status: "blocked", commercial_use: false, territories: [] },
                        session,
                      ),
                    )
                  }
                >
                  Block
                </button>
                {model.version && (
                  <>
                    <button
                      disabled={busy !== null || !approved}
                      title={approved ? "" : "The licence must be approved first."}
                      onClick={() =>
                        act(`${key}-canary`, () =>
                          adminApi.setLifecycle(
                            model.model_id,
                            { version: model.version!, lifecycle: "canary", canary_weight: 0.1 },
                            session,
                          ),
                        )
                      }
                    >
                      Canary 10%
                    </button>
                    <button
                      disabled={busy !== null || !approved}
                      onClick={() =>
                        act(`${key}-prod`, () =>
                          adminApi.setLifecycle(
                            model.model_id,
                            { version: model.version!, lifecycle: "production", canary_weight: 1 },
                            session,
                          ),
                        )
                      }
                    >
                      Promote
                    </button>
                    <button
                      disabled={busy !== null}
                      onClick={() =>
                        act(`${key}-rollback`, () =>
                          adminApi.setLifecycle(
                            model.model_id,
                            // Rollback is immediate and needs no licence check:
                            // taking a model out of traffic is always allowed.
                            { version: model.version!, lifecycle: "approved", canary_weight: 0 },
                            session,
                          ),
                        )
                      }
                    >
                      Roll back
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
