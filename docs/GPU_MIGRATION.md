# Moving to a different GPU

The goal of this document is that a competent operator can move production onto
new hardware without reading any application code. If a step here requires
understanding how the Director or the timeline works, that step is a bug in the
architecture, not in this document.

Nothing below involves a code change or a database migration. Workers are
described by capability, so a different card is a different row.

## What must be true first

- The new host has an NVIDIA GPU, a current driver, and the container toolkit
  installed (`docker run --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`
  must print your card).
- The host can reach the control plane over HTTPS. It does **not** need inbound
  access from the internet, and after provisioning it does not need general
  outbound access either.
- You have a copy of the model volume, or network access to clone one. Weights
  are large; copying them is usually the longest step and is worth starting
  first.

## Capability profiles

Product logic never asks for a card by name. It asks for a profile:

| Profile                | VRAM  | What it can serve                               |
| ---------------------- | ----- | ----------------------------------------------- |
| `GPU_PROFILE_ECONOMY`  | 24 GB | TTS, MMAudio, MuseTalk, alignment               |
| `GPU_PROFILE_STANDARD` | 48 GB | image generation, smaller video models          |
| `GPU_PROFILE_HIGH`     | 80 GB | Wan S2V and Animate                             |
| `GPU_PROFILE_ULTRA`    | 96 GB | the full Wan A14B family, our production target |

The supervisor classifies the host automatically and rounds **down**: a 70 GB
card registers as STANDARD, not HIGH, because advertising capacity the card does
not have means jobs get scheduled and then die out of memory.

A larger profile can always serve a smaller requirement. The reverse never
happens.

## Procedure

### 1. Provision the host

```bash
# On the new host
mkdir -p /srv/videoai/models
```

Attach or copy the model volume to `/srv/videoai/models`. If copying from an
existing worker, preserve the layout exactly; the hashes are checked against
relative paths.

### 2. Configure the worker

Create `/srv/videoai/.env` on the host:

```bash
WORKER_ID=worker-<something-stable-and-unique>
WORKER_ENDPOINT=http://<host-address>:8080
GPU_CONTROL_PLANE_URL=https://<your-api-host>
GPU_WORKER_TOKEN=<scoped worker credential, not a user token>
GPU_GATEWAY_SIGNING_KEY=<same value as the control plane>
MODEL_VOLUME=/srv/videoai/models
REGISTRY=<your container registry>
IMAGE_TAG=<the tag currently in production>
GPU_PROVIDER=manual
WAN_MODEL_ARTIFACTS=<path=sha256 pairs, comma separated>
```

`WORKER_ID` must be stable across restarts: it is how usage, reservations and
health are attributed.

### 3. Start the runtimes

```bash
docker compose --env-file /srv/videoai/.env \
  -f infra/gpu/compose.worker.yml up -d
```

Each model family is its own container with its own pinned dependencies, so a
failure in one runtime does not take the others down.

### 4. Capability scan

The supervisor registers the host and reports what it found. Confirm:

```bash
docker compose -f infra/gpu/compose.worker.yml logs supervisor | tail -20
```

You are looking for a profile classification and a GPU count. If it reports
`nvidia-smi not found` or a profile of `null`, stop here: the container toolkit
is not wired up correctly and nothing below will work.

### 5. Verify the model cache

Each runtime verifies its own artifacts against the recorded hashes on startup
and **refuses to serve** if anything is missing or altered. A runtime that
starts is a runtime whose weights are the approved ones.

```bash
docker compose -f infra/gpu/compose.worker.yml logs runtime-wan | grep -i artifact
```

A hash mismatch here almost always means an incomplete copy. Re-copy rather
than deleting the check.

### 6. Health and smoke test

```bash
curl -s http://<host>:8080/health | jq
curl -s http://<host>:8080/capabilities | jq
```

Then run the golden smoke generation from the control plane. This is a real
generation against a known prompt, and its output is compared against the
recorded baseline for that model version.

### 7. Benchmark

Run the golden benchmark suite against the new worker before it takes traffic.
Compare runtime, peak VRAM and quality scores against the outgoing worker. A
new host that is faster but scores worse is not an upgrade.

### 8. Mark ready and shift traffic

```sql
update public.gpu_workers set lifecycle = 'READY' where worker_id = '<new>';
```

The scheduler picks it up on the next selection pass. Watch the first few jobs
land before continuing.

### 9. Drain the old worker

```sql
update public.gpu_workers set drain_requested = true, lifecycle = 'DRAINING'
where worker_id = '<old>';
```

Draining stops new work and lets running jobs finish. Wait for its reservations
to clear:

```sql
select count(*) from public.gpu_reservations
where worker_id = '<old>' and status = 'held';
```

Only then stop its containers.

## Rolling back

Reverse steps 8 and 9. The old worker's model volume and registry row are
untouched by the migration, so rollback is setting `drain_requested = false` and
`lifecycle = 'READY'` on the old worker and draining the new one. No data moves.

## What can go wrong

**The worker registers but never gets work.** Check `last_seen_at`: the
scheduler ignores anything without a heartbeat in the last 120 seconds. Then
check the profile actually covers what the routing rules ask for.

**Jobs fail out of memory on a card that should fit.** The profile is a
classification, not a reservation. Check whether another process on the host is
holding VRAM, and check `gpu_reservations` for leaked holds from a crashed job
(they expire, but a short TTL and a long job can overlap).

**Generations succeed but quality dropped.** Compare precision. A card that does
not support FP8 is classified without it, and a model that ran FP8 elsewhere
will run BF16 here — slower, and different, though not worse.
