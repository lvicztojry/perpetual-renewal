# PR Draft

## Title

生生不息 MVP release candidate

## Summary

This PR promotes the first release-candidate branch for 生生不息, a full-relationship AI companion MVP.

Branch: `codex/mvp-release-candidate`
PR creation page: https://github.com/lvicztojry/perpetual-renewal/pull/new/codex/mvp-release-candidate

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
- `npm run smoke` -> 88 checks
- `npm run qa:samples`
- `npm run qa:prompt`
- `npm run qa:imports`
- `npm run qa:vault`
- `npm run qa:logging`
- `npm run pwa:check`
- `npm run prisma:validate`
- `npm run db:smoke` -> skipped because `DATABASE_URL` is not set
- `npm run e2e` -> 12 tests
- `npm --cache .\.npm-cache audit --audit-level=high` -> 0 vulnerabilities

Before creating or updating the PR, use the current wrapper sequence `npm run verify:local -- --skip-e2e`, `npm run e2e`, and `npm run verify:release`, then re-check live branch state with `git status --short --branch` and push with `git push origin codex/mvp-release-candidate` if needed. Do not hard-code ahead/pushed status in the PR body.

## Production Config Still Required

- `DATABASE_URL`: Neon/PostgreSQL connection string in deployment secrets only.
- `USER_KEY_VAULT_SECRET`: production-only strong random secret, at least 32 bytes.
- `SESSION_COOKIE_SECRET`: optional dedicated session signing secret, at least 32 bytes; if omitted, production must use a strong `USER_KEY_VAULT_SECRET` fallback.
- `PROACTIVE_CRON_SECRET`: separate strong random secret for all-user proactive scheduling.
- LLM: `LLM_PROVIDER=compatible`, `LLM_BASE_URL=https://api.tryanotherone.com/v1`, model selected in settings or deployment secret fallback; API key should be saved in the user vault or deployment secret, never in Git.
- Voice: `VOICE_PROVIDER=shared-llm`; set `VOICE_STT_MODEL` and `VOICE_TTS_MODEL` only when the shared gateway requires audio-specific models.

After production secrets and database are configured, run `npm run verify:deploy` in the target environment before treating deployment readiness as passed.

Do not paste real API keys, database URLs, vault secrets, session secrets, cron secrets, screenshots containing secrets, provider raw payloads, or exported private data into the PR.
