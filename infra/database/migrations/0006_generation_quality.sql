-- Generation jobs, provenance, quality evaluations and repair.

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  workflow_id text,
  run_id text,
  status text not null default 'queued' check (status in (
    'queued', 'preflight', 'planning', 'generating_script', 'generating_audio',
    'generating_references', 'reference_qc', 'generating_shots', 'shot_qc',
    'repairing', 'syncing', 'audio_generation', 'audio_qc', 'upscaling',
    'final_render', 'final_qc', 'completed', 'failed', 'cancelled', 'needs_review'
  )),
  quality_mode text not null default 'STANDARD',
  -- Bounded retries (spec section 36). Exhaustion means needs_review.
  retry_budget jsonb not null default '{}'::jsonb,
  budget_spend jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  cancel_requested boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workflow_id, run_id)
);

create index if not exists generation_jobs_project_idx on public.generation_jobs (project_id, created_at desc);

create table if not exists public.generation_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage text not null,
  unit_id text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')),
  -- Checkpoint payload so a crash resumes at this unit rather than the start.
  inputs_hash text,
  checkpoint jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, stage, unit_id)
);

create table if not exists public.generation_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shot_id uuid references public.shots(id) on delete cascade,
  attempt integer not null,
  -- Idempotency key: a retried activity with the same key never generates twice.
  idempotency_key text not null,
  model_id text not null,
  model_version text not null,
  adapter text not null,
  worker_id text,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  -- Full reproducibility record (spec section 64).
  provenance jsonb not null default '{}'::jsonb,
  runtime_ms bigint,
  peak_vram_bytes bigint,
  gpu_seconds numeric,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organization_id, idempotency_key)
);

create table if not exists public.generation_outputs (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.generation_attempts(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  output_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.asset_versions
  add constraint asset_versions_generation_fk foreign key (generation_id)
  references public.generation_attempts(id) on delete set null;

create table if not exists public.quality_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('shot', 'scene', 'reference', 'audio', 'final')),
  subject_id text not null,
  asset_id uuid references public.assets(id) on delete set null,
  quality_profile text not null,
  overall numeric not null check (overall between 0 and 1),
  passed boolean not null,
  created_at timestamptz not null default now()
);

-- Per-dimension scores kept separately (spec section 33): a single total is
-- never enough to choose a repair scope.
create table if not exists public.quality_metrics (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.quality_evaluations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dimension text not null,
  score numeric not null check (score between 0 and 1),
  threshold numeric,
  passed boolean not null,
  unique (evaluation_id, dimension)
);

create table if not exists public.quality_findings (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.quality_evaluations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  judge_id text not null,
  judge_version text not null,
  code text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  message text not null default '',
  frames bigint[] not null default '{}',
  entity_ref text,
  created_at timestamptz not null default now()
);

alter table public.shot_versions
  add constraint shot_versions_quality_fk foreign key (quality_evaluation_id)
  references public.quality_evaluations(id) on delete set null;

create table if not exists public.repair_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  evaluation_id uuid references public.quality_evaluations(id) on delete set null,
  subject_id text not null,
  -- The planner must pick the smallest scope that can address the findings.
  scope text not null check (scope in (
    'none', 'lipsync', 'audio', 'timing', 'frame', 'keyframe',
    'shot', 'scene', 'dependent_shots', 'project'
  )),
  document jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.repair_attempts (
  id uuid primary key default gen_random_uuid(),
  repair_plan_id uuid not null references public.repair_plans(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  attempt integer not null,
  action text not null,
  target_id text not null,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'abandoned')),
  result_asset_id uuid references public.assets(id) on delete set null,
  evaluation_id uuid references public.quality_evaluations(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Human calibration set for the judges (spec section 34). Judge scores are not
-- treated as truth until they correlate with these.
create table if not exists public.human_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  evaluation_id uuid references public.quality_evaluations(id) on delete set null,
  human_score numeric not null check (human_score between 0 and 1),
  failure_labels text[] not null default '{}',
  rated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create trigger generation_jobs_updated_at before update on public.generation_jobs
  for each row execute function app.set_updated_at();

alter table public.generation_jobs enable row level security;
alter table public.generation_steps enable row level security;
alter table public.generation_attempts enable row level security;
alter table public.generation_outputs enable row level security;
alter table public.quality_evaluations enable row level security;
alter table public.quality_metrics enable row level security;
alter table public.quality_findings enable row level security;
alter table public.repair_plans enable row level security;
alter table public.repair_attempts enable row level security;
alter table public.human_evaluations enable row level security;
