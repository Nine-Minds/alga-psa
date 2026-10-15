# Inventory test execution

Run database-free tests with `npm test --workspace @alga-psa/inventory`.

Run inventory database tests from the repository root using:

```sh
node scripts/run-workspace-db-tests.mjs packages/inventory
```

Supply `DB_HOST`, `DB_PORT`, `DB_USER_ADMIN`, `DB_PASSWORD_ADMIN`,
`DB_USER_SERVER`, and `DB_PASSWORD_SERVER` for a dedicated local PostgreSQL
service. The runner recreates `test_database`, applies migrations, and seeds it.
Never point this runner at a shared application database service.

The required workspace database CI job runs these suites automatically. Files
named `*.db.test.ts` are excluded from package unit tests and server unit coverage.
A full workspace invocation reconciles repository candidates with runner collection
and actual test results. A filtered invocation records partial coverage.

Use `createInventoryTestTenant` for fresh tenant prerequisites. Individual tests
use transactions and roll them back; tests exercising concurrency may commit
fixtures and must clean up their own mutations. The runner owns database reset.
Do not read a developer's `.env.local`, select an arbitrary existing tenant, or
skip a suite when database configuration is absent.

Test persisted stock, pricing, fulfillment, and authorization outcomes. Actions
that return validation errors should be checked for both the error result and
unchanged persisted records. Source-text matching is not regression evidence.
