# PR Draft

历史 PR 草稿：下文保留当时的首版候选描述，不能原样作为新 PR 的当前范围或验证结果。新 PR 按实际 diff 编写，流程见 [RELEASE_HANDOFF.md](RELEASE_HANDOFF.md)，当前事实见 [MVP_STATUS.md](MVP_STATUS.md)。

当前能力、验收日期和施工顺序统一见 [项目当前状态](MVP_STATUS.md)；本页保留操作流程和历史说明。

## Title

生生不息 MVP release candidate

## Summary

This PR promotes the first release-candidate branch for 生生不息, a full-relationship AI companion MVP.

Branch: `codex/mvp-release-candidate`
PR creation page: https://github.com/lvicztojry/perpetual-renewal/pull/new/codex/mvp-release-candidate

Included capabilities:

October 26 scope: M136 conversation switching isolation, M137 STT locale normalization, M138 durable scheduler checkpoint/keyset fairness, M139 self-hosted email/password authentication and SMTP/HTTP mail, M140 dependency security refresh. M136–M138 local regressions passed; As of 2026-10-31, M139 passed real isolated PostgreSQL auth/checkpoint integration, current DB migrations, QQ SMTP verify and actual user registration/email verification/login. Registration requires email verification; legacy email-only users recover via their mailbox. v2 password sessions expire server-side and are revoked after reset; mail links carry fragment tokens. `AUTH_MODE=local-email` is only for explicit nonproduction tests. New deployment targets and HTTP delivery require independent verification.

- Full relationship object creation across romantic, family, friend, mentor, substitute, memorial, ex, public-figure-imagined, fictional, original, and custom kinds.
- Chat loop with persistence, regeneration, deletion, important marks, memory extraction, and relationship state updates.
- Provider-neutral LLM adapters, user-level encrypted API key vault, model list/test flow, and shared-LLM voice fallback.
- Proactive in-app drafts with custom frequency, playful non-blaming follow-ups, safety filtering, protected cron endpoint, and cost guardrails.
- Memory lifecycle, text/JSONL/JSON import, duplicate detection, structured media/photo/contact import summaries, and no raw file upload.
- Account deletion with explicit confirmation phrase and current-user data cleanup.
- PWA manifest, app icons, offline shell, and service worker that skips API response caching.
- Safety rules/events, usage/cost dashboard, data export without secrets, responsive workspace, docs, CI, and release guardrails.

## Verification

Historical local verification on 2026-08-23 (does not verify October changes):

Historical results (2026-10-26): audit initially reported 6 vulnerabilities (5 high, 1 critical); main confirmed zero after Next.js/eslint-config-next 16.4.3 and transitive upgrades, plus lint/typecheck/build and 32 E2E cases. Early database_unreachable at CREATE SCHEMA applied no migrations; that blocker is resolved.





- `npm run typecheck`
- `npm run lint`
- `npm run docs:check`
- `npm run secrets:check`
- `npm run git:boundary`
- `npm run build`
- `npm run smoke` -> 94 checks
- `npm run qa:samples`
- `npm run qa:prompt`
- `npm run qa:imports`
- `npm run qa:vault`
- `npm run qa:logging`
- `npm run qa:response`
- `npm run qa:providers`
- `npm run qa:voice`
- `npm run qa:voice-language`
- `npm run qa:auth`
- `npm run qa:proactive-scheduler`
- `npm run qa:proactive-cron`
- `npm run qa:real-provider:fake`
- Historical (2026-08-23) `npm run env:readiness -- --strict` -> missing=0, warning=3; current production HTTPS callback validation remains pending.
- `npm run pwa:check`
- `npm run prisma:validate`
- `npm run db:smoke` -> passed against real Neon/PostgreSQL
- M135 historical `npm run e2e` -> 15 tests (2026-08-23)
- `npm --cache .\.npm-cache audit --audit-level=high` -> 0 vulnerabilities

Before creating or updating the PR, use the current wrapper sequence `npm run verify:local -- --skip-e2e`, `npm run e2e`, and `npm run verify:release`, then re-check live branch state with `git status --short --branch` and push with `git push origin codex/mvp-release-candidate` if needed. Do not hard-code ahead/pushed status in the PR body.

## Production Config To Mirror

当前 QQ SMTP 授权码配置及 verify、实际注册收件均已验证。剩余生产配置是将本地 HTTP 的 `AUTH_APP_URL` 换为用户可访问的 HTTPS 回调，再在目标环境复跑严格 readiness/verify:deploy；该待办不表示缺少 QQ 密码。readiness 已分别检查邮件凭据和生产 HTTPS 回调，12 项隔离测试通过，安全阈值保持不变。

- Auth mail: `AUTH_APP_URL`, `AUTH_MAIL_FROM`, `AUTH_MAIL_TRANSPORT=smtp`, `AUTH_SMTP_HOST/PORT/USER/PASSWORD`; personal mailbox app-password tests require no owned domain. Optional HTTP uses `AUTH_MAIL_TRANSPORT=http` and `AUTH_MAIL_API_URL/KEY`. Verify live inbox delivery and target auth/checkpoint migrations separately.

- `DATABASE_URL`: Neon/PostgreSQL connection string in deployment secrets only.
- `USER_KEY_VAULT_SECRET`: production-only strong random secret, at least 32 bytes.
- `SESSION_COOKIE_SECRET`: optional dedicated session signing secret, at least 32 bytes; if omitted, production must use a strong `USER_KEY_VAULT_SECRET` fallback.
- `PROACTIVE_CRON_SECRET`: separate strong random secret for all-user proactive scheduling.
- LLM: `LLM_PROVIDER=compatible`, `LLM_BASE_URL=https://api.tryanotherone.com/v1`, model selected in settings or deployment secret fallback; API key should be saved in the user vault or deployment secret, never in Git.
- Voice: `VOICE_PROVIDER=shared-llm`; set `VOICE_STT_MODEL` and `VOICE_TTS_MODEL` only when the shared gateway requires audio-specific models.

Historical (2026-08-23) local configuration passed strict readiness, DB smoke and deploy verification. Current DB and QQ mail credentials are verified; local HTTP AUTH_APP_URL still needs a production HTTPS callback. Mirror configuration into the chosen target and rerun `npm run verify:deploy` there.

Do not paste real API keys, database URLs, vault secrets, session secrets, cron secrets, screenshots containing secrets, provider raw payloads, or exported private data into the PR.
