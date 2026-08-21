# Release Handoff

本文件用于把当前发布候选交给远端仓库、PR 或后续部署流程。真实 secret 不写入本文件。

## Current Candidate

- Branch: `codex/mvp-release-candidate`
- Remote branch: `origin/codex/mvp-release-candidate`
- Current branch tip: check `git status --short --branch` and `git log -1 --oneline` immediately before handoff or push.
- Initial baseline commit: `ef4939e feat: build relationship ai mvp baseline`
- Status follow-up commit: `dbd9714 docs: record baseline commit status`
- Handoff follow-up commit: `97fc7e8 docs: add release handoff template`
- M56 implementation commit: `d7a72f2 docs: sync taskbook status gates`
- M66 release-gate commit: `fd6778a test: isolate memory fallback and derive release gates`
- Recent release-candidate commits include M49-M98 stabilization, runtime hardening, PRD scope sync, QA expansion, export privacy hardening, fallback isolation, release gate cleanup, proactive scheduler handoff guardrails, relationship-state API persistence cleanup, JSON input guardrails, runtime handoff metadata cleanup, database documentation state sync, runtime code boundary gates, runtime privacy hardening, memory API coverage, API/export privacy boundary hardening, API validation error hardening, model-list provider branch coverage, proactive duplicate-draft guard coverage, manual memory input guard coverage, memory edit validation, settings model-list privacy E2E coverage, chat message validation coverage, import error recovery E2E coverage, companion validation boundary coverage, usage range validation, relationship form failure recovery, deferred operations-feedback wording, credential endpoint type validation, export token redaction hardening, settings save-error redaction, voice transcription metadata validation, release wording sync, workspace error redaction, model connection failure privacy coverage, private no-store API response boundaries, and signed session cookie hardening.
- Live ahead/push state is intentionally not hard-coded here; check it with `git status --short --branch` immediately before handoff or push.
- M51 scope: import candidate dedupe.
- M52 scope: shared-LLM voice metadata hardening.
- M53 scope: proactive scheduler `maxDrafts` guardrail.
- M54 scope: construction decision points clarified into decided baselines vs. remaining external setup.
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
- M74 scope: git boundary now blocks direct `request.json()` calls in API routes and `DEV-*` handoff metadata in runtime `src/app` or `src/lib` code.
- M75 scope: runtime fallback warnings are sanitized, user LLM vault status no longer returns Base URL plaintext or a `baseUrl` field, model-list errors use stable friendly copy, smoke covers profile-driven proactive disable and endpoint privacy, and docs checks guard BYOK/TryAnotherOne/shared-LLM/deferred-product scope.
- M76 scope: smoke now covers manual companion memory candidate creation success, list visibility, and unsupported memory type rejection.
- M77 scope: credential save errors are mapped to stable safe copy, voice unsupported-provider fallback no longer echoes misconfigured env values, export scrubs profile fields, and git boundary blocks raw API error/voice payload regressions.
- M78 scope: import/profile/account validation errors no longer directly return exception messages; smoke covers rejected profile updates avoiding partial writes; git boundary blocks direct API `error.message` responses.
- M79 scope: smoke covers saved non-compatible LLM providers rejecting `/api/me/llm-models` with stable compatible-gateway copy and no key, endpoint, Bearer, `baseUrl`, or raw payload leakage.
- M80 scope: smoke covers saved proactive drafts becoming the scheduler anchor so an immediate second run at the same `now` does not generate or save duplicate drafts.
- M81 scope: smoke covers manual memory creation preserving `sourceMessageId`, rejecting unknown `sourceMessageId`, and rejecting blank content with stable 400 copy.
- M82 scope: smoke covers blank memory edits returning stable 400 and preserving the existing memory content.
- M83 scope: settings E2E covers model-list read/select success and failure without displaying the full user API key.
- M84 scope: smoke covers blank chat messages and invalid regenerate targets returning stable validation copy without raw exception details.
- M85 scope: relationship-flow E2E covers recovering from a broken `.json` import by showing stable copy, keeping the import action disabled, and then successfully selecting a valid `.jsonl` file.
- M86 scope: companion create/update validation now returns stable white-listed 400 copy for blank names, blank speaking styles, and unsupported relationship kinds; rejected creates do not persist records and rejected edits do not partially mutate companion fields.
- M87 scope: usage dashboard `rangeDays` rejects non-finite or out-of-range values with stable copy and no query/key/Base URL/prompt/raw payload leakage.
- M88 scope: relationship create/edit failure UI reads safe server copy, keeps drafts editable, restores the submit button, and has E2E coverage for create failure recovery.
- M89 scope: PRD/Taskbook/deployment wording confirms moderation admin, feedback survey, and beta invite mechanisms stay deferred for the first release.
- M90 scope: LLM credential save rejects non-string `baseUrl` values with stable validation copy and no submitted key or endpoint field leakage.
- M91 scope: export snapshot string scrub now redacts common external token shapes such as GitHub PAT/`ghp_` values accidentally stored in user content.
- M92 scope: settings credential errors are redacted in the browser before display, covering model list, connection test, and save failures while preserving retryable drafts.
- M93 scope: voice transcription validates metadata fields for unsafe filenames, invalid language tags, and overlong mock transcripts without leaking Bearer, prompt, raw payload, or user config values.
- M94 scope: release docs now sync the 85 smoke checks / 10 E2E tests baseline, `qa:logging`, Neon-first PostgreSQL deployment guidance, compatible TryAnotherOne gateway wording, BYOK, and `VOICE_PROVIDER=shared-llm`.
- M95 scope: workspace error display now redacts Bearer, API key-shaped strings, Base URLs, prompt/raw payload/debug fields, and stack-like frames before rendering backend or exception messages.
- M96 scope: LLM connection test and model-list failure paths now cover URL construction, provider HTTP, and fetch failures without returning API keys, Bearer headers, endpoint/Base URL values, prompt, raw payload, stack, or low-level transport text.
- M97 scope: API JSON responses now use a shared private no-store helper so user data, settings, model, usage, voice, memory, chat, export, proactive, and safety endpoints carry cache-busting private response headers.
- M98 scope: email session cookies now store HMAC-signed payloads instead of raw user ids; smoke covers forged raw userId cookies, login cookie attributes, logout clearing, and account-delete clearing.
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
- `npm run smoke`: passed, 87 checks.
- `npm run qa:samples`: passed, 10 relationship kinds and 19 safety areas.
- `npm run qa:prompt`: passed, 10 relationship kinds.
- `npm run qa:imports`: passed.
- `npm run qa:vault`: passed.
- `npm run qa:logging`: passed.
- `npm run pwa:check`: passed.
- `npm run prisma:validate`: passed.
- `npm run db:smoke`: safely skipped because `DATABASE_URL` is not set.
- `npm run build`: passed.
- `npm run e2e`: passed, 11 tests.
- `npm --cache .\.npm-cache audit --audit-level=high`: passed, 0 vulnerabilities.
- `git status --short --ignored`: the latest full verification snapshot reported a clean source tree with only ignored generated folders. Re-check after any handoff/documentation edits.
- M49 follow-up: `npm run typecheck` now runs `npm run next:typegen` first, and E2E normalizes Next route type imports after stopping the dev server.
- M56 follow-up: `npm run docs:check` now also verifies key Taskbook task-definition statuses stay aligned with the current task snapshot.
- M57-M98 follow-up: smoke now covers account deletion, PWA static assets, invalid import JSON, voice validation errors, vault/secret hardening, export scrub of accidental high-risk strings, memory fallback session isolation, all-user cron auth boundaries, private no-store API response headers, and signed session cookie anti-forgery; dedicated QA now covers structured import planner compatibility, config/vault security, settings/privacy E2E paths, and memory isolation E2E.

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
npm run qa:logging
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

- Deferred by product decision for first release: paid subscription/quota system, moderation admin, feedback survey, and beta invite mechanism.
- Remaining external setup: configure production PostgreSQL and secrets.
