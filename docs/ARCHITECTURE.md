# Architecture

## The shape of it

```
USER -> WEB -> API -> PROJECT / BRIEF
                        |
                   LOCAL DIRECTOR
                        |
              SCENE BIBLE -> SHOT PLANNER -> DEPENDENCY GRAPH
                        |
                   MODEL ROUTER
                        |
              DURABLE WORKFLOW ENGINE
                        |
                   GPU SCHEDULER
                        |
                  GPU WORKER (96 GB)
        Qwen Image / Wan T2V / I2V / S2V / Animate
        Qwen TTS / MMAudio / MuseTalk / Vision QC
                        |
                     JUDGES
                    /       \
                 PASS       FAIL -> REPAIR -+
                   |                        |
                   +------------------------+
                   |
                UPSCALE -> COMPOSITOR -> FINAL QC -> EXPORT
```

## Where the value is

Models are replaceable tools. When a better open-weight video model appears, it
becomes a new adapter, gets benchmarked, goes to canary, and the router points
at it. Nothing above the adapter changes.

What is not replaceable is the layer that makes several models behave like one
production: the Director, the Scene Bible, the dependency graph, the exact
timeline, the routing rules, the judges, the repair engine, and the benchmark
data that tells us which model is actually better.

## Decisions worth knowing

### Timing is integer, always

Video is addressed in frames, audio in samples, both against one project
timebase held as a rational (`24/1`, `24000/1001`). Seconds appear in exactly
two places: the user's input, where they are immediately quantised to frames,
and display.

Float seconds accumulate error, and the error shows up as lip sync drift over a
long project. Using integers over a rational timebase is not fastidiousness; it
is the difference between audio that stays locked at three minutes and audio
that does not.

### The Director plans, and only plans

It never generates media, and it never emits free text into a generator. Its
output is versioned structured JSON validated against the same Zod schema that
produced the JSON Schema it was constrained by, so the model's format and our
expectations cannot drift.

It also cannot invent capabilities: a snapshot of installed, licence-cleared
models and active skills goes into every prompt, and it may only reference what
is in it.

### Routing is data

`routing_rules` rows, not code branches. Changing how a talking shot is routed
is an update statement, not a deploy, and it needs no UI or database migration.
The router refuses rather than substituting: a shot that cannot be routed is an
error, not a quiet downgrade to something else.

### Licences gate everything, fail-closed

A model is usable only when someone reviewed its licence, that licence grants
commercial use, and someone promoted the version. Every other state, including
"we have not looked yet", denies. Open weights are not the same thing as a
worldwide commercial SaaS grant, and the registry is where that distinction
lives.

### There is no external fallback

If local compute is unavailable, generation fails. It does not quietly reach for
a hosted API. This is asserted by a test that scans source, lockfiles and Python
requirements for external generation providers and requires the count to be
zero, because the failure mode it guards against is gradual: one "temporary"
fallback, added under pressure, and the product is no longer self-hosted.

### Repair before regeneration

A shot that is right except for the mouth costs one lip sync pass, not a new
shot. The repair planner picks the smallest scope that can address the findings,
and every loop is bounded by attempts, GPU seconds and cost. Exhaustion produces
`needs_review`, which is a worse outcome than a good video and a far better one
than an invisible bill.

### Dependency invalidation is minimal

Changing a character marks exactly the shots that use that character, plus what
continues from them through a frame handoff. Sharing a location with a stale
shot is not a reason to regenerate.

### Assets are immutable

An asset id is a stable identity; `asset_versions` holds the bytes. Nothing is
overwritten, so a restore always has something to restore to and A/B comparison
between versions is free.

### The browser never reaches a GPU

`browser -> API -> workflow -> gateway -> worker`. Workers sit on an internal
network, accept only signed envelopes covering the request body, reject replays
and expired envelopes, and need no outbound internet access after provisioning.

## Package boundaries

| Package        | Responsibility                                            |
| -------------- | --------------------------------------------------------- |
| `contracts`    | Zod schemas; the single source of truth for every shape   |
| `config`       | environment parsing, no defaults for anything identifying |
| `timeline`     | rational timebase maths and timeline assembly             |
| `database`     | pooled service access and RLS-enforcing user access       |
| `storage`      | `StorageAdapter` over Supabase, S3 or local disk          |
| `models`       | registry reads, licence gate, router                      |
| `scene-bible`  | dependency graph and invalidation                         |
| `gpu-manager`  | providers, scheduler, reservations, signed gateway        |
| `director`     | Director adapter, planning pipeline, preflight            |
| `orchestrator` | Temporal workflows, activities, retry budgets             |
| `render`       | ffmpeg composition, captions, technical QC                |
| `api`          | the only surface a browser talks to                       |

Python runtimes share one contract in `workers/_sdk`, so a new model family is a
new container rather than a new integration.

## Processes

The table above lists packages. Four of them run as processes, and the rest are
libraries their callers import:

| Process        | What it is                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `api`          | Fastify. The browser's only surface, plus the `/internal/workers/*` endpoints a GPU host reports to |
| `orchestrator` | a Temporal worker running the production workflow                                                   |
| `gpu-manager`  | a maintenance loop: expiring stranded reservations, ageing out silent workers, suspending idle ones |
| `media`        | serves signed local media URLs; in the path only when `STORAGE_PROVIDER=local`, and required then   |

`director`, `render`, `qc` and the rest are libraries. They once had entries in
the compose file that built images whose command did not exist, which is the
kind of thing `tests/portability/deployment.spec.ts` now catches.

## What is not built yet

GPU-backed generation is implemented against the worker contract and is
unverified until hardware is attached. Those activities fail loudly with
`NoGpuWorker` rather than returning something plausible, because a stub that
looks like it works is worse than an error that says what is missing.

The vision half of the judge ensemble is registered and reports itself
unavailable; see `docs/PRODUCTION_GATE.md` for what that means in practice and
for everything else that is partial.
