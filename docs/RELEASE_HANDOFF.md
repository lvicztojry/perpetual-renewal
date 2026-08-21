# Release Handoff

本文件用于把当前发布候选交给远端仓库、PR 或后续部署流程。真实 secret 不写入本文件。

## Current Candidate

- Branch: `codex/mvp-release-candidate`
- Remote branch: `origin/codex/mvp-release-candidate`
- Baseline commit: `ef4939e feat: build relationship ai mvp baseline`
- Status follow-up commit: `dbd9714 docs: record baseline commit status`
- Handoff follow-up commit: `97fc7e8 docs: add release handoff template`
- M56 implementation commit: `d7a72f2 docs: sync taskbook status gates`
- M66 release-gate commit: `fd6778a test: isolate memory fallback and derive release gates`
- Recent release-candidate commits include M49-M73 stabilization, runtime hardening, PRD scope sync, QA expansion, export privacy hardening, fallback isolation, release gate cleanup, proactive scheduler handoff guardrails, relationship-state API persistence cleanup, JSON input guardrails, runtime handoff metadata cleanup, and database documentation state sync.
- Live ahead/push state is intentionally not hard-coded here; check it with `git status --short --branch` immediately before handoff or push.
- M51 scope: import candidate dedupe.
- M52 scope: shared-LLM voice metadata hardening.
- M53 scope: proactive scheduler `maxDrafts` guardrail.
- M54 scope: construction decision points clarified into decided baselines vs. remaining user decisions.
- M55 scope: session `userId` integration status settled in Taskbook.
- M56 scope: Taskbook task-definition statuses synced with the current task snapshot and guarded by `docs:check`.
- M57 scope: account deletion confirmation flow, current-user data cleanup, and smoke coverage.
- M58 scope: PWA manifest, app icons, offline shell, and API-skipping service worker.
- M59 scope: structured media/photo/contact import planner, privacy-preserving browser-only file summaries, and workspace import UI.
- M60 scope: PRD v0.3 scope sync and docs consistency guardrails.
- M61 scope: import/voice API input hardening and expanded smoke coverage.
- M62 scope: vault fingerprint hardening, broader secret scanning, PWA check, PR/deploy verification scripts.
- M63 scope: PR template/docs link and documented npm script consistency checks.
- M64 scope: structured import planner QA and config/vault security QA.
- M65 scope: export scrub string-level secret redaction, ProviderCredential DB smoke coverage, settings/privacy E2E expansion, and volatile push-state docs guard.
- M66 scope: memory fallback session/user isolation, proactive all-user cron auth guard coverage, and docs metrics derived from test sources.
- M67 scope: proactive scheduler architecture/deployment wording guard, PR draft path/status sync, and production-only `verify:deploy` handoff wording.
- M68 scope: relationship-state API now reads/writes session-scoped repository state instead of returning early mock metadata.
- M69 scope: core write APIs reject invalid JSON bodies with friendly 400 responses and no parser internals.
- M70 scope: remaining high/medium-risk JSON write APIs require object bodies, return friendly 400s for invalid or non-object JSON, and avoid leaking parser internals, TypeError text, stack traces, Bearer/baseUrl strings, or secret-shaped content.
- M71 scope: all API JSON parsing now routes through shared helpers; chat, import, voice, and proactive scheduler inputs share invalid/non-object 400 behavior while proactive scheduler keeps empty-body default dry-run compatibility.
- M72 scope: safety check responses no longer expose stale `next`/`DEV-11` handoff metadata, with smoke coverage across the safety sample set.
- M73 scope: database docs now match current session-scoped repository behavior and relationship-state persistence, replacing stale mock-dev/mock-oriented wording.
- Current scope: relationship AI MVP baseline with docs, CI, smoke, E2E, provider adapters, memory, proactive drafts, safety events, usage logs, voice fallback, export, config readiness, and release guardrails.
- PR creation page: https://github.com/lvicztojry/perpetual-renewal/pull/new/codex/mvp-release-candidate
- PR body draft: [PR_DRAFT.md](PR_DRAFT.md)

## Latest Pre-push Verification

Last updated: 2026-08-21

- `npm run docs:check`: passed.
- `npm run git:boundary`: passed.
- `npm run secrets:check`: passed.
- `npm run typecheck`: passed with `next:typegen`.
- `npm run lint`: passed.
- `npm run smoke`: passed, 74 checks.
- `npm run qa:samples`: passed, 10 relationship kinds and 19 safety areas.
- `npm run qa:prompt`: passed, 10 relationship kinds.
- `npm run qa:imports`: passed.
- `npm run qa:vault`: passed.
- `npm run pwa:check`: passed.
- `npm run prisma:validate`: passed.
- `npm run db:smoke`: safely skipped because `DATABASE_URL` is not set.
- `npm run build`: passed.
- `npm run e2e`: passed, 7 tests.
- `npm --cache .\.npm-cache audit --audit-level=high`: passed, 0 vulnerabilities.
- `git status --short --ignored`: the latest full verification snapshot reported a clean source tree with only ignored generated folders. Re-check after any handoff/documentation edits.
- M49 follow-up: `npm run typecheck` now runs `npm run next:typegen` first, and E2E normalizes Next route type imports after stopping the dev server.
- M56 follow-up: `npm run docs:check` now also verifies key Taskbook task-definition statuses stay aligned with the current task snapshot.
- M57-M66 follow-up: smoke now covers account deletion, PWA static assets, invalid import JSON, voice validation errors, vault/secret hardening, export scrub of accidental high-risk strings, memory fallback session isolation, and all-user cron auth boundaries; dedicated QA now covers structured import planner compatibility, config/vault security, settings/privacy E2E paths, and memory isolation E2E.

## Before Push Or PR Update

Run:

```bash
npm run verify:local -- --skip-e2e
npm run e2e
npm run verify:release
git status --short --ignored
```

Expected local status after commit should only show ignored generated folders such as `.next/`, `.npm-cache/`, `node_modules/`, `test-results/`, and `tsconfig.tsbuildinfo`.

Run `npm run verify:deploy` only in the target deployment environment after `DATABASE_URL`, `USER_KEY_VAULT_SECRET`, and `PROACTIVE_CRON_SECRET` are configured. A local machine without those production secrets should not mark deploy readiness as passed.

## Push And PR

Check live branch state:

```bash
git status --short --branch
```

Push command:

```bash
git push origin codex/mvp-release-candidate
```

PR checklist:

- Use `.github/pull_request_template.md`.
- Use [PR_DRAFT.md](PR_DRAFT.md) as the prefilled summary and verification notes.
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
npm run qa:imports
npm run qa:vault
npm run env:readiness
npm run prisma:validate
npm run db:smoke
npm run pwa:check
npm run smoke
npm run build
```

CI intentionally does not require real `DATABASE_URL`, real LLM key, E2E browser availability, or network audit.

Production deploy candidates should additionally run `npm run verify:deploy` in the target environment. That command uses strict readiness, Prisma validation, and DB smoke, so it must not be treated as passed when `DATABASE_URL`, `USER_KEY_VAULT_SECRET`, or `PROACTIVE_CRON_SECRET` are missing.

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

- Configure production PostgreSQL and secrets.
