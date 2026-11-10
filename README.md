# Smart Emergency Response & Resource Allocation for Hospitals

A local academic simulation for coordinating emergency reports, hospital capacity, medical supplies, response teams, and dispatch. Use synthetic data only. This is not a clinical triage or production medical system.

## Stack

- Next.js 16 App Router, React, TypeScript, Tailwind CSS
- PostgreSQL for structured operational records, constraints, and transactions
- MongoDB for supplementary incident timeline events
- Zod, Argon2, and HTTP-only database-backed sessions

## Local setup

1. Install Node.js, PostgreSQL, and MongoDB Community Server. Keep MongoDB bound to localhost for this development setup.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local`. Set a private `BOOTSTRAP_ADMIN_PASSWORD` of at least 12 characters. Keep `.env.local` out of Git.
4. Configure `DATABASE_URL` for the local `sera_app` PostgreSQL role and `smart_emergency_response` database, plus the local MongoDB URI and `emergency_ops` database.
5. Run `npm run db:preflight`. It prints connection metadata without passwords and verifies PostgreSQL auth/read/transaction support and MongoDB event collection/indexes.
6. Run `npm run db:migrate`, then `npm run db:seed`. The idempotent seed creates the synthetic demo hospital, admin, beds, resource inventory, response team, and vehicle.
7. Run `npm run dev` and open `http://localhost:3000`. Sign in with the bootstrap username and password configured in `.env.local`.

`scripts/migrate.mjs` is the authoritative ordered migration runner. It uses a PostgreSQL advisory lock, `schema_migrations` tracking, and one transaction per migration. Never edit a migration that has already been applied; add a new numbered migration instead.

## Main workflows

- Sign in as an administrator or hospital staff user.
- Submit an emergency report, review it, and convert it into an incident.
- Update incident severity, priority, assignment, and status; inspect relational history and MongoDB timeline events.
- Reserve and consume/release supplies; reserve/release beds; queue and progress or cancel a dispatch.
- Use the dashboard and analytics pages for database-derived summaries.

Incident, allocation, bed, dispatch, and report mutations are scoped and validated on the server. PostgreSQL is authoritative; MongoDB timeline events are delivered from a transactional PostgreSQL outbox. The databases do not share an atomic transaction. Run the outbox worker alongside Next.js to publish pending events automatically; administrators can inspect and requeue terminal failures at `/admin/outbox`.

The worker polls PostgreSQL for leased batches, publishes idempotently by event UUID, retries with exponential backoff, and marks exhausted events `FAILED`. Configure `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`, and retry settings through `.env.local` as needed.

## Database command demonstrations

Internal application reads run in Next.js Server Components, and mutations run through authenticated Server Actions in `src/app/actions.ts`; the application does not use REST API route handlers for database operations. SQL is parameterized through `pg`, while MongoDB timeline reads and outbox publishing use the official Node.js driver server-side. To inspect and execute the separate disposable DBMS examples against the configured databases, run `npm run db:migrate`, then `npm run db:demo:postgres` and `npm run db:demo:mongo`. The SQL demo uses only a temporary table for its `INSERT`/`UPDATE`/`DELETE`/`DROP` examples; MongoDB demo events are tagged per run and removed when the demonstration finishes.

See [DBMS command implementation](docs/DBMS_COMMAND_IMPLEMENTATION.md) for the source/query map, expected outputs, and TA walkthrough.

## Commands

```powershell
npm run dev
npm run db:preflight
npm run db:migrate
npm run db:seed
npm run db:demo:postgres
npm run db:demo:mongo
npm run db:outbox:worker
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

Run `npm run dev` in one terminal and `npm run db:outbox:worker` in another. `npm run db:seed` is only for initial synthetic setup; it is not needed after ordinary code changes. Playwright runs the browser workflow against a local app and configured PostgreSQL/MongoDB services.

See [the team contract](docs/TEAM_CONTRACT.md), [implementation audit](docs/IMPLEMENTATION_AUDIT.md), and [verification report](docs/TEST_REPORT.md) for schema/API boundaries, remaining work, and actual verification results.
