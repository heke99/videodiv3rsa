# Production gate

The Definition of Done from the specification (§120), with each item marked as
it actually stands. Items are **done**, **blocked on hardware**, or **not
built**. Nothing is marked done on the strength of code existing: done means
verified by something that runs.

Last updated after the third integration pass.

This page has now been wrong twice in the same direction, so it is worth saying
how. The first time it reported four activities as blocked on hardware when
they were blocked on wiring. The second time it marked QC persistence, the
editor's version history and observability **Done** on the strength of code
existing -- which is the one thing the paragraph above says this page does not
do. The QC service had no callers, nothing wrote the columns the editor reads,
and no span was ever emitted.

Two bugs came out of the same pass and are worth recording, because both had
been shipped and neither was visible to any test: a query filtered on a column
that does not exist, and a parameter used as both `uuid` and `text` in one
statement, which broke project deletion outright. Every SQL statement in the
codebase is now checked against a real schema in CI.

The third pass found the largest gap of all, and this row was the one that hid
it. "96 GB worker operational" was marked blocked on hardware, and it was --
but it would also have stayed blocked _with_ hardware, because the control
plane had no worker endpoints. The supervisor posted registrations and
heartbeats to paths nothing served, so nothing ever wrote `last_seen_at`, and
both scheduler queries filter on it. The fleet was empty by construction. A row
that is true for the wrong reason is the failure mode this page is most prone
to, and it has now happened three times.

## Infrastructure

| Item                     | State                   | Notes                                                                                                                                                                          |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 96 GB worker operational | **Blocked on hardware** | No GPU is attached. Registration, heartbeat and the scheduler's view of them are now exercised end to end against a real database, so what remains is genuinely the hardware.  |
| Portable GPU adapter     | **Done**                | `GpuProvider` with manual, SSH and API-driven implementations. Business logic never names a provider.                                                                          |
| Model volume persistent  | **Done**                | Mounted read-only into every runtime; verified against recorded hashes at startup.                                                                                             |
| Workers private          | **Done**                | Internal compose network, no public ingress, signed envelopes on every call.                                                                                                   |
| Autosuspend              | **Done**                | The maintenance loop stops a worker idle past `GPU_IDLE_TIMEOUT_SECONDS`. On a provider that cannot stop machines it says so and carries on, which is the abstraction working. |
| Fleet maintenance        | **Done**                | Stranded reservations expired, silent workers aged out of healthy. Neither ran at all before: `expireStaleReservations` had no callers.                                        |
| Local stack runs         | **Done**                | Four of six containers could not start; `director` and `render` were libraries with no process. A test now checks every compose service builds the file it runs.               |

## Models

Every family has an adapter, a runtime and health tests. None has been run
against real weights, because that needs the GPU.

| Model                         | Adapter        | Contract tests | Real inference      |
| ----------------------------- | -------------- | -------------- | ------------------- |
| Wan T2V / I2V / S2V / Animate | Done           | Done           | Blocked on hardware |
| Qwen Image                    | Done           | Done           | Blocked on hardware |
| Qwen3-TTS                     | Done           | Done           | Blocked on hardware |
| MMAudio                       | Done           | Done           | Blocked on hardware |
| MuseTalk                      | Done           | Done           | Blocked on hardware |
| WhisperX                      | Done           | Done           | Blocked on hardware |
| QC vision                     | Interface only | n/a            | Blocked on hardware |

## Workflow

| Item         | State           | Notes                                                                                                                                                                                                              |
| ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Director     | **Done**        | Local reasoning behind an adapter; output validated against the schema that generated its JSON Schema.                                                                                                             |
| Scene Bible  | **Done**        | Versioned entities, `forbidden_changes` honoured, canonical descriptions used verbatim.                                                                                                                            |
| Shot Planner | **Done**        | Splits on action; durations reconciled in code rather than by asking again.                                                                                                                                        |
| Model Router | **Done**        | Data-driven from `routing_rules`, fail-closed on licence.                                                                                                                                                          |
| Timeline     | **Done**        | Integer frames and samples; loudness verified by measuring the render.                                                                                                                                             |
| QC           | **Partly done** | Measured judges run today through `services/qc`, dispatched by the orchestrator. Vision judges join only when a healthy worker holds the QC model. Coverage is persisted, returned by the API and named on screen. |
| Repair       | **Done**        | The deterministic classifier owns scope, cost and the budget refusal; the Director supplies only the wording of a prompt repair.                                                                                   |
| Audio        | **Done**        | Audio-first pipeline, ducking resolved on the timeline.                                                                                                                                                            |
| Render       | **Done**        | FFmpeg compositor verified against real files, called from the workflow.                                                                                                                                           |
| Export       | **Done**        | Presets, caption burn-in, signed download; one deliverable per requested aspect ratio.                                                                                                                             |
| Skills       | **Done**        | Catalogue loaded per worker, selected per shot, composed into the Director's system prompt and recorded to `skill_runs`. Eval content never reaches a prompt.                                                      |

## Product

| Item                | State                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Signup and login    | **Done** — Supabase auth behind our own adapter                                |
| Organisations       | **Done**                                                                       |
| Projects            | **Done**                                                                       |
| Create video        | **Done**                                                                       |
| Uploads             | **Done** — typed by magic bytes, size limited, filename never a path           |
| Generation progress | **Done** — production steps, no internal stage names                           |
| Editor              | **Done** — timeline, shot inspector, versions, repair                          |
| Take history        | **Done** — every generated take is a version with its asset and its evaluation |
| Honest QC reporting | **Done** — the inspector names the gating checks that could not run            |
| Shot regeneration   | **Done**                                                                       |
| Audio               | **Done**                                                                       |
| Captions            | **Done** — derived from final alignment                                        |
| Export and download | **Done**                                                                       |

## Data

| Item           | State    | Evidence                                                                                   |
| -------------- | -------- | ------------------------------------------------------------------------------------------ |
| RLS            | **Done** | 29 checks against the live database, all passing                                           |
| Versioning     | **Done** | Assets, entities, shots, timelines all versioned; restore is a pointer move                |
| Provenance     | **Done** | Full record per generation attempt                                                         |
| Model registry | **Done** | 12 models, licences unreviewed by default                                                  |
| Skill registry | **Done** | 193 registered, 79 active, hash-synced against the filesystem; runs recorded per selection |
| Audit          | **Done** | Licence reviews, lifecycle changes and deletions recorded                                  |
| Rights records | **Done** | Required before a voice clone; enforced in the runtime as well as the API                  |

## Reliability

| Item                      | State                   | Notes                                                                                                                  |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Resume after worker crash | **Partly done**         | Temporal workflow with checkpoints per stage. Untested against a real crash because the stages that matter need a GPU. |
| Cancel                    | **Done**                | Signal rather than hard cancel: finished work kept, reservation released                                               |
| Retries bounded           | **Done**                | Four dimensions at once; exhaustion yields `needs_review`                                                              |
| Duplicate jobs prevented  | **Done**                | Idempotency keys stable across replays, changing on real regeneration                                                  |
| Worker migration tested   | **Blocked on hardware** | Runbook written; not exercised                                                                                         |

## Security

| Item                 | State                                               |
| -------------------- | --------------------------------------------------- |
| RLS tests            | **Done** — verified live                            |
| Signed storage       | **Done** — short-lived URLs on every backend        |
| No direct GPU access | **Done** — signed envelopes, private network        |
| Upload validation    | **Done** — 17 tests including type confusion        |
| Secret isolation     | **Done** — no committed `.env`, config fails closed |

## Quality

| Item              | State           | Notes                                                                                                |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| Golden benchmark  | **Partly done** | 18 cases defined with the reason each exists; the runner reaches the GPU boundary and stops honestly |
| QC thresholds     | **Done**        | Per profile; UGC relaxes polish and not correctness                                                  |
| Repair            | **Done**        |                                                                                                      |
| Model regression  | **Done**        | A single badly regressed case blocks promotion even when the average improved                        |
| Human calibration | **Done**        | Correlation, error rates and blind spots; awaiting real ratings                                      |

## Engineering

| Item                 | State    | Notes                                                                                                                                                             |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint                 | **Done** | Type-aware ESLint across the workspace; `no-floating-promises` and `no-misused-promises` on. ruff for workers.                                                    |
| Format               | **Done** | Prettier, checked in CI. Skill packages excluded: they are hashed into the registry.                                                                              |
| CI                   | **Done** | `.github/workflows/ci.yml` — lint, format, typecheck, build, vitest, pytest, and the guardrails as their own job                                                  |
| Pipeline integration | **Done** | `tests/integration/pipeline.spec.ts` drives plan to delivered MP4 on CPU, including technical QC and the measured panel                                           |
| Worker control plane | **Done** | Register and heartbeat, tested against the payloads the supervisor actually sends, asserting the scheduler can then see the worker                                |
| SQL against a schema | **Done** | Every statement PREPAREd against a real Postgres in CI, including those that build a table name at run time; caught three bugs, verified to fail on a planted one |
| Runs off Supabase    | **Done** | `infra/database/local/` supplies what hosted Supabase provides. All 29 policy checks pass on a plain Postgres 16                                                  |

## Portability

| Item                      | State    | Evidence                                                  |
| ------------------------- | -------- | --------------------------------------------------------- |
| No hardcoded GPU provider | **Done** | Portability test                                          |
| No hardcoded domain       | **Done** | Portability test, verified to fail on a planted violation |
| Storage abstraction       | **Done** | Three implementations                                     |
| GPU migration doc         | **Done** | `docs/GPU_MIGRATION.md`                                   |
| Domain migration doc      | **Done** | `docs/DOMAIN_MIGRATION.md`                                |

## Observability

| Item      | State           | Notes                                                                                                                                                                              |
| --------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spans     | **Done**        | Every planning, generation, QC, repair and render activity, carrying its job id                                                                                                    |
| Metrics   | **Partly done** | Generation time, repair rate, QC failure reason, and pass rate with coverage attached. The rest of `METRICS` is still unemitted                                                    |
| Exporting | **Partly done** | Structured JSON on stdout. `OTEL_EXPORTER_OTLP_ENDPOINT` is accepted by config but no OTLP transport exists, and the process says so at startup rather than dropping spans quietly |

## What blocks production

Two things, and they are the same thing:

1. **No GPU.** Every generation path is written and contract-tested, and none
   has produced a frame. Until a worker is attached, the honest statement is
   that the orchestration is built and the generation is unproven. What changed
   this pass is that attaching one would now do something: registration,
   heartbeat and the scheduler's view of them are exercised end to end.
2. **The vision half of the judge ensemble.** Identity, face, hands, anatomy,
   physics, product and lip sync are registered and report themselves
   unavailable. The pipeline's protection against identity drift is currently
   preventative — keyframe-first routing, reference strength, canonical
   descriptions — with no detection behind it. The product now says so on the
   shot inspector rather than showing a bare score, which does not fix it but
   stops it being invisible.

The whole delivery half of the pipeline -- assembly, composition, technical QC
and the measured judges -- now runs end to end on CPU in
`tests/integration/pipeline.spec.ts`. What is unproven is generation, not
orchestration.

Two smaller things are named above as partly done rather than hidden: most of
`METRICS` is still unemitted, and there is no OTLP transport behind the
endpoint the config accepts.

Everything else on this page is either done and verified, or named above as not
built.

## The order to do them in

1. Attach a 96 GB worker and follow `docs/GPU_MIGRATION.md`.
2. Run the golden suite to get a first baseline. It will be the only baseline,
   so it is worth running on a healthy worker rather than a rushed one.
3. Wire the vision judges and calibrate them against human ratings before
   letting them gate anything (§34: a judge's score is an opinion until it has
   been shown to agree with people).
4. Exercise worker migration and crash recovery for real.
5. Then, and not before, run the promotion gates for the first production
   model.
