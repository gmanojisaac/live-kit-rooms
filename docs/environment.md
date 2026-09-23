# Environment variables

Inventory for the **target** Next.js + LiveKit Cloud + Supabase + Vercel stack.
Never commit real values. Use placeholders locally in `.env` / `.env.local` (gitignored).

## Implemented in repository

- `.env.example` — placeholder catalog (including provisional room-policy knobs)
- `lib/config/env.js` — centralized validation and public/server separation
- Separate LiveKit and Supabase client modules with server-only service role
- Owner session + room creation policy resolution via `lib/rooms/policy.js`

## Manual external setup required

- LiveKit Cloud **development** project + credentials
- LiveKit Cloud **production** project + credentials (separate from development)
- Supabase project + apply `supabase/migrations/`
- Vercel project env vars for Preview and Production (include `OWNER_SESSION_SECRET`)
- Approved secret store / team vault for long-term secret storage

## Public (`NEXT_PUBLIC_*`)

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_LIVEKIT_URL` | LiveKit WebSocket URL (`wss://…`) for the browser client |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key; subject to RLS |

Only variables that are intentionally public belong in this category.

## Server-only

| Variable | Purpose |
| --- | --- |
| `LIVEKIT_API_KEY` | LiveKit API key for server token issuance |
| `LIVEKIT_API_SECRET` | LiveKit API secret — **never** expose to the browser |
| `LIVEKIT_TOKEN_TTL_SECONDS` | Max LiveKit JWT lifetime (default `3600`); always capped by remaining room lifetime |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role — bypasses RLS; **server only** |
| `OWNER_SESSION_SECRET` | HMAC secret for owner HTTP-only session cookies (min 32 chars) |
| `ROOM_CREATION_SECRET` | Optional; required when `ROOM_CREATION_MODE=host_secret` |
| `APP_BASE_URL` | Optional absolute origin for invitation URLs |
| `TRUSTED_PROXY_IPS` | Optional trusted proxies for client-IP rate limiting |

Forbidden:

```text
NEXT_PUBLIC_LIVEKIT_API_SECRET
NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_OWNER_SESSION_SECRET
NEXT_PUBLIC_ROOM_CREATION_SECRET
```

## Room policy (provisional — not Product Owner final decisions)

| Variable | Decision | Provisional default | Notes |
| --- | --- | --- | --- |
| `ROOM_CREATION_MODE` | D-02 | `open` | Also supports `host_secret` |
| `ROOM_DEFAULT_EXPIRY_MINUTES` | D-03 | `90` | Management recommendation only |
| `INVITE_DEFAULT_MAX_USES` | D-04 | `6` | Management recommendation only |
| `ROOM_CREATION_RATE_LIMIT_MAX` | — | `10` | Abuse control; configurable |
| `ROOM_CREATION_RATE_LIMIT_WINDOW_MS` | — | `900000` (15m) | Abuse control; configurable |
| `JOIN_RATE_LIMIT_MAX_FAILURES` | AUTH-06 | `5` | Management source of truth |
| `JOIN_RATE_LIMIT_WINDOW_MS` | AUTH-06 | `900000` (15m) | Management source of truth |
| `LIVEKIT_TOKEN_TTL_SECONDS` | AUTH-04 | `3600` | Capped further by remaining room lifetime |

D-06 (whether correctly coded participants require owner approval) has **no** env default yet — deferred to the owner-moderation phase.

## Prototype-only (Vite + Express; still supported)

These remain for `npm run prototype:*` until feature migration:

| Variable | Purpose |
| --- | --- |
| `LIVEKIT_URL` | Prototype LiveKit URL (maps conceptually to `NEXT_PUBLIC_LIVEKIT_URL`) |
| `LIVEKIT_API_KEY` | Shared name with target server key |
| `LIVEKIT_API_SECRET` | Shared name with target server secret |
| `ROOM_ACCESS_CODE` | Fixed-room access code for the prototype — **local only; never commit a real code** |
| `PORT` | Express listen port (default `3001`) |
| `TRUSTED_PROXY_IPS` | Optional trusted proxy list for join rate limiting |

## Development vs production LiveKit credentials

| Environment | Expectation |
| --- | --- |
| Development / Preview | Dedicated LiveKit Cloud **development** API key + secret + URL |
| Production | Dedicated LiveKit Cloud **production** API key + secret + URL |

Do not reuse production secrets in local `.env`. Configure Preview and Production separately in Vercel.

## Vercel environment mapping

| Vercel target | Typical vars |
| --- | --- |
| Development (local) | `.env.local` from `.env.example` placeholders |
| Preview | Development LiveKit + non-prod Supabase + `OWNER_SESSION_SECRET` |
| Production | Production LiveKit + production Supabase + `OWNER_SESSION_SECRET` |

Build command: `npm run build` (Next.js). Output: Next.js default (handled by Vercel).

## Secret rotation procedure

### 1. LiveKit development credentials

1. In LiveKit Cloud, create a new API key/secret for the **development** project (or rotate keys per LiveKit console guidance).
2. Update local `.env.local` and Vercel **Preview** / Development env vars: `NEXT_PUBLIC_LIVEKIT_URL` (if URL changed), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
3. Redeploy Preview (or restart `npm run dev` / prototype server).
4. Verify: join path issues a token (`POST /api/rooms/[slug]/join` on the target stack; prototype: `POST /api/join`). Confirm old key fails.
5. Revoke the previous development key in LiveKit Cloud once verification passes.

### 2. LiveKit production credentials

1. Rotate keys in the **production** LiveKit Cloud project only.
2. Update Vercel **Production** env vars (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and URL if needed).
3. Trigger a production redeploy.
4. Verify a controlled join/token path in production.
5. Revoke the previous production key.
6. Rollback: restore previous env var values in Vercel and redeploy if the new key misbehaves; keep the old key active until rollback verification completes, then revoke.

### 3. Supabase service-role credential

1. In Supabase project settings, rotate the service-role key per Supabase guidance.
2. Update `SUPABASE_SERVICE_ROLE_KEY` in the secret store and Vercel (Preview/Production as applicable). **Never** put this in `NEXT_PUBLIC_*` or client bundles.
3. Redeploy / restart server processes that use the admin client.
4. Verify a server-only privileged operation (room create / lookup) from a secure server context.
5. Invalidate the old service-role key.
6. Rollback: restore the previous service-role value and redeploy; treat leaked service-role keys as a full incident (rotate again, audit access).

### 4. Owner session secret

1. Generate a new random secret (≥32 characters).
2. Update `OWNER_SESSION_SECRET` in the vault and Vercel.
3. Redeploy. Existing owner cookies become invalid (expected).
4. Confirm room creation sets a new HTTP-only session cookie.

### 5. Redeployment / restart

- Vercel: changing env vars requires a new deployment to take effect for serverless functions.
- Local: restart `next dev` / `prototype:start` after `.env.local` changes.

### 6. Post-rotation verification

- Confirm public URL still loads.
- Confirm server config validation passes (`getServerConfig` with production requirements where applicable).
- Confirm no `NEXT_PUBLIC_*` secret aliases exist.
- Confirm room creation and (when implemented) LiveKit token minting work with the new credentials.

### 7. Rollback considerations

- Keep the prior secret available in a vault until the new deployment is verified.
- Prefer roll-forward (fix config, redeploy) over long dual-key windows.
- If a secret was exposed (chat, logs, screenshot), rotate immediately and do not reuse it.

## Development vs production LiveKit (Phase 3)

| | Development | Production |
| --- | --- | --- |
| Project | LiveKit Cloud **dev** | Separate **prod** project |
| Browser URL | `NEXT_PUBLIC_LIVEKIT_URL` | same name, prod value |
| API key/secret | `LIVEKIT_API_*` server-only | never `NEXT_PUBLIC_` |

Media clients receive only the short-lived join JWT and the public LiveKit URL. Automated tests that need a real SFU must use the **development** project. Do not point load or six-device endurance tests at production.
