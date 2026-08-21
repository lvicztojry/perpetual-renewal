# PR Draft

## Title

生生不息 MVP release candidate

## Summary

This PR promotes the first release-candidate branch for 生生不息, a full-relationship AI companion MVP.

Included capabilities:

- Full relationship object creation across romantic, family, friend, mentor, substitute, memorial, ex, public-figure-imagined, fictional, original, and custom kinds.
- Chat loop with persistence, regeneration, deletion, important marks, memory extraction, and relationship state updates.
- Provider-neutral LLM adapters, user-level encrypted API key vault, model list/test flow, and shared-LLM voice fallback.
- Proactive in-app drafts with custom frequency, playful non-blaming follow-ups, safety filtering, protected cron endpoint, and cost guardrails.
- Memory lifecycle, text/JSONL/JSON import, duplicate detection, structured media/photo/contact import summaries, and no raw file upload.
- Account deletion with explicit confirmation phrase and current-user data cleanup.
- PWA manifest, app icons, offline shell, and service worker that skips API response caching.
- Safety rules/events, usage/cost dashboard, data export without secrets, responsive workspace, docs, CI, and release guardrails.

## Verification

Latest local verification on 2026-08-21:

- `npm run typecheck`
- `npm run lint`
- `npm run docs:check`
- `npm run secrets:check`
- `npm run git:boundary`
- `npm run build`
- `npm run smoke` -> 69 checks
- `npm run qa:samples`
- `npm run qa:prompt`
- `npm run prisma:validate`
- `npm run db:smoke` -> skipped because `DATABASE_URL` is not set
- `npm run e2e` -> 2 tests
- `npm --cache .\.npm-cache audit --audit-level=high` -> 0 vulnerabilities

## Production Config Still Required

- `DATABASE_URL`: Neon/PostgreSQL connection string in deployment secrets only.
- `USER_KEY_VAULT_SECRET`: production-only strong random secret.
- `PROACTIVE_CRON_SECRET`: separate strong random secret for all-user proactive scheduling.
- LLM key/model: user vault via settings page or deployment secret fallback.

Do not paste real API keys, database URLs, vault secrets, cron secrets, screenshots containing secrets, provider raw payloads, or exported private data into the PR.
