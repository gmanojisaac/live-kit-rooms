# Repository workflow

Management working rules: every task needs an **owner**, **acceptance criterion**, **test evidence**, and **status**. Changes land through PR review onto protected `main`.

## Branching

1. Branch from `main` (or the current integration branch agreed by the team).
2. Open a pull request using the repository PR template.
3. Include test evidence and acceptance evidence in the PR body.
4. Require review before merge.

## GitHub branch protection (manual setup — not verified from this environment)

Configure on GitHub for `main` (Settings → Branches → Branch protection rules):

```text
main protected
1 approval required
status checks required where available
```

Additional recommended settings:

- Do not allow force pushes
- Do not allow deletions
- Require branches to be up to date before merging (when CI exists)

**Status:** repository templates and this document are in-tree. Branch protection itself is **external** and must be confirmed in the GitHub UI or via `gh api`.

## Issue tracking

Use `.github/ISSUE_TEMPLATE/` forms. Each issue should state owner, acceptance criterion, and how test evidence will be captured.

## Prototype vs target

- Target MVP work: Next.js / `app/` / `lib/` / `supabase/`
- Prototype reference: Vite + Express (`src/`, `server/`) via `npm run prototype:*`
- Do not delete prototype tests to “clean up” migration PRs
