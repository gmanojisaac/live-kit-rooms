# Demo releases (prototype)

| Release | Git tag | Status |
| --- | --- | --- |
| Release 1.0 | `v1.0.0` | Original application; user verified camera, microphone, and screen sharing with one participant. |
| Release 2.0 | `v2.0.0` | Two-person update; prerelease awaiting user testing. Automated server and browser tests passed. |

The repository is also establishing the **Phase 1 target foundation** (Next.js + Supabase + Vercel). That work does not replace these prototype tags. See [docs/migration-status.md](docs/migration-status.md).

Release 1.0 preserves the exact original commit `31080cc`. Release 2.0 adds private invitation links, unique server-issued participant tokens, admission control, two simultaneous screen shares, and maximize/grid controls. The existing access code and LiveKit credentials are unchanged for the prototype.

## Switch the prototype demo

First click **Leave** in all open room tabs, then stop the running app with **Ctrl+C**. Run these commands from this project folder.

**Original working demo — Release 1.0**

```powershell
git switch --detach v1.0.0
npm ci
npm run prototype:dev
```

On tags created before Phase 1, the script may still be `npm run dev` (Vite + Express). Use whatever `package.json` on that tag defines.

**Two-person trial — Release 2.0 (awaiting your testing)**

```powershell
git switch --detach v2.0.0
npm ci
npm run prototype:dev
```

Open **http://localhost:5173** and refresh the page after switching. Your local `.env` stays in place; do not copy `.env.example` over it.

Tags are fixed snapshots. Detached HEAD is expected for a demo; to resume development on the latest branch, stop the demo and run:

```powershell
git switch main
npm ci
```

If you have edited tracked files, commit or stash those changes before switching. Do not force the checkout or delete untracked files. Do not run both versions' servers at the same time.

## Demo across two computers

For Release 2.0, follow [README.md](README.md) for the private Tailscale HTTPS setup. After switching, use `npm run prototype:build` followed by `npm run prototype:start` when serving the built app through Tailscale (on current branch). Rebuild each time you change releases so `dist` does not contain the previous version.

Local `.data/`, `test-results/`, and `playwright-report/` remain private.

## Verification status

Release 2.0 passed automated server and browser tests and a production Vite build before release preparation. Phase 1 adds separate Next.js foundation tests (`npm test`) and does not claim management acceptance tests have passed.

Release 1.0 is the user-verified demo baseline. Release 2.0 remains a prerelease until you have tested it. The Next.js target stack is a foundation skeleton only.
