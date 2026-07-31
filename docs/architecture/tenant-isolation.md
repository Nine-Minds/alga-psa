# Tenant isolation and the tenantDb query facade

How tenant data stays separated, and how application code is expected to query
it. Read this before writing any query that touches a tenant-owned table.

## The isolation model

Tenant isolation is enforced by three application-level mechanisms working
together. **The database does not enforce it for you.**

1. **Explicit `tenant` columns.** Every tenant-owned table carries a
   `tenant uuid NOT NULL` column, included in the primary key.
2. **Citus distribution.** Tables are distributed by `tenant`, so a query that
   filters on `tenant` routes to one shard. A query without a tenant predicate
   broadcasts to all shards.
3. **Per-request tenant context.** `withAuth` (from `@alga-psa/auth`) resolves
   the session's tenant and runs the action inside `runWithTenant()`
   (AsyncLocalStorage). `createTenantKnex()` reads that context.

Row-level security is **not** part of the model. RLS policies were removed for
Citus compatibility (`20250523152638_remove_rls_policies_for_citusdb.cjs`), and
a final sweep dropped every remaining policy and disabled RLS on all public
tables (`20260509120000_disable_remaining_rls_policies.cjs`). The app no longer
sets `app.current_tenant` on pooled connections, so any surviving policy that
referenced it would fail at read time rather than protect anything. Older
migrations that create RLS policies are historical; do not copy them.

Because the database does not filter rows for you, a query that forgets the
tenant predicate returns other tenants' data. The `tenantDb` facade exists so
that application code cannot forget.

## The tenantDb facade

`tenantDb` (in `@alga-psa/db`, source `packages/db/src/lib/tenantDb.ts`) binds
one connection and one tenant id, then scopes every query root and join for
you. It is the default way to query tenant data in application code —
handwritten `.where({ tenant })` predicates are the legacy shape.

```typescript
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';

export const getOpenTickets = withAuth(async (user, { tenant }) => {
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);

  return db
    .table('tickets as t')
    .where('t.status', 'open')
    .select('t.*');
});
```

`createTenantKnex()` still provides the connection and tenant id;
`tenantDb(knex, tenant)` provides the query surface. The facade throws
immediately if the tenant id is missing or blank.

Inside a transaction, bind the facade to the transaction handle:

```typescript
await withTransaction(knex, async (trx) => {
  const db = tenantDb(trx, tenant);
  await db.table('tickets').where('ticket_id', id).update({ status: 'closed' });
});
```

### Query roots

- **`db.table(expr)`** — the normal entry point. Returns an ordinary Knex
  builder with the tenant predicate already applied to the root table.
  Supports aliases: `db.table('tickets as t')` scopes on `t.tenant`.
  Global tables (per the metadata registry) pass through unscoped; admin
  tables throw.
- **`db.subquery(expr)`** — alias of `table()`; use it where the call site is
  a nested query, for readability.
- **`db.scoped(expr)`** — returns the branded `TenantScopedQuery` instead of a
  raw builder. Use it only where a consumer requires structural proof of
  tenant scoping (for example the SQL authorization compiler). Check with
  `isTenantScopedQuery()`.

Rows are untyped by default (deliberately `any`, not `Record<string, any>` —
knex would otherwise key rows by the alias-qualified select string). Opt into
typing per call: `db.table<ITicket>('tickets as t')`.

### Joins

- **`db.tenantJoin(builder, expr, left, right, options?)`** — joins a table
  and adds tenant equality automatically when the joined table is
  tenant-scoped:

  ```typescript
  const query = db.table('tickets as t');
  db.tenantJoin(query, 'statuses as s', 't.status_id', 's.status_id');
  // ON s.status_id = t.status_id AND s.tenant = t.tenant
  ```

  Options: `type: 'left'` for a left join; `tenantPredicate: 'literal'` to
  compare against the bound tenant id instead of the root's tenant column;
  `rootTenantColumn` when the root side cannot be inferred from the join
  columns; `on` for extra join conditions. Joining a global table adds only
  your join condition; joining an admin table throws.
- **`db.tenantJoinSubquery(builder, subquery, left, right, options)`** — joins
  a derived table. You must name both tenant columns
  (`rootTenantColumn`, `joinedTenantColumn`) because a derived table has no
  metadata.
- **`db.tenantWhereColumn(builder, leftCol, rightCol)`** — adds a
  column-to-column tenant equality (`?? = ??`) where a join helper does not
  fit, for example in a correlated subquery.

### Parent-scoped tables

A few child tables have no `tenant` column and inherit isolation from a parent
(registered as `tenantViaParent`, e.g. `composite_tax_mappings` via
`tax_rates`). For those:

- **`db.parentScopedTable(expr)`** — returns a builder guarded by
  `WHERE EXISTS` against the tenant-scoped parent.
- **`db.insertParentScoped(table, values, returning?)`** — verifies every
  referenced parent row exists in the bound tenant, then inserts. Alias
  expressions are rejected.

`table()` and `scoped()` throw for these tables, so the facade tells you when
you need this path.

### Escape hatches

Some code legitimately queries without a tenant root: tenant discovery, login
and provider resolution before the tenant is known, cross-tenant maintenance,
and truly global tables.

```typescript
db.unscoped('tenants', 'tenant discovery before login');
```

The reason string is required and non-empty. It makes every bypass grep-able
and reviewable: `grep -rn "\.unscoped(" server/src packages ee`. Do not launder
a normal tenant query through `unscoped()` to dodge a missing metadata entry —
register the table instead.

For operations that must run outside any tenant context (platform
administration), use `getAdminConnection()` / `withAdminTransaction()` from
`@alga-psa/db` rather than a tenant connection with `unscoped()` everywhere.

## The table metadata registry

The facade fails closed: it only builds queries for tables registered in
`packages/db/src/lib/tenantTableMetadata.ts`. An unregistered table throws
`No tenant table metadata registered for <table>`.

Scopes:

| Scope | Meaning | Facade behavior |
| --- | --- | --- |
| `tenant` | Has a `tenant` column (override with `tenantColumn`) | Root and joins scoped automatically |
| `tenantViaParent` | No tenant column; isolated through a parent table | `parentScopedTable()` / `insertParentScoped()` only |
| `global` | Shared across tenants (e.g. `system_email_templates`, `standard_statuses`) | `table()` passes through unscoped |
| `admin` | Platform-level (e.g. `tenants` beyond self-lookup) | Tenant paths throw; use `unscoped()` or the admin connection |

**When you add a table in a migration, register it in the metadata in the same
change.** Otherwise every facade query against it throws at runtime. See the
checklist below for what a new tenant table needs.

## Adding a new tenant table

1. **Migration** (`server/migrations/`). Create the table with
   `tenant uuid NOT NULL` in the primary key, then distribute it with the
   shared helper (no-op on plain Postgres and on already-distributed tables):

   ```javascript
   const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

   exports.config = { transaction: false }; // Citus rejects distribution inside a tx

   // after createTable:
   await ensureTenantDistribution(knex, 'my_table'); // distributes on tenant, colocated with tenants
   ```

   Wider Citus rules live in
   [citus-migration-best-practices.md](citus-migration-best-practices.md).
2. **Query metadata.** Register the table in
   `packages/db/src/lib/tenantTableMetadata.ts` so the facade accepts it.

CI runs additional per-table schema checks over the migrated database; if the
`Validate Tenant Management Schema` job flags your table, follow the script's
output.

## What still uses raw tenant predicates

The migration to the facade is staged and still in progress. New code and
touched code must use `tenantDb`; remaining direct `.where({ tenant })` roots
and hand-written `.andOn('a.tenant', 'b.tenant')` joins are legacy that gets
converted when a file is next worked on. Do not add new ones.

Places that intentionally do not use the facade:

- **Migrations and seeds** must not import `@alga-psa/db`; the migration
  runtime never builds it. A migration that wants facade-shaped scoping uses
  the self-contained CJS shim at `server/migrations/utils/tenantDb.cjs`, which
  ports `table()` / `unscoped()` / `tenantJoin()` over a snapshot of the table
  metadata.
- **Model/service layers already inside `@alga-psa/db`** may use the branded
  `createTenantScopedRootQuery` internals directly.
- **Test fixtures** may use raw Knex, though shared helpers (`TestContext`,
  billing utilities) have been moved onto the facade.

## How the shape is enforced

There is no lint rule. Enforcement is contract tests: per-slice unit tests
read the source file and assert the facade shape, for example
`server/src/test/unit/inboundEmailTenantScoped.contract.test.ts` asserts that
`inboundWebhookLookups.ts` imports `tenantDb` and starts each root through
`db.table(...)`. When you migrate a file to the facade, add or extend the
matching `*TenantScoped.contract.test.ts` so it cannot silently regress.

## Rules that still apply underneath the facade

The facade removes the need to hand-write tenant predicates; it does not
change the physical model:

- New tenant tables: column named `tenant` (not `tenant_id`), `uuid`,
  `NOT NULL`, part of the primary key, and in every unique index.
- Raw SQL (reports, `knex.raw`) must still carry tenant predicates by hand —
  the facade cannot see inside a raw string. Keep raw tenant SQL rare and
  covered by contract tests.
- Never rely on connection-level settings (`app.current_tenant`) for
  isolation; they do not propagate to Citus shards.
- Citus specifics (UPDATE restrictions, reference tables, distribution) are
  covered in [citus-migration-best-practices.md](citus-migration-best-practices.md).

## Related

- Design and migration history: `docs/plans/2026-06-25-tenant-query-full-facade-design.md`
- Transaction and after-commit rules: [db-transaction-guardrails.md](db-transaction-guardrails.md)
- Server action auth (`withAuth`, tenant context): `docs/AI_coding_standards.md`
