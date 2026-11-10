# Verification report

Run locally on 2026-11-03 (Asia/Calcutta). No credential values are recorded here. Phase 2 checks are appended below; the original setup evidence remains above and is not presented as a rerun.

| Check | Result | Evidence |
|---|---|---|
| `npm run db:preflight` | Passed | PostgreSQL URL parsed; `sera_app` connected to `smart_emergency_response`; read and transaction checks passed. Mongo ping, insert/retrieve, and indexes passed on `127.0.0.1:27017/emergency_ops`. |
| `npm run db:migrate` | Passed | Applied migrations `001_core.sql` through `006_reporting.sql` to a target with zero prior application tables. |
| `npm run db:seed` | Passed | Synthetic hospital/admin, 4 beds, 3 inventory lines, demo response team, and demo vehicle; safe to rerun. |
| `npm run test:db` | Passed | 1 PostgreSQL integration test passed; it exercised schema objects and rollback of a rejected inventory reservation. |
| `npm run typecheck` | Passed | `tsc --noEmit`. |
| `npm run lint` | Passed | ESLint with no warnings. |
| `npm run build` | Passed | Next.js 16.4.4 production build completed. |
| Authenticated HTTP workflow | Passed | Login; report submit/review/convert; allocation consume; bed reservation via dispatch; dispatch through completion; incident through resolution; outbox publish; Mongo timeline read; dashboard. |
| Negative API paths | Passed | Unauthenticated API returned 401; insufficient stock, duplicate active bed, and unavailable team/vehicle returned 409; bed release and dispatch cancellation released their resources. |
| Requested frontend routes | Passed | All requested pages returned HTTP 200 in the authenticated local dev server: dashboard, incidents/new, reports/analytics, hospitals, beds, resources, teams, vehicles, dispatch, admin users. `/login` redirected to `/dashboard` for the authenticated session. |

The API workflow published 13 outbox events with zero failures; the incident timeline returned all 13 MongoDB events. PostgreSQL contains 19 application tables plus `schema_migrations`, 2 reporting views, the reservation/audit/role functions, and the installed trigger definitions. MongoDB `incident_events` has the unique `eventId` index and compound `{ incidentId, occurredAt }` index (plus the standard `_id` index).

## Member B phase verification

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | Passed | `tsc --noEmit`. |
| `npm run lint` | Passed | ESLint. |
| `npm test` | Passed | 4 tests: concurrent inventory/bed/dispatch invariants, outbox claim/idempotency/retry/dead-letter integration, schema/allocation rollback, and outbox core UUID idempotency. |
| `npm run test:e2e` | Passed | Playwright Chromium completed the report-to-incident-to-dispatch workflow, hospital/bed/resource/team/member/vehicle administration, staff isolation, admin access, outbox timeline, and cleanup. |

Migration 007 (`inventory_movements`) and 008 (team uniqueness and operation history indexes) were applied without database reset or reseeding. The synthetic E2E fixtures were removed by test cleanup. The Playwright scenario passed; the Next dev subprocesses did not exit cleanly after its completion in this Windows environment, so their known test-owned processes were stopped before the production build.

| Check | Result | Evidence |
|---|---|---|
| `npm run db:outbox:worker` | Passed | Worker connected and began polling at 3,000 ms with batch size 25; graceful stop was requested. |
| `npm run build` | Passed | Next.js 16.4.4 production compile, TypeScript, static generation (17 pages), and route manifest completed. |

## Server-side database operation conversion

Run on 2026-11-04 after replacing internal REST handlers with Server Components and Server Actions.

| Check | Result | Evidence |
|---|---|---|
| Internal route/call-site audit | Passed | No `fetch(...)`, `/api/` calls, or exported GET/POST/PUT/PATCH/DELETE handlers remain under `src`; all 37 files under `src/app/api` were removed. |
| `npm run typecheck` | Passed | `tsc --noEmit` after regenerating Next.js route types. |
| `npm test` | Passed | All 4 unit and PostgreSQL/MongoDB integration tests passed. |
| `npm run lint` | Passed with warnings | No errors; two existing unused-variable warnings remain in `scripts/seed.mjs`. |
| `npm run build` | Passed | Next.js 16.4.4 production build and TypeScript validation completed; route manifest contains only application pages. |
| `npm run test:e2e` | Passed | Playwright completed login, hospital/bed/resource/team/member/vehicle workflows, report conversion, allocation consumption, dispatch completion and bed release, incident status updates, outbox publishing, MongoDB timeline verification, staff scoping, and fixture cleanup using Server Actions/UI pages. |
