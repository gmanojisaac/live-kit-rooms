# Migration status

**Phase:** 4 prompt collaboration (Week 3 COL-01…COL-06)

**Status date:** 2026-09-22

**Do not treat this project as production-ready.** Six-user **physical** CRDT acceptance is a separate evidence bar from “implemented in code” and automated Yjs tests.

## Technology relationship

| Aspect | CURRENT PROTOTYPE | TARGET MVP |
| --- | --- | --- |
| Web UI | React 18 + Vite 6 (`src/`, `index.html`) | Next.js App Router (`app/`) |
| API / token issuance | Express 4 (`server/`, `server.js`) | Next.js Route Handlers on Vercel (`app/api/`) |
| Collaboration / data | In-memory + local JSON (`.data/`) | Supabase Postgres + RLS + **Yjs CRDT** |
| Prompt transport | REST last-write-wins (prototype) | **LiveKit Data Channels + Yjs** |
| Media SFU | LiveKit Cloud | LiveKit Cloud (Next.js room connects) |
| Hosting | Local / Tailscale Serve | Vercel (web app only) |
| State of work | Reference media trial | Rooms + auth + media + **shared prompt CRDT** |

```text
CURRENT PROTOTYPE (reference only)
React + Vite + Express + in-memory/local state

TARGET MVP
Next.js + LiveKit Cloud + Supabase + Vercel + Yjs (LiveKit Data Channels)
```

## Phase / AUTH / MED / COL item status

| Area | Status | Notes |
| --- | --- | --- |
| Dynamic rooms | DONE | `POST /api/rooms` |
| Invitation model | DONE | Token + SHA-256 hash |
| Owner session | DONE | HTTP-only signed cookie |
| Access-code hashing | DONE | scrypt |
| Join + LiveKit JWT | DONE | `POST /api/rooms/[slug]/join` + participant rejoin grants (2026-09-25) |
| Owner moderation | DONE | lock / remove / revoke / end |
| Media migration (MED-01…08) | DONE IN CODE | Next.js `/room/[slug]` LiveKit workspace |
| **Yjs / prompt CRDT (COL-01…06)** | **DONE IN CODE** | LiveKit Data Channels transport |
| Six-user physical CRDT acceptance | PENDING | Automated 6-peer Yjs harness ✅; physical ⏳ |
| Testing migration | PARTIAL | Unit + CRDT + optional Supabase; multi-browser collab manual |
| Operations | NOT STARTED | Usage/cost alerts, emergency disable |

## COL checklist (implementation vs acceptance)

| ID | Item | In code | Automated | Physical six-user |
| --- | --- | --- | --- | --- |
| COL-01 | Yjs transport spike + late-join sync | ✅ LiveKit Data Channels | provider + docs | ⏳ |
| COL-02 | Multi-user editor + presence + no lost edits | ✅ | Yjs merge tests + 6-peer harness | ⏳ |
| COL-03 | Debounced snapshots + refresh restore | ✅ | service tests | ⏳ |
| COL-04 | Named immutable versions + history | ✅ | service tests | ⏳ |
| COL-05 | Copy / char count / last-saved / owner lock | ✅ | service + UI | ⏳ |
| COL-06 | End / expiry read-only behavior | ✅ | service tests | ⏳ |

## Acceptance mapping

| AT | Area | In code | Automated | Physical |
| --- | --- | --- | --- | --- |
| AT-07 | Concurrent prompt | ✅ | 2+ peer merge + 6-peer harness | ⏳ six browsers |
| AT-08 | Versions | ✅ | finalize / uniqueness / immutability | ⏳ |
| AT-09 | Owner control integration | ✅ | lock reject writes | ⏳ |
| AT-10 | Recovery | ✅ | yjs_state + late-join seed | ⏳ |
| AT-13 | Expiry | ✅ | expired rejects writes | ⏳ |

## MED checklist (unchanged from Phase 3)

| ID | Item | In code | Automated | Physical six-user |
| --- | --- | --- | --- | --- |
| MED-01…08 | Media workspace | ✅ | helpers + UI | ⏳ |

## AUTH checklist

| ID | Item | Status |
| --- | --- | --- |
| AUTH-01…06 | Rooms, invites, JWT, owner controls, rate limit | DONE |

## Unresolved Product Owner decisions

| ID | Topic | Handling in code |
| --- | --- | --- |
| D-02 | Who may create rooms? | `ROOM_CREATION_MODE=open\|host_secret` (provisional default `open`) |
| D-03 | Default room expiry | `ROOM_DEFAULT_EXPIRY_MINUTES` (provisional `90`) |
| D-04 | Invitation maximum uses | `INVITE_DEFAULT_MAX_USES` (provisional `6`) |
| D-06 | Owner approval for coded participants | Deferred — not implemented |

## Database migrations

Apply (in order) on each Supabase environment:

1. `20260921000000_phase1_foundation_schema.sql`
2. `20260921000001_rls_policy_notes.sql`
3. `20260922000000_phase2_room_access_constraints.sql`
4. `20260922010000_auth05_prompt_lock_and_consume.sql`
5. `20260922020000_phase4_prompt_yjs_state.sql` — optional `yjs_state` for CRDT restore

## Unresolved product decision — JPEG / run history

Unchanged: management plan says screen content/screenshots are not stored, while earlier product conversation requested JPEG result storage. **Do not silently choose.** Phase 4 introduces **no** screenshot storage.

## Future phases (out of Phase 4 scope)

GitHub integration, remote execution, local execution agent, usage/cost alerts, emergency disable, JPEG/run-history expansion, billing, mobile-first redesign, screen/meeting recording.
