-- AUTH-05: prompt lock flag + invite consume checks room lifecycle.
-- Does not weaken Phase 1 default-deny RLS. Service-role remains the write path.

-- ---------------------------------------------------------------------------
-- prompt_documents.is_locked — authoritative prompt edit lock (owner-controlled)
-- ---------------------------------------------------------------------------
alter table public.prompt_documents
  add column if not exists is_locked boolean not null default false;

comment on column public.prompt_documents.is_locked is
  'When true, draft mutation and finalization are rejected server-side. Owner lock/unlock only.';

-- ---------------------------------------------------------------------------
-- strengthen try_consume_room_invite: refuse when room is ended/expired or past expires_at
-- ---------------------------------------------------------------------------
create or replace function public.try_consume_room_invite(invite_id uuid)
returns public.room_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.room_invites;
  room_row public.rooms;
begin
  select r.*
  into room_row
  from public.room_invites i
  join public.rooms r on r.id = i.room_id
  where i.id = invite_id
  for update of i, r;

  if not found then
    return null;
  end if;

  -- Room lifecycle: never admit into ended/expired rooms (concurrency with owner end/expiry).
  if room_row.status is distinct from 'active' then
    return null;
  end if;
  if room_row.expires_at is not null and room_row.expires_at <= now() then
    -- Best-effort transition; do not reactivate ended rooms.
    update public.rooms
    set status = 'expired'
    where id = room_row.id
      and status = 'active';
    return null;
  end if;

  update public.room_invites
  set used_count = used_count + 1
  where id = invite_id
    and revoked_at is null
    and (expires_at is null or expires_at > now())
    and (max_uses is null or used_count < max_uses)
  returning * into updated;

  return updated;
end;
$$;

comment on function public.try_consume_room_invite(uuid) is
  'Atomically increments used_count when the invite is usable and the parent room is still active and unexpired. Returns null otherwise.';
