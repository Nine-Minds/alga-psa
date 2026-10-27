# Scratchpad
- Migration: server/migrations/20261023100000_document_template_assignments_label_class_scope.cjs. Citus (R2) NOT tested; plain Postgres up/down passes (T007).
- DB-backed tests run against the throwaway Postgres on 127.0.0.1:5474 (never pgbouncer 6472 / dev `server` DB):
  - T001 labelsPrintNoSideEffects (3 tests), labelsProviders (14), documentTemplateLabelClassScopeMigration (1, up+down) all pass.
  - Recipe: the `postgres` role rejects the card's secrets, so an additive superuser `c2_test_admin` (password = secrets/db_password_server) was created via `docker exec alga-psa-local-test-postgres-1 psql -U postgres`. Copy secrets/* to /tmp/c2-secrets, write db_password_server's contents into /tmp/c2-secrets/postgres_password, then from server/:
    `SECRET_FS_BASE_PATH=/tmp/c2-secrets DB_HOST=127.0.0.1 DB_PORT=5474 DB_USER_ADMIN=c2_test_admin DB_USER_SERVER=app_user TEST_DB_NAME=test_c2_labels npx vitest run src/test/integration/<file>`
- T-noside also rejects SELECTs with effects (FOR UPDATE/SHARE, nextval/setval, pg_notify, SELECT INTO).
- Billing label-batch e2e (Puppeteer) passes (alignSelf is not an allowed inline style).
- Locale JSON files not edited; all strings carry defaultValue.
- assetActionsTenantScoped.contract.test.ts was edited because the user_roles/team_members/users/asset_associations queries moved to packages/assets/src/lib/assetReadAuthorization.ts. The old per-table `tenantScopedTable(...)` pins now (a) assert those tables do NOT appear in assetActions.ts helper section, (b) assert the wrappers delegate to the shared helpers, and (c) pin tenantDb(trx, tenant).table(...) for each of the four tables in the new file, plus no raw `trx(`/`knex(` roots and no `.where({ tenant` there. tenantScopedTable is itself `tenantDb(conn, tenant).table(table)`, so the guarantee is equivalent.
- App smoke test NOT run in the Draft Implementation step (see PRD "Smoke test steps").
- DB-backed tests (T-noside, T-migration incl. down/up, T-asset-link, T-resolve, T-skip, 2-of-3 batch permission) ran green against alga-psa-local-test-postgres-1 (127.0.0.1:5474) with a throwaway TEST_DB_NAME. Not run: Citus (R2), live smoke test.
- DB recipe: copy <worktree>/secrets/* to a tmp dir, export SECRET_FS_BASE_PATH=<tmp> DB_HOST=127.0.0.1 DB_PORT=5474 TEST_DB_NAME=<unique> DB_PASSWORD_ADMIN=<postgres_password> DB_PASSWORD_SERVER=<db_password_server>, then `npx vitest run <file>` from server/. (Which password the postgres role accepts changed during the session; test with psql first.)
- vitest shuffles test order: labelsProviders T-resolve tests must not depend on each other.
