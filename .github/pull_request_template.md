## Summary

<!-- What changed and why (1–3 sentences). -->

## Type of change

- [ ] Foundation / infrastructure
- [ ] Feature (later phases)
- [ ] Bug fix
- [ ] Documentation
- [ ] Tests only

## Checklist

- [ ] Owner is identified (assignee or PR description)
- [ ] Acceptance criterion is stated below
- [ ] Test evidence is attached or linked below
- [ ] Acceptance evidence is attached or linked below (or marked N/A with reason)
- [ ] Documentation updated (`README.md`, `docs/*`, `RELEASES.md` as applicable)
- [ ] Security / privacy reviewed (no credentials, access codes, participant names, or screen images in the PR, screenshots, or logs)
- [ ] Secrets remain server-only (`LIVEKIT_API_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` never under `NEXT_PUBLIC_*`)
- [ ] Prototype tests were not deleted to make migration look cleaner

## Acceptance criterion

<!-- Measurable statement of done for this PR. -->

## Test evidence

<!-- Commands run + results, CI links, or screenshots that do not include secrets/PII/screen content. -->

```text
npm test
npm run test:prototype
npm run build
```

## Acceptance evidence

<!-- How a reviewer can confirm the acceptance criterion. -->

## Security / privacy

- [ ] No `.env` / real keys committed
- [ ] No invitation tokens or access codes in the diff
- [ ] No participant personal data or real screen captures

## Notes for reviewers

<!-- Dual-stack reminder: prototype (Vite/Express) vs target (Next/Supabase/Vercel). -->
