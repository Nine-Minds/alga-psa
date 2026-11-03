# Stripe customer ownership review repair

## Isolated database

- PostgreSQL container: `stripe-tenant-pg`, loopback port `55472`.
- Citus container: `stripe-tenant-citus`, loopback port `55473`.
- Manifest database: `alga_stripe_tenant_test`; 1,292 applied migrations, latest `20261103090000_validate_stripe_customer_binding_owner_fk.cjs`.
- Stripe ownership integration database: `alga_stripe_owner_test` (PostgreSQL) and `alga_stripe_citus_test` (Citus). Tests create a private per-process schema and refuse to run if public Stripe tables could shadow it.
- The isolated databases were created for this branch’s migrations. No shared database was reset or dropped.

## Results

- PostgreSQL ownership integration suite against the Stripe emulator:
  `STRIPE_API_BASE_URL=http://127.0.0.1:4051 STRIPE_SECRET_KEY=sk_test_algasim DB_HOST=localhost DB_PORT=55472 DB_NAME_SERVER=alga_stripe_owner_test DB_USER_SERVER=postgres DB_PASSWORD_SERVER=stripe_tenant_test npx vitest run src/__tests__/integration/stripeService.customerOwnership.integration.test.ts --reporter=dot`
  — 27 passed. Includes matching remote ownership, mismatched metadata, incompatible binding, and concurrent migration writer contention. The deleted-customer fixture now has matching `deletedTenant` metadata and binding: the actual checkout service method succeeds before remote deletion, then rejects after deletion without making a second checkout-session call.
- Citus ownership integration suite:
  `STRIPE_BINDING_CITUS_TEST=1 DB_HOST=localhost DB_PORT=55473 DB_NAME_SERVER=alga_stripe_citus_test DB_USER_SERVER=postgres DB_PASSWORD_SERVER=stripe_tenant_test npx vitest run src/__tests__/integration/stripeService.customerOwnership.integration.test.ts --reporter=dot`
  — 26 passed, 1 simulator-only case skipped. Exercises rollout contention and confirms the binding/FK mechanism is accepted by Citus.
- Both ownership integration commands were rerun after making teardown explicitly drop each schema-qualified test table and then drop its private schema without `CASCADE`; both retained the same pass counts above.
- Manifest check:
  `DB_HOST=127.0.0.1 DB_PORT=55472 DB_NAME=alga_stripe_tenant_test DB_USER=postgres DB_PASSWORD=stripe_tenant_test npx tsx scripts/generate-tenant-manifest.ts --check`
  — passed: 583 ordered tables, 1,081 foreign keys, no drift. Regenerated missing co-managed/ticket-watcher FK entries from this fully migrated isolated DB; no shared-environment rows were copied.
- Real tenant deletion activity integration:
  `HOTPATH_DB=1 DB_HOST=localhost DB_PORT=55472 DB_NAME_SERVER=alga_stripe_tenant_test DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=stripe_tenant_test DB_USER_SERVER=postgres DB_PASSWORD_SERVER=stripe_tenant_test npx vitest run src/activities/__tests__/tenantDeletionQueryBudget.test.ts -t 'deletes Stripe mappings' --reporter=dot`
  — passed. The real activity deleted the target tenant’s Stripe mapping before its binding and retained the other tenant’s mapping and binding. The broader file still has an existing query-budget assertion failure when run without the test filter; it expects no co-management/product-code lookup, unlike the current fully migrated schema path.
- Query-budget baseline comparison: using `git show f1738f3737:ee/temporal-workflows/src/activities/__tests__/tenantDeletionQueryBudget.test.ts` as the test file and the same `alga_stripe_tenant_test` database, `HOTPATH_DB=1 DB_HOST=localhost DB_PORT=55472 DB_NAME_SERVER=alga_stripe_tenant_test DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=stripe_tenant_test DB_USER_SERVER=postgres DB_PASSWORD_SERVER=stripe_tenant_test npx vitest run src/activities/__tests__/tenantDeletionQueryBudget.test.ts -t 'deleteTenantData on a fixture tenant records a stable statement list' --reporter=dot` fails at the pre-existing assertion that the statement list contain no `/co_manag|product_code/` match. This reproduces the failure before the current repair; the assertion was not weakened or changed.
- The new deletion isolation test now removes both tenants’ Stripe mappings and bindings and any surviving tenant rows in `finally`, including the preserved neighbor fixture. Its targeted rerun passed (1 passed, 1 unrelated test skipped).
- Stripe emulator tests: `npm test --workspace @alga-psa/emulator-stripe` — 30 passed. The emulator build succeeded; its customer DELETE behavior now marks customers deleted and excludes them from searches.
- Stripe emulator TypeScript check: `npm run typecheck --workspace @alga-psa/emulator-stripe` — passed.

## Build and outstanding verification

- EE server TypeScript check: `NODE_OPTIONS=--max-old-space-size=14336 npm run typecheck --workspace sebastian-ee` — passed. The previous 8 GB heap attempt is superseded by this successful higher-memory run.
- EE production build: `NODE_OPTIONS=--max-old-space-size=14336 npm run build --workspace sebastian-ee` — passed. Next.js emitted existing webpack/dynamic-route warnings; the build completed page generation and trace collection with exit code 0. This ran `next build` only; no application server was started.
- Hosted UI validation remains unverified because the explicit instruction prohibited starting the application server. Simulator-backed service tests are not UI evidence. Hosted license configuration was not validated in a running application.
- No application server was started.

## Mitigation round verification (2026-11-03)

- Rechecked `alga_stripe_tenant_test` directly: PostgreSQL at `127.0.0.1:55472`, 1,292 applied migrations, latest `20261103090000_validate_stripe_customer_binding_owner_fk.cjs`; `stripe_customers_binding_owner_fk` is present and validated.
- Re-ran the isolated manifest check against that database: 583 ordered tables, 1,081 foreign keys, no drift.
- Re-ran the PostgreSQL ownership integration suite against `alga_stripe_owner_test`, with the live local Stripe emulator at `http://127.0.0.1:4050` supplied through `STRIPE_API_BASE_URL`: 27 passed. This includes matching remote ownership, mismatched remote metadata, deleted-customer checkout rejection, and independent-connection migration contention. Mismatched and deleted cases assert subscription import is not invoked.
- Re-ran the Citus ownership suite against `alga_stripe_citus_test`: 26 passed, 1 simulator-only case skipped. Citus accepted the reference-table/FK mechanism; rollout concurrency coverage ran against Citus.
- Re-ran the real tenant-deletion activity integration against `alga_stripe_tenant_test`: 1 passed, 1 unrelated query-budget case skipped. The activity removed target mappings before bindings and preserved the other tenant's records.
- The private-schema integration setup targets only the configured isolated database and rejects `public` Stripe table fallback. No shared licensing state was changed.
- UI validation remains outstanding because this work order prohibits starting the application server. Service-level and simulator-backed checks are not UI proof. No hosted-mode UI fixture was prepared or run; shared licensing state was not changed.
- Relevant unit suite: `npx vitest run src/__tests__/unit/stripeCustomerOwnership.test.ts --reporter=dot` — 4 passed. Stripe emulator suite: `npm test --workspace @alga-psa/emulator-stripe` — 30 passed.
- EE typecheck: `NODE_OPTIONS=--max-old-space-size=14336 npm run typecheck --workspace sebastian-ee` — passed. EE production build: `NODE_OPTIONS=--max-old-space-size=14336 npm run build --workspace sebastian-ee` — passed with existing webpack dependency, route export, and dynamic rendering warnings. This command ran `next build` only; no application server was started.
