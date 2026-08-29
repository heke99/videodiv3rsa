# Video AI

A self-hosted AI production studio. Several open-weight models — Wan2.2 for
video, Qwen Image for stills, Qwen3-TTS for speech, MMAudio for sound, MuseTalk
for lip sync repair — are coordinated by a local Director, a Scene Bible, an
exact timeline, a model router, quality judges and a repair engine, so they
behave like one coherent film production rather than a row of demos.

No generation goes to an external API. There is no fallback that does.

## Status

Batches 1 to 5 of the build plan are implemented: foundation, GPU platform,
Wan runtime, media specialists, and the Director with its planning pipeline.
Batches 6 to 12 — the timeline editor, the full skill catalogue, the judge
ensemble, the admin UI and the benchmark suite — have their boundaries defined
and are follow-on work.

GPU-backed generation is written against the worker contract and is unverified
until hardware is attached. Those paths fail with a clear error rather than
returning something that looks like a result.

## Getting started

```bash
pnpm install
cp .env.example .env      # fill it in; nothing has a default
pnpm db:migrate
pnpm test
```

Local stack:

```bash
docker compose -f infra/docker/compose.dev.yml up
```

GPU host — see [docs/GPU_MIGRATION.md](docs/GPU_MIGRATION.md):

```bash
docker compose -f infra/gpu/compose.worker.yml up -d
```

## Tests

```bash
pnpm test               # everything
pnpm test:unit          # contracts, timebase, routing, budgets, Director
pnpm test:security      # no external providers, upload validation, RLS
pnpm test:portability   # no hardcoded domain, provider, bucket or model path
.venv/bin/python -m pytest tests/gpu   # worker contract, no GPU required
```

Two of these are standing guarantees rather than ordinary tests.
`test:security` asserts that the count of external generation providers is
zero, across source, lockfiles and Python requirements. `test:portability`
asserts that no domain, GPU provider endpoint, bucket hostname or absolute
model path appears in application code. Both exist because the properties they
protect erode quietly, one reasonable-seeming change at a time.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — how the pieces fit and why
- [Moving to a different GPU](docs/GPU_MIGRATION.md)
- [Moving to a different domain](docs/DOMAIN_MIGRATION.md)
- [Disaster recovery](docs/DISASTER_RECOVERY.md)
