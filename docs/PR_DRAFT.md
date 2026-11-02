# PR Draft

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

截至 2026-10-31：真实数据库已恢复，认证/检查点迁移已应用，真实隔离 PostgreSQL 认证与 checkpoint CAS、DB smoke 通过。新增投递迁移通过真实 PostgreSQL 并发/关系验证且已应用到 public schema。QQ SMTP verify 通过，用户完成真实注册、邮件验证及登录。用户 vault 探针成功；此前 tests/qa-vault-provider 真实聊天及独立持久化通过。历史上增强版 vault QA 两次失败均为 kind=provider_response、HTTP 503，记录为当前上游可用性限制；临时 QA 关系对象清理通过。此前成功的真实聊天/独立持久化证据仍保留；模板 fallback 与投递已验证，2026-11-02 已通过真实模型主动生成、手动发送、独立持久化及去重验证；当前账号全局主动开关关闭，自动投递正确拒绝，测试未修改用户偏好。

Priority 4 本机集成验证已通过：模型按关系设定生成主动回响并自动直接送入聊天；每频率周期稳定幂等键、唯一消息关联、Serializable 事务重试及用户/关系关闭开关控制投递，手动发送复用同一路径。记忆采用中英文词面匹配、稳定事实回退与摘录式历史上下文，未实现 embeddings 或模型摘要。

已通过：调度 31 项、投递 19 项、主动模型 24 项、记忆 17 项、定向关系浏览器 7 项；主控确认全量 E2E 40 项通过（59.7 秒），最终 typecheck 通过。Playwright --list JSON 派生基线为 40 tests；完整 memory smoke 保持 94 checks。2026-11-02 增强版真实 vault QA 已通过；公网部署按用户决定暂缓。最新主控确认：完整 memory smoke 94 checks、build 与 qa:auth-access 均通过。

2026-11-02 用户决定继续本机试用，暂缓公网部署；部署平台、套餐与调度方案留待上线时确认。 Cron constraints: [DEPLOYMENT.md](DEPLOYMENT.md#vercel-deployment).

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
