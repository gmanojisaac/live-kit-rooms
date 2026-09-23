# Six-device / one-hour stability test template

Management QA task: six devices, one hour, stability + bandwidth on the **development** LiveKit Cloud project.

**Do not** run unbounded load against production.  
**Do not** collect or store screen content, access codes, invitation tokens, session credentials, or prompt content.

## Record

| Field | Value |
| --- | --- |
| date | |
| build/commit | |
| browser | Chrome / Edge / mixed |
| device | |
| participant count | 6 |
| room slug | (slug only — no invite/token) |
| duration | (target 60 minutes) |
| screen-share count | (target 6 simultaneous) |
| disconnects | |
| reconnects | |
| screen-share failures | |
| observed quality | grid vs focused readability |
| bandwidth/cost observations | approximate; from LiveKit dashboard if available |
| CPU/memory observations | optional |
| result | PASS / PARTIAL / FAIL |
| notes | |

## Procedure (manual)

1. Create a room on the target Next.js app (`/create`) using development credentials.
2. Invite six participants (six browsers/devices or profiles). Prefer Chrome + Edge mix.
3. Each participant joins via `/room/[slug]?invite=…` with display name + access code.
4. Enable microphone as needed; leave camera off unless explicitly testing camera.
5. Each participant starts one screen share (window or tab preferred).
6. Confirm 2 × 3 grid and focus/Escape behavior once at the start.
7. Leave the session running for 60 minutes.
8. Optionally induce a brief network interruption on one client; confirm reconnect without duplicate identity.
9. Record the fields above. Stop all shares and leave cleanly.
10. Owner ends the room.

## Optional diagnostics

Append `?mediaDebug=1` (or set `window.__LKR_MEDIA_DEBUG = true`) for sanitized connection/participant/share counts. Never paste tokens into this record.
