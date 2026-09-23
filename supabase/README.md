# Supabase

Version-controlled migrations for the target MVP schema live in `migrations/`.

## Implemented in repository

- Tables: `rooms`, `room_invites`, `prompt_documents`, `prompt_versions`, `audit_events`
- Constraints, indexes, and default `max_participants = 6`
- Phase 2: constrained room status (`active|ended|expired`), `try_consume_room_invite()` for atomic invite use
- Phase 4: `prompt_documents.yjs_state` (optional base64 CRDT restore) + `is_locked` from AUTH-05
- RLS enabled with default-deny (no permissive anon/authenticated policies yet — intentional)
- JS clients: `lib/supabase/browser.js`, `server.js`, `admin.js` (service role)

## Manual external setup required

1. Create a Supabase project (or use the configured development project).
2. Apply migrations (Supabase CLI or SQL editor), in filename order.
3. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY`.

Owner/participant RLS policies remain provisional pending D-02 / D-06. Until then, privileged access is via the service-role client on the server only. The “RLS enabled, no policy” advisor INFO is expected under this posture.
