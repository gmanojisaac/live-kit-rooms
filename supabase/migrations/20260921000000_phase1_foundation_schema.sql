-- Phase 1 foundation schema for LiveKit Prompt Review Room MVP.
-- Applied manually (or via Supabase CLI) against a project — not auto-applied here.
-- RLS: default deny for anon/authenticated; service role bypasses RLS for server ops.
-- Owner/participant policies are intentionally provisional until identity lands.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  owner_id uuid,
  code_hash text not null,
  status text not null default 'active',
  max_participants integer not null default 6,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint rooms_slug_unique unique (slug),
  constraint rooms_max_participants_positive check (max_participants > 0),
  constraint rooms_status_nonempty check (char_length(trim(status)) > 0)
);

create index if not exists rooms_owner_id_idx on public.rooms (owner_id);
create index if not exists rooms_status_idx on public.rooms (status);
create index if not exists rooms_expires_at_idx on public.rooms (expires_at);

-- ---------------------------------------------------------------------------
-- room_invites
-- ---------------------------------------------------------------------------
create table if not exists public.room_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz,
  max_uses integer,
  used_count integer not null default 0,
  revoked_at timestamptz,
  constraint room_invites_used_count_nonnegative check (used_count >= 0),
  constraint room_invites_max_uses_positive check (max_uses is null or max_uses > 0)
);

create index if not exists room_invites_room_id_idx on public.room_invites (room_id);
create index if not exists room_invites_token_hash_idx on public.room_invites (token_hash);
create unique index if not exists room_invites_token_hash_unique on public.room_invites (token_hash);

-- ---------------------------------------------------------------------------
-- prompt_documents (one latest document per room)
-- ---------------------------------------------------------------------------
create table if not exists public.prompt_documents (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  latest_snapshot text,
  revision bigint not null default 0,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint prompt_documents_revision_nonnegative check (revision >= 0)
);

-- ---------------------------------------------------------------------------
-- prompt_versions (immutable named snapshots; unique per room)
-- ---------------------------------------------------------------------------
create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  version_number integer not null,
  name text,
  content text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint prompt_versions_version_positive check (version_number > 0),
  constraint prompt_versions_room_version_unique unique (room_id, version_number)
);

create index if not exists prompt_versions_room_id_idx on public.prompt_versions (room_id);

-- ---------------------------------------------------------------------------
-- audit_events
-- ---------------------------------------------------------------------------
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  event_type text not null,
  actor_id text,
  metadata_minimal jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_event_type_nonempty check (char_length(trim(event_type)) > 0)
);

create index if not exists audit_events_room_id_idx on public.audit_events (room_id);
create index if not exists audit_events_created_at_idx on public.audit_events (created_at);
create index if not exists audit_events_event_type_idx on public.audit_events (event_type);

-- ---------------------------------------------------------------------------
-- Row Level Security — conservative baseline (default deny)
-- ---------------------------------------------------------------------------
alter table public.rooms enable row level security;
alter table public.room_invites enable row level security;
alter table public.prompt_documents enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.audit_events enable row level security;

-- No permissive policies for anon/authenticated in Phase 1.
-- Effect: clients using the anon key cannot read/write private room data.
-- Server-side service-role operations bypass RLS and are used until the
-- room-owner identity model is implemented (provisional — see docs).

revoke all on table public.rooms from anon, authenticated;
revoke all on table public.room_invites from anon, authenticated;
revoke all on table public.prompt_documents from anon, authenticated;
revoke all on table public.prompt_versions from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;

comment on table public.rooms is 'Private review rooms. RLS deny-by-default until owner identity policies land.';
comment on table public.room_invites is 'Invite token hashes only — never store raw invite tokens.';
comment on table public.prompt_documents is 'Latest prompt snapshot per room.';
comment on table public.prompt_versions is 'Immutable prompt versions; (room_id, version_number) unique.';
comment on table public.audit_events is 'Minimal audit trail; avoid PII and screen image payloads.';
