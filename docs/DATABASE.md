# Database

## Phase 2 Database Track

The renewal domain now has two repository implementations:

- `PrismaRenewalRepository`: primary path when `DATABASE_URL` is present.
- `InMemoryRenewalRepository`: local development fallback when no database is configured or Prisma cannot reach the database in non-production.

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

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to a PostgreSQL database.
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

## Fallback Behavior

If `DATABASE_URL` is missing, the renewal service uses the in-memory demo repository directly.

If `DATABASE_URL` is present but the database is unavailable in local development, repository calls fall back to the in-memory demo store and log one warning. Production does not fall back; Prisma errors are thrown so deployment problems are visible.

Set this to force the demo store even when a database URL exists:

```bash
RENEWAL_REPOSITORY="memory"
```

## Current Limits

- DB smoke validates direct Prisma persistence, not the full HTTP app running against PostgreSQL.
- Renewal API routes now use `getCurrentSession()`, but authentication is still a mock-dev session.
- Relationship-state standalone API remains mock-oriented; the main renewal workspace path is repository-backed.
