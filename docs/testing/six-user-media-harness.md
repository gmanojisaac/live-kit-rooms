# Six-user media harness

Management acceptance requires **six participants** and **six simultaneous screen shares**. This document describes the harness setup and what is automated vs manual.

## What is implemented in-repo

| Layer | Coverage |
| --- | --- |
| Unit helpers (`tests/media/`) | Connection mapping, focus/Escape, quality plan, share state, room options |
| Target browser smoke (`tests/browser/target-media.spec.js`) | Room route loads; join form; mocked admission → media shell mounts; Escape helper path where possible |
| Prototype browser suite | Existing two-user LiveKit media (Vite) — reference only |
| Physical six-user | Manual — see checklist |

## Harness procedure (manual / multi-profile)

1. Start Next.js with development LiveKit + Supabase env: `npm run dev`.
2. Create a room at `/create`; copy the invitation link and access code separately.
3. Open six browser profiles (or machines). Mix **Chrome** and **Edge**.
4. Each profile opens the invite URL, enters a distinct display name + access code, joins.
5. Confirm participant strip shows `6 / 6 participants`.
6. Each participant clicks **Share screen** once (window/tab). Confirm six tiles in a 2 × 3 grid.
7. On one client: focus a tile → **Escape** → back to grid; try **Fullscreen**.
8. Confirm the local share warning while sharing; stop share and confirm it disappears.
9. Optional: DevTools → Network offline briefly → expect **Reconnecting…** then **Connected** without a second self entry.
10. Leave / owner-remove / end-room as needed.

## Playwright multi-context sketch

When credentials and synthetic `getDisplayMedia` are available, extend `tests/browser/target-media.spec.js` to open six contexts similar to the prototype `meeting.spec.js` pattern:

- Mock or fulfill join tickets from `POST /api/rooms/[slug]/join` against a real or test room.
- Stub `navigator.mediaDevices.getDisplayMedia` with `canvas.captureStream` (never capture the host desktop).
- Assert six `.screen-tile` elements and non-overlapping layout at 1366×768 and 1920×1080.

Until that run is executed successfully, treat six-user acceptance as **PENDING PHYSICAL ACCEPTANCE**.

## Honesty rules

```text
MED-03 implementation       ✅ (in code)
two-user automated path     ⏳ / ✅ (depending on env)
six-user physical test      ⏳ until executed
```

Do not claim MED-03 fully management-accepted without six-user evidence.
