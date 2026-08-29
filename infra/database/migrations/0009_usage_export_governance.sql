-- Usage accounting, exports, and governance (rights, retention, audit).

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  project_id uuid references public.projects(id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete cascade,
  shot_id uuid references public.shots(id) on delete cascade,
  worker_id text,
  model_id text,
  kind text not null check (kind in (
    'worker_boot', 'worker_idle', 'model_load', 'generation', 'upscale', 'qc', 'render'
  )),
  gpu_seconds numeric not null default 0,
  cost_units numeric not null default 0,
  occurred_at timestamptz not null default now()
);

create index if not exists usage_events_org_time_idx on public.usage_events (organization_id, occurred_at desc);
create index if not exists usage_events_job_idx on public.usage_events (job_id);

create table if not exists public.usage_rollups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  granularity text not null check (granularity in ('day', 'month')),
  dimension text not null,
  dimension_value text not null,
  gpu_seconds numeric not null default 0,
  cost_units numeric not null default 0,
  approved_video_frames bigint not null default 0,
  unique (organization_id, period_start, granularity, dimension, dimension_value)
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delta numeric not null,
  balance_after numeric not null,
  reason text not null,
  job_id uuid references public.generation_jobs(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan text not null,
  status text not null,
  monthly_credit_grant numeric not null default 0,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.renders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete set null,
  timeline_version integer not null,
  status text not null default 'queued'
    check (status in ('queued', 'rendering', 'completed', 'failed')),
  asset_id uuid references public.assets(id) on delete set null,
  loudness_profile text not null default 'social',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  render_id uuid not null references public.renders(id) on delete cascade,
  aspect_ratio text not null,
  width integer not null,
  height integer not null,
  container text not null default 'mp4',
  video_codec text not null default 'h264',
  audio_codec text not null default 'aac',
  burned_captions boolean not null default false,
  asset_id uuid references public.assets(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.downloads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  export_id uuid not null references public.exports(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Rights and consent. A face or voice cannot be used without a declaration
-- (spec section 75).
create table if not exists public.rights_declarations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  rights_type text not null check (rights_type in (
    'face_likeness', 'voice_clone', 'copyrighted_product', 'private_footage', 'music'
  )),
  declared_by uuid not null references auth.users(id) on delete restrict,
  declared_at timestamptz not null default now(),
  scope text not null,
  evidence_asset_id uuid references public.assets(id) on delete set null
);

alter table public.voice_profiles
  add constraint voice_profiles_rights_fk foreign key (rights_declaration_id)
  references public.rights_declarations(id) on delete restrict;

create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_reference text not null,
  consent_type text not null,
  granted boolean not null,
  evidence_asset_id uuid references public.assets(id) on delete set null,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now()
);

create table if not exists public.retention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  scope text not null check (scope in ('generated_assets', 'uploads', 'renders', 'logs')),
  retain_days integer not null check (retain_days > 0),
  created_at timestamptz not null default now(),
  unique (organization_id, scope)
);

create table if not exists public.deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  target_kind text not null check (target_kind in ('project', 'account', 'organization', 'asset')),
  target_id uuid not null,
  status text not null default 'requested' check (status in (
    'requested', 'soft_blocked', 'deleting_assets', 'deleting_derived',
    'removing_references', 'tombstoned', 'completed', 'failed'
  )),
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text
);

-- Audit trail. Deliberately stores references and codes, not media payloads.
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'service', 'system')),
  action text not null,
  target_kind text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_org_time_idx on public.audit_events (organization_id, created_at desc);

create table if not exists public.generation_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  attempt_id uuid references public.generation_attempts(id) on delete set null,
  verdict text not null check (verdict in ('thumbs_up', 'thumbs_down')),
  rating integer check (rating between 1 and 5),
  failure_reason text,
  -- Feedback informs analysis only; it never becomes training data implicitly
  -- (spec section 88).
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function app.set_updated_at();

alter table public.usage_events enable row level security;
alter table public.usage_rollups enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.renders enable row level security;
alter table public.exports enable row level security;
alter table public.downloads enable row level security;
alter table public.rights_declarations enable row level security;
alter table public.consents enable row level security;
alter table public.retention_policies enable row level security;
alter table public.deletion_jobs enable row level security;
alter table public.audit_events enable row level security;
alter table public.generation_feedback enable row level security;
