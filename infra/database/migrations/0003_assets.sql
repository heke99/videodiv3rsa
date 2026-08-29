-- Assets. Original media is never overwritten (spec section 62): an asset row
-- is a stable identity and asset_versions holds the immutable bytes, with the
-- asset pointing at whichever version is current.

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  kind text not null check (kind in (
    'image', 'video', 'audio', 'voice_reference', 'caption', 'document', 'render'
  )),
  role text,
  label text,
  current_version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  -- Content addressed. The user's filename is metadata, never a storage path.
  storage_key text not null,
  storage_provider text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  mime text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  original_filename text,
  width integer,
  height integer,
  -- Media timing is integer, against the asset's own rate.
  frame_count bigint,
  frame_rate_num integer,
  frame_rate_den integer,
  duration_samples bigint,
  audio_sample_rate integer,
  audio_channels integer,
  video_codec text,
  audio_codec text,
  pixel_format text,
  generation_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (asset_id, version)
);

create index if not exists asset_versions_sha_idx on public.asset_versions (organization_id, sha256);
create index if not exists assets_project_idx on public.assets (project_id) where deleted_at is null;

create table if not exists public.asset_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_asset_id uuid not null references public.assets(id) on delete cascade,
  child_asset_id uuid not null references public.assets(id) on delete cascade,
  relationship text not null check (relationship in (
    'derived_from', 'upscaled_from', 'repaired_from', 'reference_for',
    'keyframe_of', 'alignment_of', 'thumbnail_of'
  )),
  created_at timestamptz not null default now(),
  unique (parent_asset_id, child_asset_id, relationship)
);

create trigger assets_updated_at before update on public.assets
  for each row execute function app.set_updated_at();

alter table public.assets enable row level security;
alter table public.asset_versions enable row level security;
alter table public.asset_relationships enable row level security;
