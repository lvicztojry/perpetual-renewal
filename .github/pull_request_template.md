## Summary

- Relationship AI MVP baseline for 生生不息 / perpetual-renewal.
- Branch: `codex/mvp-release-candidate`
- Baseline commit: `ef4939e feat: build relationship ai mvp baseline`

## Scope

- [ ] Product/docs only
- [ ] Frontend/workspace UI
- [ ] API/backend behavior
- [ ] Prisma/database schema
- [ ] LLM/voice/provider integration
- [ ] Safety/privacy/export/logging
- [ ] QA/CI/release tooling

## Verification

- [ ] `npm run verify:local -- --skip-e2e`
- [ ] `npm run qa:imports`
- [ ] `npm run qa:vault`
- [ ] `npm run verify:local`
- [ ] `npm run verify:release`
- [ ] `npm run verify:deploy` in the target deployment environment before production release
- [ ] `git status --short --ignored`
- [ ] Manual release acceptance: `docs/RELEASE_ACCEPTANCE.md`

## Security And Privacy

- [ ] No real `DATABASE_URL`, API key, vault secret, cron secret, Bearer token, prompt, provider raw payload, or vault ciphertext is committed.
- [ ] User-owned API keys stay in settings vault, `.env.local`, or deployment secrets.
- [ ] Data export, usage logs, config status, model test, and voice fallback do not return secrets or raw provider payloads.

## Deployment Notes

- Production database migration uses `npm run prisma:migrate:deploy`, not interactive development migration.
- Production secrets required before real deployment: `DATABASE_URL`, `USER_KEY_VAULT_SECRET`, `PROACTIVE_CRON_SECRET`, and usable LLM key/model through user vault or deployment secret.
- Voice defaults to `VOICE_PROVIDER=shared-llm`.

## Follow-up Actions

- [ ] Push branch and open PR.
- [ ] Configure production PostgreSQL and secrets before deployment.
