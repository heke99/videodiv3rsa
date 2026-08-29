-- Projects and the Scene Bible. The Scene Bible is canonical truth for visual
-- identity (spec section 11); entities are versioned so that changing a
-- character is an explicit, traceable event that can invalidate dependent shots.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'planning', 'generating', 'review', 'completed', 'archived', 'failed')),
  quality_mode text not null default 'STANDARD',
  aspect_ratio text not null default '9:16',
  -- Project timebase. All video and audio in the project resolve against this.
  frame_rate_num integer not null default 24,
  frame_rate_den integer not null default 1,
  audio_sample_rate integer not null default 48000,
  target_duration_frames bigint not null default 0,
  current_version integer not null default 1,
  thumbnail_asset_id uuid references public.assets(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_frame_rate_positive check (frame_rate_num > 0 and frame_rate_den > 0)
);

alter table public.assets
  add constraint assets_project_fk foreign key (project_id)
  references public.projects(id) on delete cascade;

create table if not exists public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  brief jsonb,
  label text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create table if not exists public.project_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  approval_gates boolean not null default false,
  loudness_profile text not null default 'social',
  retry_budget jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Scene Bible container, versioned as a whole so a project can be rolled back
-- to a coherent set of entities rather than a mix of versions.
create table if not exists public.scene_bibles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create table if not exists public.scene_bible_versions (
  id uuid primary key default gen_random_uuid(),
  scene_bible_id uuid not null references public.scene_bibles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  document jsonb not null,
  schema_version text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (scene_bible_id, version)
);

-- Entities are also stored relationally, because dependency invalidation and
-- the asset library need to query them without unpacking the whole document.

-- Voice identity persists across shots and projects so a character sounds the
-- same everywhere (spec section 6).
create table if not exists public.voice_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  slug text not null,
  speaker_profile text not null,
  language text not null,
  accent text not null default '',
  style text not null default '',
  voice_model text not null,
  model_version text not null,
  seed bigint not null,
  speech_rate numeric not null default 1,
  reference_asset_ids uuid[] not null default '{}',
  -- A cloned voice cannot be used without a recorded rights declaration.
  rights_declaration_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, slug)
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  slug text not null,
  label text not null,
  current_version integer not null default 1,
  voice_profile_id uuid references public.voice_profiles(id) on delete set null,
  is_library_entity boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, slug)
);

create table if not exists public.character_versions (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  document jsonb not null,
  created_at timestamptz not null default now(),
  unique (character_id, version)
);

create table if not exists public.character_references (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  view_kind text not null,
  asset_id uuid not null references public.assets(id) on delete cascade,
  -- Generated reference views become canonical only after QC (spec section 12).
  qc_status text not null default 'pending'
    check (qc_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (character_id, view_kind, asset_id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  slug text not null,
  label text not null,
  current_version integer not null default 1,
  is_library_entity boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, slug)
);

create table if not exists public.product_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  document jsonb not null,
  created_at timestamptz not null default now(),
  unique (product_id, version)
);

create table if not exists public.product_references (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  view_kind text not null,
  asset_id uuid not null references public.assets(id) on delete cascade,
  qc_status text not null default 'pending'
    check (qc_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (product_id, view_kind, asset_id)
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  slug text not null,
  label text not null,
  current_version integer not null default 1,
  is_library_entity boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, slug)
);

create table if not exists public.location_versions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  document jsonb not null,
  created_at timestamptz not null default now(),
  unique (location_id, version)
);

create table if not exists public.style_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  slug text not null,
  document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, slug)
);

create trigger projects_updated_at before update on public.projects
  for each row execute function app.set_updated_at();
create trigger scene_bibles_updated_at before update on public.scene_bibles
  for each row execute function app.set_updated_at();
create trigger characters_updated_at before update on public.characters
  for each row execute function app.set_updated_at();
create trigger products_updated_at before update on public.products
  for each row execute function app.set_updated_at();
create trigger locations_updated_at before update on public.locations
  for each row execute function app.set_updated_at();
create trigger voice_profiles_updated_at before update on public.voice_profiles
  for each row execute function app.set_updated_at();

alter table public.projects enable row level security;
alter table public.project_versions enable row level security;
alter table public.project_settings enable row level security;
alter table public.scene_bibles enable row level security;
alter table public.scene_bible_versions enable row level security;
alter table public.characters enable row level security;
alter table public.character_versions enable row level security;
alter table public.character_references enable row level security;
alter table public.products enable row level security;
alter table public.product_versions enable row level security;
alter table public.product_references enable row level security;
alter table public.locations enable row level security;
alter table public.location_versions enable row level security;
alter table public.style_profiles enable row level security;
alter table public.voice_profiles enable row level security;
