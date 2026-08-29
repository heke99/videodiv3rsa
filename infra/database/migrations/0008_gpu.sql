-- GPU fleet. Workers are described by capability, never by product name, so a
-- move to different hardware is a registry change rather than a code change.

create table if not exists public.gpu_workers (
  worker_id text primary key,
  provider text not null,
  provider_ref text not null,
  endpoint text not null,
  lifecycle text not null default 'OFF' check (lifecycle in (
    'OFF', 'STARTING', 'PROVISIONING', 'READY', 'BUSY', 'IDLE', 'DRAINING', 'UNHEALTHY'
  )),
  profile text not null check (profile in (
    'GPU_PROFILE_ECONOMY', 'GPU_PROFILE_STANDARD', 'GPU_PROFILE_HIGH', 'GPU_PROFILE_ULTRA'
  )),
  vram_total_bytes bigint not null default 0,
  vram_free_bytes bigint not null default 0,
  cuda_version text,
  driver_version text,
  compute_capability text,
  gpu_count integer not null default 0,
  supported_precisions text[] not null default '{}',
  temperature_c numeric,
  utilization_pct numeric,
  queue_depth integer not null default 0,
  healthy boolean not null default false,
  drain_requested boolean not null default false,
  last_seen_at timestamptz,
  started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gpu_worker_capabilities (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null references public.gpu_workers(worker_id) on delete cascade,
  capability text not null,
  detail jsonb not null default '{}'::jsonb,
  unique (worker_id, capability)
);

-- Which model artifacts a worker actually has on disk and has verified.
create table if not exists public.gpu_worker_models (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null references public.gpu_workers(worker_id) on delete cascade,
  model_id text not null references public.model_registry(model_id) on delete cascade,
  model_version text not null,
  present boolean not null default false,
  verified boolean not null default false,
  loaded boolean not null default false,
  verified_at timestamptz,
  unique (worker_id, model_id, model_version)
);

create table if not exists public.gpu_sessions (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null references public.gpu_workers(worker_id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  boot_seconds numeric,
  idle_seconds numeric,
  busy_seconds numeric,
  end_reason text
);

create table if not exists public.gpu_reservations (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null references public.gpu_workers(worker_id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  vram_bytes bigint not null,
  status text not null default 'held' check (status in ('held', 'released', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz
);

create index if not exists gpu_reservations_active_idx
  on public.gpu_reservations (worker_id) where status = 'held';

create trigger gpu_workers_updated_at before update on public.gpu_workers
  for each row execute function app.set_updated_at();

alter table public.gpu_workers enable row level security;
alter table public.gpu_worker_capabilities enable row level security;
alter table public.gpu_worker_models enable row level security;
alter table public.gpu_sessions enable row level security;
alter table public.gpu_reservations enable row level security;
