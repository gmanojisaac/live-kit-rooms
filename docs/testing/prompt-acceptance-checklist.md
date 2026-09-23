# Prompt collaboration acceptance checklist (Phase 4)

Use Chrome or Edge on desktop. Distinguish **implemented**, **automated**, and **physical** evidence.

## COL mapping

| ID | Check | Pass? | Notes |
| --- | --- | --- | --- |
| COL-01 | Two peers sync via LiveKit; late joiner gets current text without refresh | | |
| COL-02 | Two users edit different parts; both edits remain; presence shows names | | |
| COL-03 | After debounce, refresh restores prompt; “Saved …” reflects persistence | | |
| COL-04 | Finalize with name; history lists newest first; version read-only | | |
| COL-05 | Copy Prompt → “Copied”; character count live; owner lock → read-only | | |
| COL-06 | End room / expire → editor read-only; versions still readable | | |

## Acceptance tests

| AT | Check | Pass? |
| --- | --- | --- |
| AT-07 | Concurrent prompt — preferably 6 browsers; at minimum 2 | |
| AT-08 | Named versions immutable; concurrent finalize unique numbers | |
| AT-09 | Owner lock/unlock propagates without reload | |
| AT-10 | Refresh / reconnect recovers shared text | |
| AT-13 | Expired/ended room rejects edits | |

## Evidence rule

```text
CRDT collaboration
→ implemented in code
→ automated Yjs merge / 6-peer harness
→ 2-browser concurrency (manual or Playwright multi-context)
→ 6-user physical acceptance (separate session)
```

Do **not** mark six-user physical acceptance from the automated harness alone.
