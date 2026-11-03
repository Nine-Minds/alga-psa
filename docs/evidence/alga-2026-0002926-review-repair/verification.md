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
  — 27 passed. Includes matching remote ownership, mismatched metadata, deleted remote customer, incompatible binding, and concurrent migration writer contention.
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
- Stripe emulator tests: `npm test --workspace @alga-psa/emulator-stripe` — 30 passed. The emulator build succeeded; its customer DELETE behavior now marks customers deleted and excludes them from searches.
- Stripe emulator TypeScript check: `npm run typecheck --workspace @alga-psa/emulator-stripe` — passed.

## Remaining verification

- The full EE server TypeScript check (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`, from `ee/server`) failed with Node heap exhaustion at the 8 GB limit after 133 seconds. The Stripe emulator package typecheck passed, and Vitest compiled/executed the changed service integration test.
- Hosted UI validation remains unverified because the explicit instruction prohibited starting the application server. Simulator-backed service tests are not UI evidence. Hosted license configuration was not validated in a running application.
- No application server was started.
