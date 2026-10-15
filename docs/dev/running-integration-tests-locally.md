# Running the integration suites locally the way CI runs them

The integration lane builds its test database from a **CE+EE migration
overlay**, not from `server/migrations` alone. A local run that skips the overlay
gets a CE-only `test_database` and produces failures that look like product bugs
but are missing tables.

## Build the overlay, then point the harness at it

Same recipe as the `Build the CE+EE migration overlay` step in
`.github/workflows/integration-tests.yml`:

```bash
cd <repo>
rm -rf server/.ci-combined-migrations
mkdir -p server/.ci-combined-migrations
cp -r server/migrations/. server/.ci-combined-migrations/
cp -r ee/server/migrations/. server/.ci-combined-migrations/
export TEST_MIGRATIONS_DIR="$PWD/server/.ci-combined-migrations"
```

EE files overlay CE collisions, and the directory stays under `server/` so
migration-relative helpers resolve. `server/test-utils/dbConfig.ts` reads
`TEST_MIGRATIONS_DIR` when it creates the database. The directory is gitignored.

At the time of writing that is 1098 CE + 70 EE = 1162 files. CE-only is 1098.

## What it looks like when you skip it

`test_database` comes up without the EE-only tables — `stripe_subscriptions`,
`stripe_products`, `teams_integrations`, `tenant_workflow_schedule`,
`scim_connections`. The co-managed bootstrap suite is the loudest victim because
it `pg_dump`s that database as its schema source, so roughly 23 of its cases fail
with `relation "..." does not exist`. Nothing is wrong with the product or the
suite; the source database is simply short.

## Why the clone source is what it is

`coManagedBootstrap`'s `beforeAll` clones `process.env.DB_NAME_SERVER`.
`createTestDbConnection()` **rewrites that variable** to the shared test database
as soon as any integration file creates it (`server/test-utils/dbConfig.ts`), and
the fork is shared across files, so the name a later file reads depends on which
files ran before it.

That is load-bearing, not incidental. `.env.localtest` sets
`DB_NAME_SERVER=server`, the integration workflow never overrides it, and CI has
no database of that name (`POSTGRES_DB: postgres`, no `createdb` step). CI works
precisely *because* an earlier file rewrites the variable to `test_database`.

**Do not pin the clone source to the value the run started with.** It resolves to
`server` in CI, `pg_dump` finds nothing, `beforeAll` throws, and the whole file
fails instead of whatever single case you were chasing. This was tried and
reverted; it passes locally only because a `server` database happens to exist on
dev machines.

## Running the co-managed bootstrap suite on its own

Standalone it never reaches `createTestDbConnection`, so nothing rewrites the
variable and you choose the source yourself. Point it at a fully migrated
database and run it from `server/`, not from `ee/temporal-workflows`:

```bash
source scripts/dev/load-env-local.sh
export DB_NAME_SERVER=server_co_managed   # must be fully migrated; `npm run migrate:ee` if unsure
cd server && npx vitest run ../ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts
```

## Reproducing a CI-only failure

`server/vitest.config.ts` shuffles test order with the seed from `VITEST_SEED`,
random when unset. CI pins `VITEST_SEED=20260610`. Export the same value or
order-dependent failures will not reproduce.
