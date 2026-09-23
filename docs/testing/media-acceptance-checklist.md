# Media acceptance checklist (Phase 3)

Use this checklist for management Week 2 media acceptance. Check items only when verified on real browsers.

**Do not record:** screen content, access codes, invitation tokens, session credentials, prompt content, JWTs.

## Browsers

- [x] Chrome room join — verified 2026-09-22 on Cursor Chromium against `localhost:3000` (create → invite → join → Connected)
- [ ] Edge room join — **not run** in this session (Chromium automation ≠ Edge acceptance)

## Capacity and layout (AT-04 / AT-05)

- [ ] Six participants — **pending** (verified **2 / 6** live participants only)
- [ ] Six simultaneous screen shares (target duration: 30 minutes) — **pending** (verified **2** simultaneous synthetic shares)
- [x] 2 × 3 grid — layout engine verified with 2 side-by-side tiles (`grid-template-columns` 2 cols, same Y, non-overlapping); empty-state six-person copy verified
- [ ] 1366 × 768 layout — six tiles legible, non-overlapping — **pending** (needs six shares)
- [ ] 1920 × 1080 layout — six tiles legible, non-overlapping — **pending** (needs six shares)

## Voice (AT-03)

- [x] Mic mute/unmute — mic toggled to enabled (`aria-pressed=true`, `data-lk-enabled=true`)
- [x] Device selection — mic menu listed Default / Communications / Microphone (Realtek)
- [x] Speaking indicator — `● speaking` shown on local presence chip while mic active
- [x] Camera starts off by default — camera `aria-pressed=false` / `data-lk-enabled=false` after join

## Focus (AT-06)

- [x] Focus (click tile) — heading became “Acceptance Tester's screen”; `screen-grid--focused`
- [x] Escape returns to grid — Escape restored “Shared screens” / `aria-pressed=false`
- [x] Fullscreen control present — Fullscreen button + Escape hint visible in focus mode (Fullscreen API click not asserted)
- [x] Stop focused share returns to a valid grid state — after stop share, empty six-person copy returned
- [x] Switch focused target without disconnecting — focus entered/exited while Connected stayed up

## Recovery / privacy / quality

- [ ] Reconnect after transient outage (AT-10) — **not induced** in this session
- [ ] Poor-network message appears when quality is poor/lost — **not induced**
- [x] Persistent share warning while local sharing (AT-11) — warning + Stop sharing visible while sharing
- [x] Share warning disappears immediately after stopping — warning `null` after stop
- [x] Adaptive/dynacast configured (AT-12) — room options enable both in code; live layer quality not instrumented this run
- [x] No media recording / egress introduced — no RoomRecorder/Egress markers in page DOM

## Moderation compatibility

- [x] Owner participant removal disconnects the participant — Second Tester saw “You were removed from this room by the owner.”; count returned to 1 / 6
- [x] Room end disconnects everyone and shows closed state — Status: ended; “This room has ended.”; media workspace cleared

## Evidence notes

| Field | Value |
| --- | --- |
| Date | 2026-09-22 |
| Build / commit | Local `npm run dev` Phase 3 tree (not a tagged git SHA) |
| Chrome version | Cursor embedded Chromium (automation browser) |
| Edge version | not tested |
| LiveKit project | development (via local env) |
| Result | **PARTIAL** |
| Notes | Two-user live path passed: join, Connected, mic/devices/speaking, camera-off, screen share + warning, focus/Escape, dual share grid, owner remove, room end. Six-user / Edge / reconnect / poor-network / 30‑min & 1‑hour endurance remain pending. Screen shares used synthetic `canvas.captureStream` (no real desktop capture stored). |
