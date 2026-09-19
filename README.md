# LiveKit Collaborative Development Room — starter trial

This is a **starter application**, not a hosted service. It supports a private room with camera, microphone, screen sharing, participant tiles, and LiveKit's built-in focus/grid UI. A developer needs to configure it and test it with real devices before using it with the full team.

## 1. Setup

Install Node.js 20 or newer. In this folder, run:

```bash
npm install
cp .env.example .env
```

On Windows PowerShell use `Copy-Item .env.example .env` instead of `cp`.

Edit `.env` to insert your own LiveKit Cloud URL, API key, API secret, and a long private `ROOM_ACCESS_CODE`. **Never paste the API secret into a chat, frontend file, or GitHub.** Do not commit `.env`.

## 2. Run a local trial

```bash
npm run dev
```

Open **http://localhost:5173** on your own machine, enter your name and the access code, and join. Use the camera/microphone controls and Share Screen button inside the meeting. To test a second person on a different computer, deploy this app to an HTTPS address first; `localhost` on one computer is not accessible from another.

## 3. Deploy privately

This app uses a Node/Express token server, so it needs a hosting service that runs a persistent Node server. Build with `npm install && npm run build`, start with `npm start`, and set the four environment variables in your host's **server-side** environment settings. Supply a private HTTPS URL only to invited testers. Protect the site itself with the host's access controls if you need stronger privacy; the shared access code here is a trial convenience and is not enterprise-grade authentication.

## Important trial limitations

- The six-person check happens when requesting a token; simultaneous requests and still-valid previously issued tokens can exceed six. Enforce room max participants at the LiveKit room level before production.
- The current room name is fixed (`collaborative-development-room`), and the access code is shared. Per-meeting invitation links, coordinator permissions, recording controls, and a shared prompt editor are future work.
- Browser UI and screen-share support vary by device. The default LiveKit VideoConference UI provides its own grid/focus behavior, but a custom six-screens-at-once **screen-share-only** gallery and coordinator-controlled active screen are **not yet implemented**.
- LiveKit Cloud free-plan limits and API compatibility can change; confirm those in your account. This app has **not** been connected to or tested against your LiveKit account.
