# Project Analysis and Implementation Plan

**Status:** Approved in principle; architecture corrections incorporated 2026-11-03.
**Project:** Smart Emergency Response & Resource Allocation for Hospitals

## Source distinction and repository findings

The pasted `MASTER DEVELOPMENT PROMPT` is the user's development request. `DBMS Level 3 Mini_Project Requirements draft (1).docx` supplies mandatory academic evaluation requirements; `DBMS Mini Proj (2).docx` is the team's initial proposal and sample schema. Requirements from documents guide the product but are not separate instructions to this coding agent.

The connected GitHub repository `Varchas-Shetty/smart-emergency-response` is public, has default branch `main`, and is empty (size 0). The local directory has no commits and the current branch is `feature/member-a-foundation-auth-incidents`; the working files remain untracked. `.git` is read-only in the current environment, so a shared base commit/branch and separate Member B branch cannot be created here. No commit or push was made. Preserve this evidence boundary; Member A and Member B contributions are not inferred from the branch name or uncommitted files.

The proposal identifies PostgreSQL, MongoDB, Next.js, reports, incidents, beds, teams, resources, and dispatch. Its sample DDL needs PostgreSQL types, generated keys, stricter constraints, hospital scoping, explicit assignment/audit tables, and safe transactional inventory and dispatch workflows. The refined canonical schema, ER diagram, column names, responsibilities, authorization rules, and transition tables are all in [`TEAM_CONTRACT.md`](TEAM_CONTRACT.md); this plan uses those same names.

## Problem, objectives, scope, limits

**Problem:** Emergency reports, capacity, medical supplies, teams, vehicles, beds, and hospital assignment need coordinated records with safe concurrent changes and a traceable history.

**Objectives:** (1) authenticate authorized operators; (2) record and convert reports into incidents; (3) manage hospital beds and supply inventory; (4) reserve/release/consume stock and assign beds safely; (5) dispatch available teams and vehicles; (6) expose flexible event timelines through MongoDB; (7) demonstrate relational integrity, advanced SQL, and useful operational reporting in a functional web app.

**In scope:** a synthetic local simulation, `ADMIN` and hospital-scoped `HOSPITAL_STAFF`, incident/report lifecycle, hospital/bed/resource/team/vehicle management, allocation and dispatch, audit/event history, dashboards/analytics, PostgreSQL and MongoDB.

**Out of scope:** real patient data, clinical triage/recommendations, external emergency service integrations, paid services, and production medical operations.

## Architecture and database justification

One Next.js App Router application with TypeScript, React, Tailwind CSS, Server Components, Server Actions, and Zod validation. Server Components read PostgreSQL/MongoDB data directly; authenticated Server Actions execute mutations using parameterized SQL through the official `pg` driver. PostgreSQL stores normalized relational entities and owns current statuses, quantities, role/hospital scoping, audit history, and all operational transactions. MongoDB stores flexible `incident_events` documents with evolving event-specific `details` and supports timeline/count aggregation. This split fits strongly related, transaction-sensitive operational records in SQL and supplementary semi-structured event observations in a document store; MongoDB is not an authoritative write source. Internal database operations do not depend on REST API route handlers.

Authentication uses a PostgreSQL-backed session, a password hash, HTTP-only secure cookies, and server-side role and hospital checks. Set session secrets and database URLs only through environment variables. The browser cannot select or forge its authorization scope.

## Relational schema, ER model, normalization

The canonical relational table names and attributes are: `roles`, `hospitals`, `users`, `sessions`, `locations`, `incident_types`, `citizen_reports`, `emergency_incidents`, `incident_status_history`, `hospital_beds`, `bed_assignments`, `resource_types`, `resource_inventory`, `response_teams`, `team_members`, `vehicles`, `resource_allocations`, `dispatches`, and `event_outbox`. Full primary keys, foreign keys, attributes, constraints, and cardinalities are documented in [`TEAM_CONTRACT.md`](TEAM_CONTRACT.md). That document's Mermaid ER model includes hospital-to-incident, hospital-to-report, hospital-to-user, bed-to-assignment, incident-to-assignment, and all dispatch/allocation relationships.

Normalization: 1NF uses scalar fields and separate membership/history/assignment rows; 2NF stores lookup descriptions in their own relations and facts depend on full keys; 3NF separates users from roles, hospitals from locations, inventory from resource types, and operations from event history. Inventory available quantity is derived as on-hand minus reserved. Reporting totals are calculated in views/queries rather than duplicated state.

## Hospital-level authorization

`users.hospital_id` is a nullable FK to `hospitals.hospital_id`: `ADMIN` requires `NULL`; `HOSPITAL_STAFF` requires one non-null hospital. A database constraint trigger and service validation maintain this cross-table role invariant. Hospital staff see and mutate only records for their assigned hospital; the API derives scope from the authenticated user and checks it in the same transaction as a mutation. Admins can access all hospitals. Staff cannot assign an incident/report/bed/inventory/team/vehicle/dispatch to another hospital. Unassigned incidents are visible to Admin only; Admin assigns them to a hospital. Reports are owned by `citizen_reports.hospital_id`; conversion assigns `emergency_incidents.hospital_id` to the same hospital. Admin or staff authorized for that report's hospital can convert it.

## Operational state and transaction rules

Use the exact state enums and allowed transitions in [`TEAM_CONTRACT.md`](TEAM_CONTRACT.md): report states `RECEIVED, REVIEWED, CONVERTED, REJECTED, CLOSED`; incident states `NEW, VALIDATED, PRIORITIZED, ASSIGNED, IN_PROGRESS, RESOLVED, CLOSED, CANCELLED`; bed and bed-assignment states `AVAILABLE, RESERVED, OCCUPIED, OUT_OF_SERVICE` and `RESERVED, OCCUPIED, RELEASED, CANCELLED`; allocation states `RESERVED, RELEASED, CONSUMED`; dispatch states `QUEUED, DISPATCHED, EN_ROUTE, ON_SCENE, TRANSPORTING, COMPLETED, CANCELLED`; team and vehicle availability states; and outbox `PENDING, PUBLISHED, FAILED`.

Bed assignments are explicit history rows. `bed_assignments.dispatch_id` is a nullable FK to `dispatches.dispatch_id`, so assignments can exist before dispatch and dispatch-created reservations can be linked without duplicating the bed FK. A partial unique index permits only one active (`RESERVED` or `OCCUPIED`) assignment per bed and per incident. Reserve/occupy/release/cancel updates assignment and bed together under a transaction and row lock. A duplicate or cross-hospital assignment fails without partial changes.

Inventory counts are integer quantities in the resource unit. `quantity_on_hand` is physical unconsumed stock; `quantity_reserved` is the active reserved subset; available is their difference. A `RESERVED` allocation increments reserved quantity. `RELEASED` decrements reserved only. `CONSUMED` decrements both reserved and on-hand. Each transition is one-time, audited, and transactionally applied with a row lock. Insufficient stock fails and rolls back. Nonnegative/check constraints reinforce service logic.

Dispatch atomically locks incident, team, vehicle, and optional bed, validates hospital scope and availability, then creates a `QUEUED` dispatch and reservation. Partial unique indexes prevent more than one active dispatch per incident/team/vehicle. Legal status transitions are allow-listed; terminal dispatch releases team/vehicle and appropriate assignment state. Concurrent attempts cannot double-book resources.

## Secure actor attribution and audit

For status changes, the authenticated server starts a transaction on a checked-out PostgreSQL connection and uses a bound parameter to set `SELECT set_config('app.actor_user_id', $1, true)`. The ID comes from the verified DB-backed session, not client input. Transaction-local scope prevents pooled connection leakage. The incident status trigger reads `current_setting('app.actor_user_id', true)` and inserts `incident_id`, `old_status`, `new_status`, `actor_user_id`, and `changed_at` into append-only `incident_status_history`. Missing or invalid actor context fails closed. The application database role cannot directly modify history. Tests cover attribution and missing context.

## PostgreSQL transactional outbox and MongoDB retry

In the same PostgreSQL transaction as every operation that emits a timeline event, insert `event_outbox(event_id, aggregate_type, aggregate_id, event_type, payload, outbox_status, attempt_count, available_at, locked_at, published_at, last_error, created_at)`. A worker leases small batches with `FOR UPDATE SKIP LOCKED`. It publishes to Mongo `emergency_ops.incident_events`, whose unique `eventId` index makes retry/idempotent upsert safe, then marks the row `PUBLISHED`. Failures increment attempts, store bounded errors, and set exponential-backoff `available_at` with jitter. Expired leases can be reclaimed; exhausted rows become `FAILED` for operator review/requeue. Monitor pending age and failure count. PostgreSQL remains authoritative; event delivery is eventual and no distributed transaction is claimed.

Mongo event documents use `eventId`, `incidentId`, `eventType`, `occurredAt`, `actorUserId`, `source`, `summary`, and flexible synthetic `details`. Index unique `{eventId: 1}` and `{incidentId: 1, occurredAt: -1}`. Demonstrate `$match`, `$sort`, `$group` timeline/count pipelines.

## Historical REST contract (implemented without route handlers)

The route table below preserves the initial requirements as traceability; its REST handlers are not part of the current application. Server Components and authenticated Server Actions implement these equivalent reads and writes with Zod validation, server-derived scope, parameterized SQL, and transactional state transitions.

| API | Contract, scope, and principal transaction behavior |
|---|---|
| `POST /api/auth/login`; `POST /api/auth/logout`; `GET /api/auth/me` | Public login; session create/revoke; current session identity and hospital |
| `GET/POST /api/users` | Admin only; staff accounts require `hospitalId`; admin account has null hospital |
| `GET/POST /api/hospitals` | Admin all; staff reads own hospital; staff cannot choose another scope |
| `GET/POST /api/reports`; `GET/PATCH /api/reports/:reportId` | Staff creation derives hospital from session; Admin supplies allowed `hospitalId`; reads scoped; PATCH advances to `REVIEWED`/`REJECTED` or closes a converted/rejected report |
| `POST /api/reports/:reportId/convert` | Admin or report-hospital staff; only `REVIEWED` reports convert; creates `emergency_incidents`, links report, marks `CONVERTED`, writes actor audit and outbox event in one PostgreSQL transaction |
| `GET/POST /api/incidents`; `GET/PATCH /api/incidents/:incidentId` | Admin all; staff own hospital; incident assignment must be authorized; state changes use trigger actor context |
| `GET /api/incidents/:incidentId/history` | Scoped relational history plus currently published Mongo timeline |
| `GET/POST /api/hospitals/:hospitalId/beds`; `PATCH /api/beds/:bedId/status` | Admin all; staff own hospital |
| `POST /api/incidents/:incidentId/bed-assignments`; `PATCH /api/bed-assignments/:bedAssignmentId` | Transactional reserve; transition to occupy, release, or cancel; server actor ID |
| `GET/POST /api/hospitals/:hospitalId/resources` | Admin all; staff own hospital; receive stock, view on-hand/reserved/available |
| `POST /api/incidents/:incidentId/allocations`; `PATCH /api/allocations/:allocationId` | Reserve, then release or consume stock transactionally and exactly once |
| `GET/POST /api/teams`; `GET/POST /api/vehicles` | Admin all; staff own hospital; unassigned resources Admin only |
| `POST /api/incidents/:incidentId/dispatches`; `PATCH /api/dispatches/:dispatchId` | Create `QUEUED` with team/vehicle and optional `bedId` availability in one transaction; link the reservation through `bed_assignments.dispatch_id`; move through exact dispatch transitions |
| `GET /api/dashboard/summary`; `GET /api/reports/analytics` | Admin all hospitals; staff receives own hospital-only aggregates |

Staff cross-hospital lookups return consistent 404/403 without record leakage. Read and write routes use the same hospital policy.

## Frontend page plan

`/login`; `/dashboard`; `/incidents`, `/incidents/new`, `/incidents/[incidentId]`; `/reports`; `/hospitals` and hospital detail with beds; `/resources`; `/teams`; `/vehicles`; `/dispatch`; `/admin/users`. Provide filters, accessible forms/tables, loading/error/empty states, clear confirmation for consequential changes, and server-backed data. Staff navigation and data stay scoped to their hospital; admin can switch hospital scope.

## Responsibility and file ownership

| Member | Owns |
|---|---|
| Member A — V Sai Sri Saketh (PES2UG24CS602) | Shared foundation and single Next.js app; auth, users/roles/sessions, hospital role invariant and RBAC; locations, incident types, reports, report conversion, incidents and status history; PostgreSQL actor context and incident audit trigger; outbox base schema/interface; shared shell, API conventions and tests for A-owned flows |
| Member B — Varchas (PES2UG24CS575) | Hospitals, beds and `bed_assignments`; resource types/inventory/allocations; teams/members, vehicles and dispatch; MongoDB `incident_events`, indexes/aggregation and retry publisher worker; hospital/operations pages and tests for B-owned flows |
| Both | Review every shared contract and migration; coordinate root layout/types/migration runner; integrate dashboards, end-to-end tests, documentation, demonstration, and actual contribution evidence |

Migration ownership follows the exact names: `001_core.sql` (A: locations/roles/users; B: hospitals); `002_auth_incidents.sql` (A: sessions/types/reports/incidents/history and report/incident hospital links); `003_hospital_resources.sql` (B: beds, resource types/inventory, teams/members, vehicles); `004_allocation_dispatch_beds.sql` (B: dispatches before bed assignments, allocations, locks/partial unique constraints); `005_audit_outbox.sql` (A: actor context, incident status trigger, outbox base; B reviews outbox publisher fields); `006_reporting.sql` (both: views/functions/indexes and academic queries). All migration changes require review by both members. Each person commits under their own GitHub identity.

## Migration, Git, and testing plan

Migrations are ordered, tracked in `schema_migrations`, run in transactions when supported, and validated on an empty PostgreSQL database. Never edit applied migrations. Seed only synthetic fixtures. Demonstrate `DROP` only in a clearly labeled disposable database script; never use it in regular migrations. Use Git feature branches `feature/member-a-foundation-auth-incidents` and `feature/member-b-hospital-resources-dispatch`; integrate by PR to `main`. Do not push directly to `main`.

Required tests: migration/constraint/FK tests; hospital-scope authorization (admin all, staff own, staff denied another hospital); trigger attribution and missing actor; report conversion authorization and same-hospital link; duplicate bed assignment; duplicate dispatch; allocation rollback when stock is insufficient or a later write fails; concurrent requests attempting the same bed/team/vehicle/stock; legal and illegal transitions; Mongo idempotency/retry and aggregation; API auth and Playwright workflows. These tests are implementation targets, not results. Record each executed command, environment, and actual pass/fail in `docs/TEST_REPORT.md` only after execution.

## College requirement traceability

All college items map to planned evidence below. A requirement is only reported complete after implementation and actual demonstration/test evidence exists.

| College requirement | Planned implementation / DB object | Source and evidence target | Verification |
|---|---|---|---|
| Meaningful problem beyond CRUD | Integrated report, incident, capacity, bed, stock, dispatch workflows | services and operational pages | demo successful and rejected workflow |
| SQL DB | PostgreSQL normalized source of truth | `db/migrations/*.sql`, repositories | migrations and database integration |
| Second database paradigm, justified | MongoDB flexible incident events, not operational source of truth | `src/db/mongo`, outbox publisher, report | event indexes, retry and aggregation demo |
| Two database paradigms | PostgreSQL + MongoDB | DB adapters | architecture walkthrough |
| Functional Next.js application | Next App Router Server Components, Server Actions, pages/forms/tables/dashboard | `src/app`, `src/db`, `src/lib` | Playwright scenarios |
| ER diagram; relational schema; entities and attributes; keys; FKs; cardinality; constraints | Canonical model and Mermaid ER in team contract | `docs/TEAM_CONTRACT.md`, migrations | explain mapping and inspect DB constraints |
| CREATE, ALTER, DROP | `CREATE TABLE` migrations; additive `ALTER TABLE`; destructive demo-only drop script | `db/migrations`, `db/demo/drop_schema.sql` | run on disposable DB and capture output |
| INSERT, UPDATE, DELETE, SELECT | app operations and safe academic DML examples; audit rows retained, deletes only for suitable disposable/reference records | repositories, `db/queries/academic_dml.sql` | SQL demo and integration |
| JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries | reporting SQL and dashboard views | `db/queries/academic_queries.sql`, `006_reporting.sql` | seeded query assertions/demo |
| Four advanced DB concepts | transactions/locks, trigger, function, view, indexes, Mongo aggregation | migrations and repos | rollback, audit, view/function, explain, aggregation tests |
| Authentication; at least two roles | DB sessions, password hashes, `ADMIN`/`HOSPITAL_STAFF`, hospital scoping | `roles`, `users`, `sessions`, auth modules | login, role and hospital access tests |
| Database input validation, integrity, security | checks, FKs, unique indexes, transition checks, Zod, parameterized SQL, HTTP-only cookies, actor attribution | all migrations and APIs | invalid-write/auth/security tests |
| Environment config | env example and startup schema; no committed secrets | root `.env.example`, config module | startup config validation |
| Git/GitHub and genuine individual work | feature branches and reviewed PRs | Git history and PR links | contribution report based on actual commits |
| Documentation | README, data dictionary, DB rationale, queries, screenshots, report, tests, conclusion/future work | root README and `docs/*` | clean setup and final walkthrough |
| Testing results and demonstration | test report and scripted synthetic scenario including failure/rollback | `docs/TEST_REPORT.md`, demo guide | actual test output/screenshots |
| Originality | team-specific schema/workflows and original implementation | full repository | design walkthrough and source review |

## Initialization and phase plan

The approvals in principle and requested corrections authorized the original initialization. The single Next.js app is at the repository root; no nested app/repository was created and nothing was pushed to `main`.

## Current implementation phase status (2026-11-03)

Member B's hospital administration, bed lifecycle, resource catalog/inventory lifecycle, team/member management, vehicle management, dispatch integrations, and MongoDB outbox worker/monitor/requeue are implemented. Additive migrations 007 and 008 are applied. Current verification evidence is in [`TEST_REPORT.md`](TEST_REPORT.md). The initial synthetic seed was not rerun during this phase. Remaining work is broader usability and edge-case coverage; Git baseline/branch organization awaits writable Git metadata and a base commit.
