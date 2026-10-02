-- Participant rejoin grants: allow a previously admitted participant to re-enter
-- after leaving without consuming another invitation use.
-- Raw rejoin tokens are never stored — only SHA-256 hashes.
-- Does not weaken Phase 1 default-deny RLS. Service-role remains the write path.

create table if not exists public.room_participant_rejoin_grants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  invite_id uuid not null references public.room_invites (id) on delete cascade,
  token_hash text not null,
  participant_identity text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint room_participant_rejoin_grants_token_hash_nonempty
    check (char_length(trim(token_hash)) > 0),
  constraint room_participant_rejoin_grants_identity_nonempty
    check (char_length(trim(participant_identity)) > 0)
);

create unique index if not exists room_participant_rejoin_grants_token_hash_unique
  on public.room_participant_rejoin_grants (token_hash);

create index if not exists room_participant_rejoin_grants_room_id_idx
  on public.room_participant_rejoin_grants (room_id);

create index if not exists room_participant_rejoin_grants_room_identity_idx
  on public.room_participant_rejoin_grants (room_id, participant_identity)
  where revoked_at is null;

comment on table public.room_participant_rejoin_grants is
  'Hashed rejoin credentials for previously admitted participants; never stores raw tokens.';

alter table public.room_participant_rejoin_grants enable row level security;
