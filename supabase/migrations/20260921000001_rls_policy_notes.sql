-- RLS policy notes (documentation migration; no schema changes).
-- Phase 1 intentionally ships default-deny RLS with no permissive policies.
-- When room-owner identity is implemented, replace this comment block with
-- explicit policies for owner/participant access. Until then, privileged
-- reads/writes must use the server service-role client (lib/supabase/admin.js).

comment on table public.rooms is
  'RLS provisional: deny-by-default. Owner policies deferred to identity phase.';
