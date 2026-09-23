# LiveKit Prompt Review Room

**Phase 4 prompt collaboration.** The approved MVP baseline is Next.js + LiveKit Cloud + Supabase + Vercel with **Yjs CRDT** shared prompts over LiveKit Data Channels. This repository contains:

1. **Target stack** — dynamic rooms, invitations, access codes, owner sessions, LiveKit JWT join, owner moderation, Next.js LiveKit media, and collaborative shared prompt (`npm run dev` / `npm run build`)
2. **Working prototype** (React 18 + Vite 6 + Express 4) — preserved as **reference only** via `npm run prototype:*`

See [docs/migration-status.md](docs/migration-status.md), [docs/architecture.md](docs/architecture.md), [docs/environment.md](docs/environment.md), [docs/vercel.md](docs/vercel.md), and [docs/testing/](docs/testing/).

Production (Vercel): https://live-kit-rooms.vercel.app

This project is **not** production-ready. Six-user **physical** CRDT acceptance must be recorded separately from automated Yjs tests.

---

## Target stack

```powershell
npm install
npm run dev
npm run build
npm test
npm run test:browser
```

- Create a room: [http://localhost:3000/create](http://localhost:3000/create)
- Room route: `/room/[slug]?invite=…` → join → LiveKit media + **Shared Prompt**
- APIs: `POST /api/rooms`, `GET /api/rooms/[slug]`, `POST /api/rooms/[slug]/join`, prompt GET/PUT/finalize, plus owner moderation routes
- Supabase schema: `supabase/migrations/`
- Config: `lib/config/env.js`

Copy `.env.example` → `.env.local` and fill placeholders (including `OWNER_SESSION_SECRET` and LiveKit keys). Never commit real secrets.

### Join + media + prompt flow

```text
Invitation → /room/[slug]?invite=…
  → display name + access code
  → POST /api/rooms/[slug]/join
  → LiveKit JWT (memory only)
  → MediaRoom (adaptiveStream + dynacast)
  → Shared Prompt (Yjs over LiveKit Data Channels)
  → debounced snapshot → Supabase
  → Finalize Prompt → immutable named version
```

### Collaborative prompt (Phase 4)

```text
Yjs CRDT  →  LiveKit Data Channels  →  no lost concurrent edits
          ↘ debounced PUT snapshot → prompt_documents
Finalize  →  prompt_versions (named, immutable)
```

- Transport: **LiveKit Data Channels** (documented in `docs/architecture.md`)
- PUT `/api/rooms/[slug]/prompt` is **snapshot persistence only** — not last-write-wins collaboration
- Owner lock / room end / expiry make the editor read-only (enforced server-side)
- Copy Prompt, live character count, last-saved indicator, version history

### Media quality (management policy)

```text
Grid thumbnails  → lower layers (≈180p–360p, low fps) via adaptive + LOW
Focused screen   → higher layer (≈720p, 10–15 fps) via HIGH while focused
Dynacast         → enabled explicitly in lib/media/room-options.js
```

### Acceptance docs

| Doc | Purpose |
| --- | --- |
| [docs/testing/media-acceptance-checklist.md](docs/testing/media-acceptance-checklist.md) | Chrome/Edge media checklist |
| [docs/testing/prompt-acceptance-checklist.md](docs/testing/prompt-acceptance-checklist.md) | COL / AT-07… prompt checklist |
| [docs/testing/six-user-media-harness.md](testing/six-user-media-harness.md) | Six-user media harness |
| [docs/testing/six-device-one-hour-template.md](testing/six-device-one-hour-template.md) | One-hour stability record |

Owner moderation (AUTH-05):

```text
Owner cookie → POST /api/rooms/[slug]/{lock|remove|revoke-invite|end}
  → server requireRoomOwner → Supabase + LiveKit admin APIs
```

Provisional policy knobs (awaiting Product Owner decisions D-02 / D-03 / D-04):

```text
ROOM_CREATION_MODE=open
ROOM_DEFAULT_EXPIRY_MINUTES=90
INVITE_DEFAULT_MAX_USES=6
LIVEKIT_TOKEN_TTL_SECONDS=3600
```

---

## Prototype (preserved reference — not the production architecture)

**Release 2.x prototype remains available** for existing media trials. See [RELEASES.md](RELEASES.md).

```powershell
npm run prototype:dev
```

Open **http://localhost:5173**. Prototype env vars (`LIVEKIT_URL`, `ROOM_ACCESS_CODE`, etc.) are documented in `.env.example`. Do not commit a real `ROOM_ACCESS_CODE`.

### What the prototype supports

- Server-signed LiveKit tokens and admission control (up to six participants)
- Camera, microphone, chat, and simultaneous screen shares
- Collaborative prompt draft / finalize (in-memory — **not** the production Yjs path)
- Manual run recording with optional JPEG (in-memory)
- Private invitation link copy (no secrets in the URL)

### Prototype verification

```powershell
npm run test:prototype
npm run prototype:test:browser
```

---

## Two computers (prototype Tailscale trial)

The original Tailscale Serve instructions still apply to the **prototype** stack (`npm run prototype:build` then `npm run prototype:start`). See detailed steps in git history / earlier README sections if needed for the working trial.

---

## License / notes

Private project for Earth Minor Rights collaborative review rooms. Do not commit secrets. Do not log full prompt contents, Yjs payloads, access codes, tokens, or JWTs.
