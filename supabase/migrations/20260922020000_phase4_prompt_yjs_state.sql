-- Phase 4: durable Yjs state alongside text snapshot for refresh/reconnect recovery.
-- Does not weaken Phase 1 default-deny RLS. Service-role remains the write path.

alter table public.prompt_documents
  add column if not exists yjs_state text;

comment on column public.prompt_documents.yjs_state is
  'Optional base64-encoded Yjs state update for CRDT restore after refresh. latest_snapshot remains the human-readable text.';
