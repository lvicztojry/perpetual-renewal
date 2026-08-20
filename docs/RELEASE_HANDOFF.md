# Release Handoff

本文件用于把当前发布候选交给远端仓库、PR 或后续部署流程。真实 secret 不写入本文件。

## Current Candidate

- Branch: `codex/mvp-release-candidate`
- Baseline commit: `ef4939e feat: build relationship ai mvp baseline`
- Status follow-up commit: `dbd9714 docs: record baseline commit status`
- Handoff follow-up commit: `97fc7e8 docs: add release handoff template`
- Current scope: relationship AI MVP baseline with docs, CI, smoke, E2E, provider adapters, memory, proactive drafts, safety events, usage logs, voice fallback, export, config readiness, and release guardrails.

## Latest Pre-push Verification

Last updated: 2026-08-20

- `npm run docs:check`: passed, 19 docs/readme files.
- `npm run git:boundary`: passed, 147 committable files.
- `npm run secrets:check`: passed, 147 committable files.
- `npm run typecheck`: passed with `next:typegen`.
- `npm run lint`: passed.
- `npm run smoke`: passed, 49 checks.
- `npm run qa:samples`: passed, 10 relationship kinds and 14 safety areas.
- `npm run qa:prompt`: passed, 10 relationship kinds.
- `npm run prisma:validate`: passed.
- `npm run db:smoke`: safely skipped because `DATABASE_URL` is not set.
- `npm run build`: passed.
- `npm run e2e`: passed, 2 tests.
- `npm --cache .\.npm-cache audit --audit-level=high`: passed, 0 vulnerabilities.
- `git status --short --ignored`: source tree clean; only ignored generated folders remain.
- M49 follow-up: `npm run typecheck` now runs `npm run next:typegen` first, and E2E normalizes Next route type imports after stopping the dev server.

## Before Push

Run:

```bash
npm run verify:local -- --skip-e2e
npm run e2e
npm run verify:release
git status --short --ignored
```

Expected local status after commit should only show ignored generated folders such as `.next/`, `.npm-cache/`, `node_modules/`, `test-results/`, and `tsconfig.tsbuildinfo`.

## Push And PR

Push command:

```bash
git push -u origin codex/mvp-release-candidate
```

PR checklist:

- Use `.github/pull_request_template.md`.
- Link `docs/MVP_STATUS.md` for current capability status.
- Link `docs/RELEASE_ACCEPTANCE.md` for manual demo acceptance.
- Link `docs/DEPLOYMENT.md` for production configuration.
- Do not paste real API keys, database URLs, vault secrets, cron secrets, screenshots containing secrets, provider raw payloads, or exported private data.

## CI Expectations

GitHub Actions should run:

```bash
npm ci
npm run secrets:check
npm run docs:check
npm run git:boundary
npm run typecheck
npm run lint
npm run qa:samples
npm run qa:prompt
npm run env:readiness
npm run prisma:validate
npm run db:smoke
npm run smoke
npm run build
```

CI intentionally does not require real `DATABASE_URL`, real LLM key, E2E browser availability, or network audit.

## Production Configuration Still Required

- `DATABASE_URL`: Neon/PostgreSQL connection string in deployment secrets only.
- `USER_KEY_VAULT_SECRET`: production-only strong random secret, at least 32 bytes.
- `PROACTIVE_CRON_SECRET`: separate strong random secret for all-user proactive scheduling.
- LLM: `LLM_PROVIDER=compatible`, `LLM_BASE_URL=https://api.tryanotherone.com/v1`, model selected through settings or server fallback.
- Voice: `VOICE_PROVIDER=shared-llm`, with `VOICE_STT_MODEL` and `VOICE_TTS_MODEL` when the gateway requires audio-specific models.

Generate secrets locally and paste only into local/deployment secret stores:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Run once for `USER_KEY_VAULT_SECRET` and once for `PROACTIVE_CRON_SECRET`.

## Known Non-blocking Local Warnings

- Git may warn that it cannot read `C:\Users\lvicztojry/.config/git/ignore`; this is an environment-level global ignore permission warning.
- `db:smoke` skips when `DATABASE_URL` is not set; this is acceptable locally but not sufficient for production database acceptance.

## Deferred Product Decisions

- Push branch and open PR.
- Configure production PostgreSQL and secrets.
- Decide PWA scope.
- Decide multimedia/photo/contact import scope.
- Decide account deletion policy and confirmation UX.
