-- Durable work log: manual prompt runs and work-progress uploads, each with a JPEG.
-- Replaces the in-memory run store. Metadata lives in prompt_runs; JPEG bytes live in
-- the `live-kit` storage bucket and are only served through Next.js routes.
-- Does not weaken Phase 1 default-deny RLS. Service-role remains the only access path.

create table if not exists public.prompt_runs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  kind text not null default 'run',
  prompt_version integer,
  prompt_snapshot text,
  executed_by text not null,
  status text,
  notes text not null default '',
  image_path text not null,
  created_at timestamptz not null default now(),
  constraint prompt_runs_kind_allowed check (kind in ('run', 'progress')),
  constraint prompt_runs_status_allowed
    check (status is null or status in ('success', 'failure')),
  constraint prompt_runs_run_requires_version
    check (kind <> 'run' or (prompt_version is not null and status is not null)),
  constraint prompt_runs_executed_by_nonempty check (char_length(trim(executed_by)) > 0)
);

create index if not exists prompt_runs_room_created_idx
  on public.prompt_runs (room_id, created_at desc);

create index if not exists prompt_runs_room_executed_by_idx
  on public.prompt_runs (room_id, executed_by);

alter table public.prompt_runs enable row level security;
revoke all on table public.prompt_runs from anon, authenticated;

comment on table public.prompt_runs is
  'Work log entries (prompt run results and progress uploads). JPEG bytes are in the live-kit storage bucket.';

-- JPEGs are stored in the `live-kit` bucket (RUN_IMAGE_BUCKET in lib/rooms/repository.js).
-- Created private here if it does not exist yet; an existing bucket is left untouched.
-- No storage policies are added, so only the service role can write.
insert into storage.buckets (id, name, public)
values ('live-kit', 'live-kit', false)
on conflict (id) do nothing;
