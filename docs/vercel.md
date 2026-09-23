# Vercel foundation

## Project

| Item | Value |
| --- | --- |
| Team | `earth-minor` |
| Project | `live-kit-rooms` |
| Production URL | https://live-kit-rooms.vercel.app |
| Framework | Next.js (`app/`) |
| Region | `iad1` |

Link locally (already done when `.vercel/project.json` exists):

```powershell
npx vercel link --yes --project live-kit-rooms --scope earth-minor
```

## Implemented in repository

- Next.js App Router application (`app/`) including Phase 3 LiveKit media UI
- `vercel.json` — `framework: nextjs`, `npm ci` / `npm run build`, region `iad1`
- `.vercelignore` — excludes Vite/Express prototype and test artifacts from uploads
- Environment documentation in `docs/environment.md`

## Deploy

Preview (from current working tree):

```powershell
npx vercel --yes
```

Production:

```powershell
npx vercel --prod --yes
```

Git-connected deploys: push to the linked GitHub repo (`gmanojisaac/live-kit-rooms`). Production typically tracks `main`; this workspace often works on `staging` — confirm the Vercel Production Branch setting in the dashboard.

## Environments

| Environment | Behavior |
| --- | --- |
| Development | `npm run dev` locally. Use `.env.local` (`npx vercel env pull`). |
| Preview | Vercel Preview deployments. Use development/non-prod LiveKit + Supabase credentials. |
| Production | https://live-kit-rooms.vercel.app — production or carefully shared credentials per team policy. |

## Build / output

| Item | Value |
| --- | --- |
| Install | `npm ci` |
| Build | `npm run build` → `next build` |
| Output | Next.js (`.next/`); Vercel serverless routing |
| Start (local prod) | `npm start` → `next start` |

## Important constraint

Deploy the **web application** on Vercel. Do **not** place a long-running media SFU or LiveKit media server on Vercel. Media remains on **LiveKit Cloud**.

## Environment variables on Vercel

Set for Production, Preview, and Development (see `docs/environment.md`):

**Public**

- `NEXT_PUBLIC_LIVEKIT_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Server**

- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OWNER_SESSION_SECRET`

**Policy knobs (provisional)**

- `ROOM_CREATION_MODE`
- `ROOM_DEFAULT_EXPIRY_MINUTES`
- `INVITE_DEFAULT_MAX_USES`

Optional:

- `APP_BASE_URL` — absolute origin for invitation links (otherwise derived from the request host)
- `LIVEKIT_TOKEN_TTL_SECONDS`
- `TRUSTED_PROXY_IPS`

Pull into local `.env.local`:

```powershell
npx vercel env pull .env.local
```

## Preview vs production behavior

- **Preview:** validates branches/PRs; prefer development LiveKit/Supabase.
- **Production:** stable URL; only after review; keep LiveKit API secrets server-only.

## Phase 3 note

After deploy, open `/create`, create a room, join via invitation, and confirm LiveKit connects in the browser. Six-user media acceptance remains a manual checklist (`docs/testing/`).
