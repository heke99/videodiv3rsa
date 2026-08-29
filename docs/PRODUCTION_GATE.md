# Production gate

The Definition of Done from the specification (§120), with each item marked as
it actually stands. Items are **done**, **blocked on hardware**, or **not
built**. Nothing is marked done on the strength of code existing: done means
verified by something that runs.

Last updated at the end of Batch 12.

## Infrastructure

| Item                     | State                   | Notes                                                                                                               |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 96 GB worker operational | **Blocked on hardware** | No GPU is attached. The worker contract, capability scan and registration are implemented and tested without one.   |
| Portable GPU adapter     | **Done**                | `GpuProvider` with manual, SSH and API-driven implementations. Business logic never names a provider.               |
| Model volume persistent  | **Done**                | Mounted read-only into every runtime; verified against recorded hashes at startup.                                  |
| Workers private          | **Done**                | Internal compose network, no public ingress, signed envelopes on every call.                                        |
| Autosuspend              | **Not built**           | Lifecycle states and idle timeout exist; the policy that acts on them is provider work, deferred with the provider. |

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

| Item         | State           | Notes                                                                                                  |
| ------------ | --------------- | ------------------------------------------------------------------------------------------------------ |
| Director     | **Done**        | Local reasoning behind an adapter; output validated against the schema that generated its JSON Schema. |
| Scene Bible  | **Done**        | Versioned entities, `forbidden_changes` honoured, canonical descriptions used verbatim.                |
| Shot Planner | **Done**        | Splits on action; durations reconciled in code rather than by asking again.                            |
| Model Router | **Done**        | Data-driven from `routing_rules`, fail-closed on licence.                                              |
| Timeline     | **Done**        | Integer frames and samples; loudness verified by measuring the render.                                 |
| QC           | **Partly done** | Measured judges run today. Vision judges are registered and report themselves unavailable.             |
| Repair       | **Done**        | Smallest-scope planner; deterministic repairs need no GPU.                                             |
| Audio        | **Done**        | Audio-first pipeline, ducking resolved on the timeline.                                                |
| Render       | **Done**        | FFmpeg compositor verified against real files.                                                         |
| Export       | **Done**        | Presets, caption burn-in, signed download.                                                             |

## Product

| Item                | State                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Signup and login    | **Done** — Supabase auth behind our own adapter                      |
| Organisations       | **Done**                                                             |
| Projects            | **Done**                                                             |
| Create video        | **Done**                                                             |
| Uploads             | **Done** — typed by magic bytes, size limited, filename never a path |
| Generation progress | **Done** — production steps, no internal stage names                 |
| Editor              | **Done** — timeline, shot inspector, versions, repair                |
| Shot regeneration   | **Done**                                                             |
| Audio               | **Done**                                                             |
| Captions            | **Done** — derived from final alignment                              |
| Export and download | **Done**                                                             |

## Data

| Item           | State    | Evidence                                                                    |
| -------------- | -------- | --------------------------------------------------------------------------- |
| RLS            | **Done** | 29 checks against the live database, all passing                            |
| Versioning     | **Done** | Assets, entities, shots, timelines all versioned; restore is a pointer move |
| Provenance     | **Done** | Full record per generation attempt                                          |
| Model registry | **Done** | 12 models, licences unreviewed by default                                   |
| Skill registry | **Done** | 193 registered, 79 active, hash-synced against the filesystem               |
| Audit          | **Done** | Licence reviews, lifecycle changes and deletions recorded                   |
| Rights records | **Done** | Required before a voice clone; enforced in the runtime as well as the API   |

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

## Portability

| Item                      | State    | Evidence                                                  |
| ------------------------- | -------- | --------------------------------------------------------- |
| No hardcoded GPU provider | **Done** | Portability test                                          |
| No hardcoded domain       | **Done** | Portability test, verified to fail on a planted violation |
| Storage abstraction       | **Done** | Three implementations                                     |
| GPU migration doc         | **Done** | `docs/GPU_MIGRATION.md`                                   |
| Domain migration doc      | **Done** | `docs/DOMAIN_MIGRATION.md`                                |

## What blocks production

Two things, and they are the same thing:

1. **No GPU.** Every generation path is written and contract-tested, and none
   has produced a frame. Until a worker is attached, the honest statement is
   that the orchestration is built and the generation is unproven.
2. **The vision half of the judge ensemble.** Identity, face, hands, anatomy,
   physics, product and lip sync are registered and report themselves
   unavailable. The pipeline's protection against identity drift is currently
   preventative — keyframe-first routing, reference strength, canonical
   descriptions — with no detection behind it.

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
