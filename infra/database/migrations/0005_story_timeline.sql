-- Story structure and the master timeline.
-- All timing is integer: video in frames, audio in samples, against the
-- project timebase (spec section 18). No float seconds column exists here.

create table if not exists public.scripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create table if not exists public.script_versions (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references public.scripts(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  document jsonb not null,
  schema_version text not null,
  created_at timestamptz not null default now(),
  unique (script_id, version)
);

create table if not exists public.storyboards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (project_id)
);

create table if not exists public.storyboard_versions (
  id uuid primary key default gen_random_uuid(),
  storyboard_id uuid not null references public.storyboards(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  document jsonb not null,
  created_at timestamptz not null default now(),
  unique (storyboard_id, version)
);

create table if not exists public.scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  index integer not null,
  summary text not null default '',
  location_slug text,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

create table if not exists public.scene_versions (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  document jsonb not null,
  created_at timestamptz not null default now(),
  unique (scene_id, version)
);

create table if not exists public.shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scene_id uuid not null references public.scenes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  index integer not null,
  duration_frames bigint not null check (duration_frames > 0),
  shot_type text not null,
  preferred_generation_kind text not null,
  requires_identity_lock boolean not null default false,
  requires_product_fidelity boolean not null default false,
  motion_complexity numeric not null default 0.5 check (motion_complexity between 0 and 1),
  continuity_requirement numeric not null default 0.5 check (continuity_requirement between 0 and 1),
  -- Which asset version the project currently shows for this shot.
  current_asset_id uuid references public.assets(id) on delete set null,
  current_version integer not null default 1,
  -- Set when a dependency changed underneath this shot (spec section 15).
  stale boolean not null default false,
  stale_reasons text[] not null default '{}',
  status text not null default 'planned'
    check (status in ('planned', 'generating', 'qc', 'repairing', 'approved', 'failed', 'needs_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

create table if not exists public.shot_versions (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references public.shots(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  document jsonb not null,
  asset_id uuid references public.assets(id) on delete set null,
  quality_evaluation_id uuid,
  created_at timestamptz not null default now(),
  unique (shot_id, version)
);

-- The dependency graph. Invalidation walks these edges to find exactly the
-- shots that went stale, so one changed character does not regenerate a film.
create table if not exists public.shot_dependencies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shot_id uuid not null references public.shots(id) on delete cascade,
  kind text not null check (kind in (
    'character', 'product', 'location', 'voice', 'style',
    'shot_end_frame', 'shot_start_frame', 'dialogue'
  )),
  ref text not null,
  created_at timestamptz not null default now(),
  unique (shot_id, kind, ref)
);

create index if not exists shot_dependencies_lookup_idx
  on public.shot_dependencies (project_id, kind, ref);

create table if not exists public.timelines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  current_version integer not null default 1,
  frame_rate_num integer not null,
  frame_rate_den integer not null,
  audio_sample_rate integer not null,
  duration_frames bigint not null default 0,
  loudness_profile text not null default 'social',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create table if not exists public.timeline_versions (
  id uuid primary key default gen_random_uuid(),
  timeline_id uuid not null references public.timelines(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  document jsonb not null,
  created_at timestamptz not null default now(),
  unique (timeline_id, version)
);

create table if not exists public.timeline_tracks (
  id uuid primary key default gen_random_uuid(),
  timeline_id uuid not null references public.timelines(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  kind text not null check (kind in (
    'VIDEO', 'DIALOGUE', 'MUSIC', 'SFX', 'AMBIENCE', 'ROOM_TONE', 'CAPTIONS'
  )),
  index integer not null,
  muted boolean not null default false,
  unique (timeline_id, slug)
);

create table if not exists public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  timeline_id uuid not null references public.timelines(id) on delete cascade,
  track_id uuid not null references public.timeline_tracks(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  kind text not null check (kind in ('video', 'audio', 'caption')),
  asset_id uuid references public.assets(id) on delete set null,
  shot_id uuid references public.shots(id) on delete set null,
  scene_id uuid references public.scenes(id) on delete set null,
  -- Video events use frames; audio and caption events use samples. Exactly one
  -- pair is populated, enforced below.
  start_frame bigint,
  end_frame bigint,
  source_start_frame bigint,
  start_sample bigint,
  end_sample bigint,
  source_start_sample bigint,
  gain_db numeric not null default 0,
  fade_in_samples bigint not null default 0,
  fade_out_samples bigint not null default 0,
  pan numeric not null default 0 check (pan between -1 and 1),
  ducking_group text,
  text_content text,
  created_at timestamptz not null default now(),
  unique (timeline_id, slug),
  constraint timeline_events_clock_check check (
    (kind = 'video'
       and start_frame is not null and end_frame is not null and end_frame > start_frame
       and start_sample is null and end_sample is null)
    or (kind in ('audio', 'caption')
       and start_sample is not null and end_sample is not null and end_sample > start_sample
       and start_frame is null and end_frame is null)
  ),
  constraint timeline_events_caption_text check (kind <> 'caption' or text_content is not null)
);

create index if not exists timeline_events_track_idx on public.timeline_events (track_id, start_frame, start_sample);

-- Word-level alignment of the final dialogue audio. Captions and lip sync both
-- read from here, never from the original script (spec section 21).
create table if not exists public.dialogue_alignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dialogue_line_id text not null,
  asset_id uuid not null references public.assets(id) on delete cascade,
  audio_sample_rate integer not null,
  words jsonb not null default '[]'::jsonb,
  phonemes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, dialogue_line_id, asset_id)
);

create trigger scenes_updated_at before update on public.scenes
  for each row execute function app.set_updated_at();
create trigger shots_updated_at before update on public.shots
  for each row execute function app.set_updated_at();
create trigger timelines_updated_at before update on public.timelines
  for each row execute function app.set_updated_at();
create trigger scripts_updated_at before update on public.scripts
  for each row execute function app.set_updated_at();

alter table public.scripts enable row level security;
alter table public.script_versions enable row level security;
alter table public.storyboards enable row level security;
alter table public.storyboard_versions enable row level security;
alter table public.scenes enable row level security;
alter table public.scene_versions enable row level security;
alter table public.shots enable row level security;
alter table public.shot_versions enable row level security;
alter table public.shot_dependencies enable row level security;
alter table public.timelines enable row level security;
alter table public.timeline_versions enable row level security;
alter table public.timeline_tracks enable row level security;
alter table public.timeline_events enable row level security;
alter table public.dialogue_alignments enable row level security;
