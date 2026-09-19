# Demo releases

| Release | Git tag | Status |
| --- | --- | --- |
| Release 1.0 | `v1.0.0` | Original application; user verified camera, microphone, and screen sharing with one participant. |
| Release 2.0 | `v2.0.0` | Two-person update; prerelease awaiting user testing. Automated server and browser tests passed. |

Release 1.0 preserves the exact original commit `31080cc`. Release 2.0 adds private invitation links, unique server-issued participant tokens, two-person admission control, two simultaneous screen shares, and maximize/grid controls. The existing access code and LiveKit credentials are unchanged.

## Switch the demo

First click **Leave** in all open room tabs, then stop the running app with **Ctrl+C**. Run these commands from this project folder.

**Original working demo — Release 1.0**

```powershell
git switch --detach v1.0.0
npm ci
npm run dev
```

**Two-person trial — Release 2.0 (awaiting your testing)**

```powershell
git switch --detach v2.0.0
npm ci
npm run dev
```

Open **http://localhost:5173** and refresh the page after switching. Your local `.env` stays in place; do not copy `.env.example` over it.

Tags are fixed snapshots. Detached HEAD is expected for a demo; to resume development on the latest branch, stop the demo and run:

```powershell
git switch main
npm ci
```

If you have edited tracked files, commit or stash those changes before switching. Do not force the checkout or delete untracked files. Do not run both versions' servers at the same time.

## Demo across two computers

For Release 2.0, follow [README.md](README.md) for the private Tailscale HTTPS setup. After switching, use `npm run build` followed by `npm start` when serving the built app through Tailscale. Rebuild each time you change releases so `dist` does not contain the previous version.

The old Release 1.0 room can remain open briefly after leaving. Release 2.0 may ask you to wait until it closes naturally before it can start with the two-person limit. No Cloud project or credentials need to be changed.

Local `.data/`, `test-results/`, and `playwright-report/` remain private. This checkout also excludes these through `.git/info/exclude` so they stay excluded while viewing the older release.

## Verification status

Release 2.0 passed 10 server tests, 2 browser tests, and a production build before release preparation. The browser tests used synthetic media over real LiveKit connections in temporary test rooms within the existing project. They do not replace your manual two-computer acceptance test.

Release 1.0 is the user-verified demo baseline. Release 2.0 remains a prerelease until you have tested it.
