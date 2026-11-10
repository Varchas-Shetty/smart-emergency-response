# DBMS command implementation

PostgreSQL remains authoritative for hospital operations; MongoDB stores the supplemental incident activity timeline. Application reads are performed in Next.js Server Components and mutations use the authenticated Server Action dispatcher in [actions.ts](../src/app/actions.ts); there are no internal REST API route handlers. SQL is parameterized through `pg`, and MongoDB event reads/publishing use the official Node.js driver from server-only code. The static demo SQL is additionally run by the explicit `db:demo:postgres` command.

## Execute the demonstrations

1. Configure `.env.local` with the normal PostgreSQL and MongoDB settings, then run `npm run db:preflight` and `npm run db:migrate`.
2. Execute `npm run db:demo:postgres` and `npm run db:demo:mongo` to run the visible database examples directly through `pg` and the official MongoDB Node.js driver.
3. Start the app and sign in. Use the normal incident, resource, bed, team, vehicle, dispatch, and outbox screens to exercise the direct server-side SQL and MongoDB operations.

The SQL script creates, alters, updates, deletes, and drops only `sera_dbms_demo_records`, a PostgreSQL temporary table. It demonstrates a full `ROLLBACK`, then a separate temporary-table transaction that is `COMMIT`ted. The MongoDB runner creates synthetic records in `incident_events` under a unique `demoRunId`, scopes every operation to those records, and deletes any remaining run records in `finally`. It never removes application events.

## PostgreSQL

| Concept | Actual source / executable code | Purpose and execution | Expected output / TA demonstration |
|---|---|---|---|
| `CREATE TABLE` | [001_core.sql](../db/migrations/001_core.sql): `CREATE TABLE hospitals (...)`; [POSTGRESQL_DBMS_DEMO.sql](../db/queries/POSTGRESQL_DBMS_DEMO.sql): `CREATE TEMP TABLE sera_dbms_demo_records (...)` | Migration creates the real hospital table; `npm run db:demo:postgres` creates a disposable table in its connection. | Migration tracking and script output list the executed statements. Inspect both SQL files. |
| `ALTER TABLE` | [010_outbox_last_attempt.sql](../db/migrations/010_outbox_last_attempt.sql): `ALTER TABLE event_outbox ADD COLUMN last_attempt_at timestamptz;`; demo script also alters its temp table. | Adds the outbox attempt timestamp without editing an applied migration; run `npm run db:migrate`. | `event_outbox.last_attempt_at` exists; workers set it when claiming/retrying events. |
| `DROP` | [POSTGRESQL_DBMS_DEMO.sql](../db/queries/POSTGRESQL_DBMS_DEMO.sql): `DROP TABLE pg_temp.sera_dbms_demo_records;` | Drops only the explicitly temporary demonstration table; run `npm run db:demo:postgres`. No application table is dropped. | Output shows the script completed; the temp table is gone when the session ends. |
| `INSERT` | [actions.ts](../src/app/actions.ts): `dispatch.create` inserts into `bed_assignments` and `dispatches`; demo SQL inserts only into its temp table. | Normal dispatch workflow writes operational records transactionally. | Dispatch/assignment rows in the dispatch and bed pages; demo script prints command row counts. |
| `SELECT` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): selects beds, incidents, inventory, dispatch history, and reporting views. | Run via `POST /api/admin/dbms-demo` or the PostgreSQL demo command. | JSON arrays include available beds, incident summaries, stock, dispatches, and views. |
| `UPDATE` | [actions.ts](../src/app/actions.ts): `incident.update`, `dispatch.update`, and operational mutation cases use parameterized SQL; demo SQL updates temporary rows. | Changes actual records only through authenticated application workflows; script updates disposable rows. | Updated incident/dispatch status is shown on the refreshed page; demo script prints affected-row counts. |
| `DELETE` | [auth.ts](../src/lib/auth.ts): session revocation deletes only the current session; demo SQL deletes a temp record. | Revokes the signed-in user's session; demo cleanup is limited to disposable data. | User is returned to login; demo script reports deletion. |
| `WHERE` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): `WHERE b.bed_status=$1 AND h.is_active=$2`. | Filters available beds and active hospitals with bound values. | Available beds only. |
| `ORDER BY` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): `ORDER BY h.hospital_name,b.bed_code`. | Gives a stable, readable operational ordering. | Beds appear by hospital then bed code. |
| `INNER JOIN` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): beds to hospitals; inventory to hospitals and resource types. | Retrieves related operational names and metadata. | Joined hospital/resource information appears in the result. |
| `LEFT JOIN` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): hospital capacity counts and dispatch-to-hospital lookup. | Preserves hospitals even when they have no bed rows, and dispatches when hospital data is nullable. | Capacity output includes active hospitals with zero available beds. |
| Multi-table join | [dbms-demo.ts](../src/repositories/dbms-demo.ts): `dispatches` → incidents, teams, vehicles, and hospitals. | Produces the actual dispatch history with its operational context. | Recent dispatch history with incident, team, vehicle, and hospital. |
| `GROUP BY` / `HAVING` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): incident counts by severity and resource stock per hospital/type. | Summarizes incident workload and inventory; `HAVING` excludes empty groups. | Severity counts and stock utilization rows. |
| `COUNT` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): `COUNT(*)`, filtered bed `COUNT`, and correlated dispatch count. | Counts incidents, beds, and dispatches. | Integer counts in the JSON summaries. |
| `SUM` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): `SUM(ri.quantity_on_hand)` and `SUM(ri.quantity_reserved)`. | Measures stock and reserved units. | Total stock/reserved quantities per hospital/resource. |
| `AVG` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): average incident priority and reserved-stock ratio. | Shows operational priority and inventory utilization averages. | Numeric averages in the JSON result. |
| `MIN` / `MAX` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): first/most recent incident timestamps and minimum/maximum stock. | Exposes reporting ranges and stock variation. | Timestamp and stock bounds. |
| Subquery / CTE | [dbms-demo.ts](../src/repositories/dbms-demo.ts): `hospital_availability` CTE and subquery for the maximum available-bed count. | Finds every hospital tied for the most available beds. | One or more top-capacity hospitals. |
| Correlated subquery | [dbms-demo.ts](../src/repositories/dbms-demo.ts): per-incident active dispatch count references the outer incident ID. | Counts dispatches for each returned incident. | Each incident row includes its active dispatch count. |
| `EXISTS` / `NOT EXISTS` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): dispatch presence and incidents without any dispatch. | Finds incidents with history and incidents that still lack a dispatch. | Two bounded incident result sets. |
| `CASE` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): maps severity to a response band; outbox query orders statuses by priority. | Makes a readable response category from stored severity. | `Immediate response`, `Urgent response`, or `Standard review`. |
| Transactions, `COMMIT`, `ROLLBACK` | [actions.ts](../src/app/actions.ts): `transaction()` is used by dispatch, allocation, incident, bed, and related mutations; also [POSTGRESQL_DBMS_DEMO.sql](../db/queries/POSTGRESQL_DBMS_DEMO.sql). | Application mutations commit related changes together or roll them back on failure. The demo script separately runs and rolls back a temporary-table transaction, then commits a second one. | Submit a dispatch or allocation from its page; the SQL script completes with the rollback-only row absent and no persistent operational writes. |
| Trigger | [005_audit_outbox.sql](../db/migrations/005_audit_outbox.sql): `record_incident_status()` and `incident_status_audit`. | Automatically records actor-attributed incident status history when a status changes. | Inspect `incident_status_history` after a status workflow. |
| Stored function | [004_allocation_dispatch_beds.sql](../db/migrations/004_allocation_dispatch_beds.sql): `reserve_inventory(...)`; called by the `allocation.reserve` action in [actions.ts](../src/app/actions.ts). | Locks and checks inventory before reserving it and creating the allocation. | The allocation appears in the resource page and reserved quantity changes atomically. |
| Views | [006_reporting.sql](../db/migrations/006_reporting.sql): `incident_operations_view`, `hospital_capacity_view`; queried by [dbms-demo.ts](../src/repositories/dbms-demo.ts). | Reusable incident and hospital capacity summaries. | Both view result sets are included in demo JSON. |
| Indexes | [002_auth_incidents.sql](../db/migrations/002_auth_incidents.sql), [004_allocation_dispatch_beds.sql](../db/migrations/004_allocation_dispatch_beds.sql), [008_operation_uniqueness.sql](../db/migrations/008_operation_uniqueness.sql), and [010_outbox_last_attempt.sql](../db/migrations/010_outbox_last_attempt.sql). | Support lookup/history operations and enforce single active dispatch/bed assignments. | Inspect migration DDL and confirm the migration runner applied the indexes. |
| `EXPLAIN ANALYZE` | [dbms-demo.ts](../src/repositories/dbms-demo.ts): `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ...`; also in [POSTGRESQL_DBMS_DEMO.sql](../db/queries/POSTGRESQL_DBMS_DEMO.sql). | Executes and reports the plan for a bounded incident-status lookup. | JSON plan includes actual timing and row statistics. |

The core repository queries are parameterized using `$1`, `$2`, etc. SQL text interpolation is limited to fixed, code-owned query strings; request input is never inserted as SQL syntax.

## MongoDB

| Node.js driver operation | Actual source / code | Purpose and execution | Expected output / TA demonstration |
|---|---|---|---|
| `insertOne` | [mongodb-demo-core.mjs](../scripts/mongodb-demo-core.mjs): inserts a disposable incident event. | Creates one tagged event for the incident selected from PostgreSQL. | `insertedOne: 1`. |
| `insertMany` | Same file: inserts dispatch and resource-allocation activity events. | Demonstrates multiple event types in the real timeline collection. | `insertedMany: 2`. |
| `find` / `sort` / `limit` | Same file: finds the run's events and incident history, sorted by `occurredAt` with bounded results. | Reads a timeline and event history without unbounded result sets. | `sortedLimitedEvents` and `incidentHistory` arrays. |
| `findOne` | Same file: loads the disposable incident event by event ID. | Verifies the event can be retrieved by its stable key. | `findOneMatched: true`. |
| `updateOne` / `updateMany` | Same file: marks one event reviewed and adds a run timestamp to the run's events. | Demonstrates single- and multi-document event maintenance, restricted by the unique run ID. | Modified document counts. |
| `deleteOne` | Same file: removes the disposable event by event ID and run ID. | Demonstrates a destructive operation only against a generated demo record. | `deleteOneDeleted: 1`; `finally` removes any remaining records from that run only. |
| `countDocuments` | Same file: counts records using `{source: "dbms-demo", demoRunId}`. | Reports the size of the just-created disposable event batch. | `countDocuments: 3`. |
| `createIndex` / `listIndexes` | Same file and [mongodb.ts](../src/db/mongodb.ts). | Maintains the incident/event-time lookup and event-type/time reporting indexes; enumerates active indexes. | `indexes` includes the unique event ID and incident timeline indexes. |
| `aggregate` | Same file and [outbox.ts](../src/db/outbox.ts): `$match`, `$group`, `$sort`, `$limit`. | Counts activity by event type and summarizes an incident timeline by day. | `eventCountsByType` and `activityByDay` arrays. |
| Activity timeline and dispatch/resource events | [outbox.ts](../src/db/outbox.ts): outbox events are idempotently upserted; [incident detail page](../src/app/incidents/%5Bid%5D/page.tsx) reads SQL audit history and Mongo events directly server-side. | Keeps PostgreSQL authoritative while displaying MongoDB timeline records for incidents, dispatches, and resource allocations. | The incident detail page shows relational status history and the sorted MongoDB timeline. |

The standalone MongoDB demonstration uses [mongodb-demo-core.mjs](../scripts/mongodb-demo-core.mjs). Both the app's server-only event utilities and standalone `db:demo:mongo` command use the official Node.js driver and the configured `incident_events` collection.

## TA walkthrough

1. Inspect the migration DDL, [actions.ts](../src/app/actions.ts), the direct Server Component queries, and the server-only MongoDB utilities.
2. Run `npm run db:demo:postgres`; point out the temporary-table `CREATE`, `ALTER`, `INSERT`, `UPDATE`, `DELETE`, `DROP`, `COMMIT`, and `ROLLBACK`, then the live operational `JOIN`/aggregation/CTE/`EXPLAIN` queries.
3. Run `npm run db:demo:mongo`; show the CRUD results, index list, event counts by type, and daily activity summary. Confirm the command exits after cleaning its uniquely tagged event documents.
4. Sign in as an administrator and exercise a workflow through the UI—for example, reserve resources and progress a dispatch—then inspect PostgreSQL and the incident's MongoDB activity timeline. Application database commands execute inside the server-rendered page and Server Action code, not through an internal REST endpoint.
