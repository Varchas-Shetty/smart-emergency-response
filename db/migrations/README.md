# PostgreSQL migration sequence

Apply these files with `npm run db:migrate` after setting `DATABASE_URL`. The runner uses an advisory lock and tracks files in `schema_migrations`. Never edit an applied migration; add a new numbered migration instead.

1. `001_core.sql` — locations, roles, hospitals, users, and the role/hospital invariant.
2. `002_auth_incidents.sql` — sessions, incident types, reports, incidents, and status history.
3. `003_hospital_resources.sql` — beds, inventory, teams, team members, and vehicles.
4. `004_allocation_dispatch_beds.sql` — dispatches, bed assignments, allocations, and reservation function.
5. `005_audit_outbox.sql` — actor-attributed status trigger and transactional event outbox.
6. `006_reporting.sql` — incident and hospital capacity views.
7. `007_inventory_movements.sql` — inventory movement audit history and index.
8. `008_operation_uniqueness.sql` — operational uniqueness and dispatch-history indexes.
9. `009_demo_seed_registry.sql` — idempotent demo seed version tracking.
10. `010_outbox_last_attempt.sql` — records the most recent event publication attempt.

The canonical attributes, statuses, transitions, and relationships are defined in [`../../docs/TEAM_CONTRACT.md`](../../docs/TEAM_CONTRACT.md). Run `npm run db:migrate` to apply pending migrations.
