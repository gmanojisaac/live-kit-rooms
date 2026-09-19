# LiveKit Collaborative Development Room — two-person private trial

**Release 2.0 is a prerelease awaiting your manual testing.** See [RELEASES.md](RELEASES.md) to switch between the original working Release 1.0 and this update.

The existing application now supports two people in the same `collaborative-development-room`, using the same existing `ROOM_ACCESS_CODE` and LiveKit Cloud project. Keep your current `.env` unchanged.

## What the room supports

- A separate server-signed token and random participant identity for every accepted join, even if both people enter the same name.
- Camera, microphone, chat, and remote audio playback using LiveKit's existing controls.
- Two simultaneous screen shares, displayed side by side. Click either screen to maximize it; select **Return to grid** to see both. If the focused share stops or its owner leaves, the grid returns automatically.
- **Copy Invitation Link** on the welcome page and inside the meeting. The link contains no access code, credentials, participant identity, or token. Share your existing code separately.
- Two admitted participants, counting pending connections as occupied seats. The server serializes admissions, saves reservations in ignored `.data/admissions.json`, and configures LiveKit's room maximum as two. Leaving revokes the old Cloud token before freeing the seat.
- Visible media-permission errors and a manual-copy fallback if clipboard access is denied.

Cameras and microphones still start off. Each participant enables them using the meeting controls.

## Run on this computer

From the project directory:

```powershell
npm install
npm run dev
```

Open **http://localhost:5173**. If an older dev server is running, stop it with **Ctrl+C** first and restart it so the updated token server is loaded. Do not overwrite your existing `.env`.

## Two computers on different networks, without a public deployment

Run the app on your computer and give the other computer private access through [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve). The second computer needs a desktop browser and Tailscale; it does not need Node.js, a copy of the repository, or your LiveKit API credentials.

### 1. Connect both computers privately

Install [Tailscale](https://tailscale.com/download) on both computers and sign each person into their own account. From the host's Tailscale admin console, open **Machines**, find your host computer, and use **Share → Copy invite link**. Send that private device invitation to the second person and have them accept it. They must keep Tailscale connected. If both users are already in the same tailnet with appropriate access, this device-sharing step is unnecessary. See [Tailscale's machine-sharing instructions](https://tailscale.com/docs/features/sharing).

This device invitation grants network access. The application's **Copy Invitation Link** provides the room's webpage address; both are needed the first time.

### 2. Run the updated app on the host

Stop your old `npm run dev` process first, then run:

```powershell
npm run build
npm start
```

Keep this terminal running. The server listens only on `127.0.0.1` and uses the unchanged `PORT` in your `.env` (currently 3001 in the starter).

### 3. Give it a private HTTPS address

Open another terminal on the host and run:

```powershell
tailscale serve --bg http://127.0.0.1:3001
tailscale serve status
```

Use your existing port instead of 3001 if you previously changed `PORT`. Follow the Tailscale prompt to enable HTTPS if needed. This prints an address like `https://your-computer.your-tailnet.ts.net`. Open that **HTTPS address on the host too**.

Use **Serve**, not **Funnel**: Serve restricts access to your private network and shared devices. No public deployment or router port forwarding is needed. [Serve command reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

### 4. Invite and join

1. Open the private HTTPS address and click **Copy Invitation Link**.
2. Send the copied application link and your **existing** room access code to the invited person.
3. Each person opens the link, enters their own name and the same code, and clicks **Join room**.
4. Turn on **Microphone** and **Camera** and allow browser permissions. If audio playback is blocked, use the playback button shown by LiveKit.
5. Both people click **Share screen**, choose a screen/window/tab in their own browser, and confirm sharing. Both screens appear side by side.
6. Click either screen to enlarge it and **Return to grid** to restore both. These view choices affect only your own browser.

A localhost link points to the recipient's own computer, so the invitation button explains private HTTPS setup instead of copying an unusable localhost address. Camera, microphone, and screen capture need a secure browser context on remote computers.

### 5. Stop the trial

Use **Leave** in the app. Stop the Node server with **Ctrl+C**. To disable the private HTTPS forwarder:

```powershell
tailscale serve --https=443 off
```

You can also revoke the device share in Tailscale.

## Room limit and restarts

Run **one copy of this application's server** for the trial, and keep `.data/admissions.json` intact across restarts. It contains private reservation/release data and is ignored by Git. Do not run a second token server against the same room.

The room counts people, not media tracks: one person can publish a camera, microphone, and screen without taking extra seats. A third join receives a room-full message. A token issued to a still-connecting person reserves their seat. If a tab crashes or a connection is abandoned, allow up to two minutes before retrying; the next join reconciles active participants and revokes abandoned tokens before reusing a seat. A normal **Leave** releases the seat promptly.

If the old unlimited trial room is still active, the server asks everyone to leave and wait for it to close naturally before joining the updated room. It does not delete your active room or kick existing users out. Old sessions with long empty timeouts can take longer than a minute to expire.

LiveKit's reported maximum alone did not reject a pre-issued third token during testing against this Cloud project. Server-side reservations and Cloud token revocation therefore enforce application admission as well. The trial assumes all participant tokens are issued by this one server; it does not govern tokens created independently with the project's API secret.

## Verification

```powershell
npm test
npm run test:browser
```

- `npm test`: independent server tests with fake credentials and a mocked LiveKit service. Verifies token signatures, distinct identities, same-room grants, code validation, concurrent reservations, room-full handling, departure, abandoned reservations, and revocation failures.
- `npm run test:browser`: builds the app and uses installed Google Chrome through Playwright. Uses the existing `.env` to create a temporary verification room in the **same LiveKit project**, then removes only that test room. It uses synthetic camera/microphone/screen sources, not your real desktop.
- The browser suite checks invitation copy/fallback, real two-client video decoding and audio packet reception, simultaneous screen shares, side-by-side placement, maximize/restore, stopped-share recovery, permission errors, third-join rejection, replacement joins, and stale-token rejection.
- Tests run on one computer. They cannot verify the second person's actual hardware permissions or their private-network connection; use the steps above for the final two-computer trial.

No additional LiveKit project is required, and this change does not install Tailscale, publish the app, or modify your credentials.