# Database

## Phase 2 Database Track

The renewal domain now has two repository implementations:

- `PrismaRenewalRepository`: primary path when `DATABASE_URL` is present.
- `InMemoryRenewalRepository`: demo path only when no database is configured, or when `RENEWAL_REPOSITORY=memory` is set deliberately.

M120 persistence rule: once `DATABASE_URL` is configured, Prisma is the active repository and connection/write errors must surface instead of silently falling back to memory. This keeps local real trials and deployment candidates from looking saved when PostgreSQL is unavailable.

Covered Prisma-backed records:

- `Companion`
- `Conversation`
- `Message`
- `Memory`
- `RelationshipState`
- `ProactiveMessage`
- `SafetyEvent`

## Migration

Initial migration:

```text
prisma/migrations/20260820000000_initial/migration.sql
```

It creates:

- all relationship, message, memory, proactive-message, and safety enums;
- all core tables;
- indexes for user/companion/message/memory lookup;
- cascade/nullify foreign keys for account deletion and source message cleanup.

## Local Setup

1. Copy `.env.example` to `.env.local` for local real trials.
2. Set `DATABASE_URL` to a PostgreSQL database. For Neon, `DATABASE_URL` can be the pooled application URL; optionally set `DATABASE_URL_UNPOOLED` to the direct URL for Prisma migrations.
3. Run:

```bash
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate
npm run prisma:seed
```

`npm run prisma:validate` only validates schema shape. If `DATABASE_URL` is not set, it injects a local placeholder URL so validation can run before PostgreSQL is started.

`npm run prisma:seed` creates a demo user, one seed companion, one conversation, a relationship state, one assistant message, and one active memory.

## DB Smoke

Run this before pointing a preview or production deployment at Neon/PostgreSQL:

```bash
npm run db:smoke
```

Behavior:

- If `DATABASE_URL` is not set in the shell, `.env.local`, or `.env`, the command exits successfully with a skip message.
- If `DATABASE_URL` is set, the command first runs Prisma generate and validate, then writes and reads a dedicated test graph.
- The script sanitizes command output and never prints the configured database URL.
- The script deletes the dedicated test user at the start and end, then verifies related test rows were removed.

The smoke creates and then removes:

- `User`
- `Companion`
- `Conversation`
- two `Message` rows
- active `Memory` linked to a source message
- `RelationshipState`
- proactive draft
- redacted `SafetyEvent` with hash fields only
- `ModelUsageLog` linked to user, companion, conversation, and message

It does not store real user text, prompts, API keys, gateway base URLs, or the real `DATABASE_URL`.

For a fresh local development database, run migrations before the smoke:

```bash
npm run prisma:migrate
npm run db:smoke
```

For a preview or production Neon/PostgreSQL database, apply committed migrations with:

```bash
npm run prisma:migrate:deploy
npm run db:smoke
```

For deployment readiness, mirror the local env/secrets into the target environment and run `npm run verify:deploy` against that target. A local `db:smoke` pass proves the local configuration only; a skip result is acceptable for unconfigured local/CI baselines but is not a production database gate.

When `DATABASE_URL_UNPOOLED` is configured, `npm run prisma:migrate` and `npm run prisma:migrate:deploy` temporarily use it for the Prisma CLI. App runtime queries and `db:smoke` continue to use `DATABASE_URL`.

## Fallback Behavior

If `DATABASE_URL` is missing, the renewal service uses the in-memory demo repository directly.

If `DATABASE_URL` is present but the database is unavailable, repository calls fail with the Prisma error path. They do not fall back to the in-memory demo store in local development, preview, or production.

Set this to force the demo store even when a database URL exists:

```bash
RENEWAL_REPOSITORY="memory"
```

## Current Limits

- DB smoke validates direct Prisma persistence, not the full HTTP app running against PostgreSQL.
- Renewal API routes use `getCurrentSession()` and are scoped by the current session userId. Local development supports email sessions plus a fallback demo user when no explicit login exists.
- The relationship-state API is repository-backed: reads and writes use the same configured repository as the main renewal workspace, with Prisma active whenever `DATABASE_URL` is configured.
