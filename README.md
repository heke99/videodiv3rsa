# Video AI

A self-hosted AI production studio. Several open-weight models — Wan2.2 for
video, Qwen Image for stills, Qwen3-TTS for speech, MMAudio for sound, MuseTalk
for lip sync repair — are coordinated by a local Director, a Scene Bible, an
exact timeline, a model router, quality judges and a repair engine, so they
behave like one coherent film production rather than a row of demos.

No generation goes to an external API. There is no fallback that does.

## Status

All twelve batches of the build plan are implemented. See
[docs/PRODUCTION_GATE.md](docs/PRODUCTION_GATE.md) for the Definition of Done
with each item marked done, blocked on hardware, or not built.

Two things block production, and they are the same thing: no GPU is attached,
so every generation path is written and contract-tested but has never produced
a frame; and the vision half of the judge ensemble needs that GPU, so identity,
hands and lip sync are registered and report themselves unavailable rather than
returning a score nobody measured.

Everything that does not need hardware is built and verified: the exact
timebase, the Director and its planning pipeline, the skill engine and
catalogue, the measured judges, the repair engine, the web and admin apps, and
row level security checked against a live database.

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
pnpm test               # everything except e2e
pnpm test:unit          # contracts, timebase, routing, budgets, Director, skills
pnpm test:quality       # judges against deliberately degraded fixtures
pnpm test:security      # no external providers, upload validation
pnpm test:portability   # no hardcoded domain, provider, bucket or model path
pnpm test:e2e           # the built app in a real browser
.venv/bin/python -m pytest tests/gpu   # worker contract, no GPU required
psql "$DATABASE_URL" -f tests/security/rls.sql   # 29 policy checks, rolls back
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
