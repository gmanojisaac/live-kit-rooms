-- Phase 2: room access foundation constraints and invite consume helper.
-- Does not weaken Phase 1 default-deny RLS. Service-role remains the write path.

-- Constrained room status model (active | ended | expired).
alter table public.rooms
  drop constraint if exists rooms_status_nonempty;

alter table public.rooms
  drop constraint if exists rooms_status_allowed;

alter table public.rooms
  add constraint rooms_status_allowed
  check (status in ('active', 'ended', 'expired'));

comment on column public.rooms.status is
  'Constrained lifecycle: active | ended | expired. Expiry is also enforced server-side via expires_at.';

comment on column public.rooms.code_hash is
  'Password-derived access-code hash with embedded per-code salt. Never store plaintext codes.';

comment on column public.room_invites.token_hash is
  'One-way hash of raw invitation token (e.g. SHA-256). Raw tokens are never persisted.';

-- Atomic invite use increment: only succeeds when invite is still usable.
-- Rejected join attempts must not call this function.
create or replace function public.try_consume_room_invite(invite_id uuid)
returns public.room_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.room_invites;
begin
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

revoke all on function public.try_consume_room_invite(uuid) from public, anon, authenticated;
grant execute on function public.try_consume_room_invite(uuid) to service_role;

comment on function public.try_consume_room_invite(uuid) is
  'Atomically increments used_count when the invite is unrevoked, unexpired, and under max_uses. Returns null when consumption is not allowed.';

comment on table public.rooms is
  'Private review rooms. RLS deny-by-default; owner/participant policies remain provisional pending D-02/D-06.';
