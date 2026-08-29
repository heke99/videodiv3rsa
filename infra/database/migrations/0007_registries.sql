-- Model, licence, routing and skill registries.
--
-- These are platform-global rather than tenant-scoped: users read them, only
-- platform staff write them. A user being able to edit routing or licence
-- status would let them route themselves to an unapproved model, so the write
-- side is closed to everyone but staff and the service credential.

create table if not exists public.model_registry (
  model_id text primary key,
  family text not null,
  display_name text not null,
  kind text not null check (kind in (
    'video', 'image', 'tts', 'audio', 'lipsync', 'alignment', 'vision', 'reasoning', 'upscaler', 'interpolation'
  )),
  adapter text not null,
  runtime text not null,
  upstream_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.model_licenses (
  id uuid primary key default gen_random_uuid(),
  model_id text not null references public.model_registry(model_id) on delete cascade,
  license_name text not null,
  license_url text,
  commercial_use boolean not null default false,
  territories text[] not null default '{}',
  attribution_required boolean not null default false,
  restrictions text[] not null default '{}',
  reviewed_at timestamptz,
  reviewed_by text,
  -- Only 'approved' may be routed to. Anything else is fail-closed.
  status text not null default 'unknown'
    check (status in ('unknown', 'pending_review', 'approved', 'blocked', 'expired_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (model_id)
);

create table if not exists public.model_versions (
  id uuid primary key default gen_random_uuid(),
  model_id text not null references public.model_registry(model_id) on delete cascade,
  version text not null,
  lifecycle text not null default 'candidate' check (lifecycle in (
    'candidate', 'testing', 'benchmarking', 'approved', 'canary',
    'production', 'deprecated', 'license_blocked', 'disabled'
  )),
  required_profile text not null check (required_profile in (
    'GPU_PROFILE_ECONOMY', 'GPU_PROFILE_STANDARD', 'GPU_PROFILE_HIGH', 'GPU_PROFILE_ULTRA'
  )),
  required_vram_gib numeric not null,
  supported_precisions text[] not null default '{bf16}',
  -- Fraction of traffic for a canary rollout; rollback is setting this to 0.
  canary_weight numeric not null default 0 check (canary_weight between 0 and 1),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (model_id, version)
);

create table if not exists public.model_capabilities (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.model_versions(id) on delete cascade,
  generation_kind text not null check (generation_kind in (
    'text_to_video', 'image_to_video', 'speech_to_video', 'character_animation',
    'image', 'text_to_speech', 'video_to_audio', 'lipsync', 'alignment', 'vision_qc', 'reasoning', 'upscale'
  )),
  max_duration_frames bigint not null default 0,
  supported_resolutions jsonb not null default '[]'::jsonb,
  accepts_reference_images boolean not null default false,
  accepts_driving_audio boolean not null default false,
  produces_audio boolean not null default false,
  unique (model_version_id, generation_kind)
);

-- Model files on the persistent volume. The runtime never downloads; it only
-- verifies against these hashes (spec section 53).
create table if not exists public.model_artifacts (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.model_versions(id) on delete cascade,
  file text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null,
  source text not null,
  downloaded_at timestamptz,
  verified_at timestamptz,
  unique (model_version_id, file)
);

-- Routing rules as data, so routing changes without a deploy (spec section 17).
create table if not exists public.routing_rules (
  id text primary key,
  priority integer not null,
  enabled boolean not null default true,
  match jsonb not null default '{}'::jsonb,
  target jsonb not null,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.model_benchmarks (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.model_versions(id) on delete cascade,
  suite text not null,
  prompt_id text not null,
  metrics jsonb not null default '{}'::jsonb,
  runtime_ms bigint,
  peak_vram_bytes bigint,
  asset_id uuid references public.assets(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.skill_registry (
  skill_id text primary key,
  name text not null,
  category text not null check (category in (
    'planning', 'prompt', 'cinematic', 'realism', 'identity', 'motion',
    'ugc', 'audio', 'quality', 'repair', 'operations', 'governance'
  )),
  description text not null,
  status text not null default 'active' check (status in ('draft', 'active', 'deprecated', 'disabled')),
  current_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.skill_versions (
  id uuid primary key default gen_random_uuid(),
  skill_id text not null references public.skill_registry(skill_id) on delete cascade,
  version text not null,
  input_schema jsonb,
  output_schema jsonb,
  required_tools text[] not null default '{}',
  supported_models text[] not null default '{}',
  requires_skills text[] not null default '{}',
  quality_profile text not null default 'STANDARD',
  timeout_seconds integer not null default 120,
  max_retries integer not null default 1,
  license text not null default 'proprietary',
  -- Content hash of the skill package so registry and filesystem cannot drift.
  package_hash text,
  created_at timestamptz not null default now(),
  unique (skill_id, version)
);

create table if not exists public.skill_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete cascade,
  skill_id text not null,
  skill_version text not null,
  status text not null check (status in ('pass', 'fail', 'error', 'skipped')),
  confidence numeric,
  latency_ms integer,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Skill evals gate version promotion (spec section 86): 1.4 does not replace
-- 1.3 until the eval shows an improvement.
create table if not exists public.skill_evaluations (
  id uuid primary key default gen_random_uuid(),
  skill_id text not null references public.skill_registry(skill_id) on delete cascade,
  skill_version text not null,
  suite text not null,
  score numeric not null,
  retry_delta numeric,
  latency_delta_ms integer,
  gpu_delta_seconds numeric,
  passed boolean not null,
  created_at timestamptz not null default now()
);

create trigger model_registry_updated_at before update on public.model_registry
  for each row execute function app.set_updated_at();
create trigger model_licenses_updated_at before update on public.model_licenses
  for each row execute function app.set_updated_at();
create trigger model_versions_updated_at before update on public.model_versions
  for each row execute function app.set_updated_at();
create trigger routing_rules_updated_at before update on public.routing_rules
  for each row execute function app.set_updated_at();
create trigger skill_registry_updated_at before update on public.skill_registry
  for each row execute function app.set_updated_at();

alter table public.model_registry enable row level security;
alter table public.model_licenses enable row level security;
alter table public.model_versions enable row level security;
alter table public.model_capabilities enable row level security;
alter table public.model_artifacts enable row level security;
alter table public.routing_rules enable row level security;
alter table public.model_benchmarks enable row level security;
alter table public.skill_registry enable row level security;
alter table public.skill_versions enable row level security;
alter table public.skill_runs enable row level security;
alter table public.skill_evaluations enable row level security;
