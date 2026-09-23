# Target architecture

**Phase 4 prompt collaboration.** Dynamic rooms, invitations, access-code hashing, owner sessions, LiveKit JWT join, owner moderation, Next.js LiveKit media, and **Yjs CRDT shared prompt editing** over LiveKit Data Channels are implemented on the Next.js + Supabase + LiveKit Cloud stack. The Vite + Express prototype remains reference only.

## Approved MVP baseline

```text
Browser
   │
   ▼
Next.js / Vercel
   ├── POST /api/rooms                      (create room + invite)
   ├── GET  /api/rooms/[slug]               (public room lookup + isOwner)
   ├── POST /api/rooms/[slug]/join         (validate + LiveKit JWT)
   ├── POST /api/rooms/[slug]/lock         (owner: prompt lock/unlock)
   ├── POST /api/rooms/[slug]/remove       (owner: remove participant)
   ├── POST /api/rooms/[slug]/revoke-invite(owner: revoke invitation)
   ├── POST /api/rooms/[slug]/end          (owner: end room)
   ├── GET  /api/rooms/[slug]/participants (owner: LiveKit participant list)
   ├── GET  /api/rooms/[slug]/prompt       (durable snapshot + versions)
   ├── PUT  /api/rooms/[slug]/prompt       (debounced snapshot only — not LWW collab)
   ├── POST /api/rooms/[slug]/prompt/finalize  (named immutable version from Yjs text)
   ├── /create                              (owner create UI)
   ├── /room/[slug]                         (join + owner controls + LiveKit media + Shared Prompt)
   ├── protected server routes
   └── Supabase access
          │
          ├── Supabase
          │     ├── rooms
          │     ├── room_invites
          │     ├── prompt_documents (is_locked, revision, latest_snapshot, yjs_state)
          │     ├── prompt_versions
          │     └── audit_events
          └── LiveKit Cloud
                └── Data Channels → Yjs sync / awareness / prompt-meta
```

## Phase 4 — Yjs collaborative prompt (COL-01…COL-06)

### Chosen realtime transport: **LiveKit Data Channels** (Option A)

| Criterion | LiveKit Data Channels | Supabase Realtime |
| --- | --- | --- |
| Next.js / Vercel | ✅ External realtime (LiveKit Cloud); no long-lived WS on Vercel | ✅ External realtime |
| Six-user sync | ✅ Same LiveKit room already capped at 6 | ✅ Possible |
| Late join / reconnect | ✅ y-protocols sync step1/step2 + CRDT merge | ✅ Possible |
| Security / membership | ✅ JWT-admitted room members only | ⚠️ Anon key + deny-all RLS; would need extra auth channel model |
| Isolation | ✅ LiveKit room === app room slug | Needs careful channel naming + auth |
| Complexity | Moderate custom provider | Higher given current RLS deny-all + no Supabase Auth participants |
| Fits existing join | ✅ Already connected for media | Separate connection |

**Decision:** LiveKit Data Channels. Participants are already authenticated members of the LiveKit room after `POST .../join`. Room isolation is natural. Vercel stays serverless; LiveKit Cloud holds the realtime fabric. Supabase remains the durable snapshot/version store — not the live CRDT bus.

**Why not both:** Dual transports create competing sources of truth. One collab path only.

### Why last-write-wins was replaced

The prior debounced `PUT` + poll + full-string replace path (QA **BUG-001**) allowed concurrent editors to clobber each other. Management requires Yjs CRDT so committed concurrent edits are retained.

### Yjs document model

```text
room (LiveKit room name = slug)
 └── Y.Doc
      └── Y.Text("prompt")   // shared editable prompt only
```

No secrets in Yjs state (no access codes, invite tokens, owner session, LiveKit API secret, Supabase service role).

### Message / update flow

```text
Local keystroke
  → applyLocalTextDiff(Y.Text)          // incremental insert/delete
  → Yjs update event
  → publishData(topic: prompt-yjs-update, reliable)
  → peers applyUpdate
  → debounce ~1.2s
  → PUT /api/rooms/[slug]/prompt       // snapshot + optional yjs_state
```

Topics (room-scoped by LiveKit membership):

| Topic | Purpose |
| --- | --- |
| `prompt-yjs-sync` | y-protocols sync step1/step2 |
| `prompt-yjs-update` | incremental doc updates |
| `prompt-yjs-awareness` | editing presence (display names) |
| `prompt-meta` | lightweight lock/status hints |

### Authentication boundary

- **Live collaboration:** only peers inside the LiveKit room (server-minted JWT) can send/receive Yjs bytes.
- **Persistence / finalize:** Next.js route handlers use service-role Supabase; enforce lock / ended / expired server-side.
- Browser never receives service-role key, LiveKit API secret, owner session secret, or code/invite hashes.

### Late-join strategy

1. New participant creates an empty `Y.Doc` and joins the LiveKit room.
2. Provider broadcasts sync step1; existing peers reply with step2 (full missing state).
3. If no peer sync arrives within ~900ms, seed from durable `yjs_state` (preferred) or `latest_snapshot` text.
4. No full page refresh required.

### Reconnect strategy

1. LiveKit reconnect restores data channels.
2. Provider re-runs sync step1; CRDT merges remote updates with any local uncommitted ops.
3. Do not replace the local doc with a stale REST draft string while connected.
4. Snapshot persistence resumes after reconnect; save UI reflects success/failure honestly.

### Presence

Awareness field `user: { name, identity, editing }` — UI shows display names only (“Editing now: …”). Uses the same join display-name / participant identity; no second identity system.

### Persistence model (COL-03)

- Live truth while connected: **Yjs**.
- Durable: `prompt_documents.latest_snapshot` + `revision` + optional `yjs_state` (base64 update).
- Debounced PUT is **snapshot-only** (`mode: "snapshot"`). It is not a concurrent-edit channel.
- After browser refresh: restore `yjs_state` or text snapshot, then sync with peers.

### Version model (COL-04)

- `POST .../prompt/finalize` with `{ content, name?, finalizedBy? }`.
- `content` must be the current shared Yjs text.
- Named immutable rows in `prompt_versions`; blank name → `Version N`.
- Unique `(room_id, version_number)` + retry on `23505`.
- Draft remains editable after finalize; history is read-only with “Return to current draft”.

### Lock / end / expiry (COL-05 / COL-06)

- Owner `POST .../lock` sets `prompt_documents.is_locked`.
- Editor becomes read-only; provider blocks outbound updates; PUT/finalize reject with `PROMPT_LOCKED`.
- Lock/status polled lightly + optional `prompt-meta` broadcast; no page reload required.
- `ended` / `expired` → read-only, reject writes/finalize, keep version history readable.
- If room closes with unsaved debounce pending, UI reports save failure — does not claim “Saved”.

### REST compatibility

| Method | Role after Phase 4 |
| --- | --- |
| GET | Load durable snapshot + versions + lock/status |
| PUT | Debounced snapshot persistence only |
| POST finalize | Create named version from provided Yjs text |

Clients must not treat GET `draft` as live truth while the Yjs provider is connected.

## Next.js LiveKit media architecture (Phase 3)

```text
/room/[slug]?invite=…
   ↓
JoinRoomForm (display name + access code)
   ↓
POST /api/rooms/[slug]/join
   ↓
{ token, livekitUrl, room, participant }  // token held in memory only
   ↓
MediaRoom
   ├── LiveKitRoom
   │     options.adaptiveStream = true
   │     options.dynacast = true
   │     video={false} audio={false}
   └── RoomWorkspace
         ├── ConnectionStatus
         ├── ScreenShareWarning / NetworkQualityBanner
         ├── ScreenShareGrid + FocusQualityController
         ├── ParticipantPresence
         ├── CollaborativePromptEditor (Yjs over LiveKit Data Channels)
         ├── Chat + ControlBar + RoomAudioRenderer
         └── MediaDiagnostics (?mediaDebug=1)
```

### Connection flow

1. Backend remains authoritative for token minting (`lib/livekit/token.js`).
2. Browser never receives LiveKit API secret, Supabase service role, owner session secret, or code/invite hashes.
3. Participant identity is the server-generated UUID from join; reconnect uses the same LiveKit session identity.
4. Leave disconnects LiveKit and clears in-memory admission. Owner remove / room end use existing moderation APIs.

### Six-screen layout + focus

- Up to six simultaneous screen-share tracks (one per participant).
- Responsive CSS grid: two columns × up to three rows; focused mode shows one primary tile.
- Click tile → focus; **Back to grid** / **Escape** → grid; optional Fullscreen API on the stage.

### Adaptive / dynacast strategy

Configured in `lib/media/room-options.js` — see Phase 3 notes. Unchanged by Phase 4.

### Supported browsers

Desktop **Chrome** and **Microsoft Edge** remain the management acceptance browsers.

## Owner authorization (AUTH-05)

```text
HTTP-only signed cookie (lkr_owner_session)
   ↓
requireRoomOwner(request, slug)
   ↓
verify signature + resolve ownerId
   ↓
ownerId === rooms.owner_id
```

## Room lifecycle

```text
active → ended   (owner end; idempotent)
active → expired (server-time expires_at; on-request)
```

Prompt editor becomes read-only; versions remain readable.

## Security

| Control | Behavior |
| --- | --- |
| Invitation tokens | ≥256-bit CSPRNG; only SHA-256 hash stored |
| Access codes | scrypt + unique salt |
| Owner session | Signed HTTP-only cookie |
| LiveKit JWT | Server-signed, room-scoped, short-lived |
| Capacity | `max_participants = 6` |
| Prompt collab | LiveKit membership + server-enforced lock/lifecycle |
| Audit | `prompt_locked` / `prompt_unlocked` / `prompt_version_created` — no full prompt text |

## What this phase does not include

GitHub integration, remote/local execution agents, screen/meeting recording, screenshot/JPEG storage, transcription, AI summarization, billing, mobile-first redesign.
