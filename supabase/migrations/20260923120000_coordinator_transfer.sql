-- Coordinator role transfer: pending claim handoff from current owner to a LiveKit participant.
-- Privilege key remains rooms.owner_id; UI labels this role "Coordinator".
-- Does not weaken Phase 1 default-deny RLS. Service-role remains the write path.

create table if not exists public.room_coordinator_transfers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  from_owner_id uuid not null,
  to_participant_identity text not null,
  new_owner_id uuid not null,
  claim_token_hash text not null,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint room_coordinator_transfers_identity_nonempty
    check (char_length(trim(to_participant_identity)) > 0),
  constraint room_coordinator_transfers_claim_hash_nonempty
    check (char_length(trim(claim_token_hash)) > 0)
);

create index if not exists room_coordinator_transfers_room_id_idx
  on public.room_coordinator_transfers (room_id);

create unique index if not exists room_coordinator_transfers_claim_token_hash_unique
  on public.room_coordinator_transfers (claim_token_hash);

-- At most one open (unclaimed, uncancelled) transfer per room.
create unique index if not exists room_coordinator_transfers_one_pending_per_room
  on public.room_coordinator_transfers (room_id)
  where claimed_at is null and cancelled_at is null;

comment on table public.room_coordinator_transfers is
  'Pending coordinator (owner) handoff; assignee claims with hashed token + LiveKit identity.';

alter table public.room_coordinator_transfers enable row level security;
