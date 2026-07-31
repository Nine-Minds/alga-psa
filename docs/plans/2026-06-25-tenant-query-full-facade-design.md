# Tenant query facade design

Date: 2026-06-25
Branch: `feature/tenant-queries`
Status: Approved

## Problem

Tenant scoping is currently a caller convention in most application code. The
existing `createTenantScopedQuery` helper makes a single query root structural,
but callers usually unwrap it to a raw Knex builder immediately. That leaves
each module to remember the safe shape:

```ts
const row = await createTenantScopedQuery(knex, {
  table: 'tickets as t',
  tenant,
}).builder.where('t.ticket_id', ticketId).first();
```

The staged migration has improved individual files, but the codebase still
shows the wrong layer:

- Many packages define local `tenantScopedTable` wrappers over the same helper.
- Joins and subqueries still require handwritten tenant equality.
- Tests repeatedly assert that direct `.where({ tenant })` roots disappeared
  from each migrated section.
- Application code can still reach `knex('tenant_scoped_table')` directly.

The database access layer should make tenant-scoped data access the default app
shape. Direct tenant predicates should be an implementation detail of the DB
package, not a repeated business-logic responsibility.

## Goals

1. Give application code a tenant-aware query facade that reads like ordinary
   Knex.
2. Preserve the branded `TenantScopedQuery` contract for authorization and
   other safety-sensitive engines.
3. Make tenant-aware joins and subqueries harder to get wrong than handwritten
   predicates.
4. Require explicit escape hatches for global, admin, discovery, and
   cross-tenant maintenance paths.
5. Ship as a staged migration so existing callers keep working while new and
   touched code moves to the facade.

## Non-goals

- Replacing Knex.
- A full ORM or generated model layer.
- Rewriting every existing caller in one commit.
- Solving row-level authorization. The facade handles tenant root and join
  shape; authorization compilers still add resource-specific predicates.
- Changing RLS or Citus distribution strategy.

## Facade API

The new entry point lives in `@alga-psa/db`.

```ts
import { tenantDb } from '@alga-psa/db';

const db = tenantDb(knex, tenant);

const ticket = await db
  .table('tickets as t')
  .where('t.ticket_id', ticketId)
  .first();
```

`tenantDb(conn, tenant)` returns a lightweight object bound to one
`Knex | Knex.Transaction` and one tenant id.

Initial surface:

```ts
interface TenantDb {
  readonly tenant: string;

  table(tableExpr: string): Knex.QueryBuilder;
  scoped(tableExpr: string): TenantScopedQuery;
  subquery(tableExpr: string): Knex.QueryBuilder;

  tenantJoin(
    builder: Knex.QueryBuilder,
    tableExpr: string,
    left: string,
    right: string,
    options?: TenantJoinOptions
  ): Knex.QueryBuilder;

  unscoped(tableExpr: string, reason: string): Knex.QueryBuilder;
}
```

`table()` is the normal application entry point. It scopes the root table by
metadata and returns a Knex builder for ordinary filtering, sorting, updates,
deletes, and selects.

`scoped()` returns the branded `TenantScopedQuery` for code that must prove the
tenant root is present, such as SQL authorization narrowing.

`subquery()` is an alias for `table()` with a name that makes nested usage
readable at call sites. It still returns a tenant-scoped root.

`tenantJoin()` adds the join condition and the tenant equality required for
tenant-scoped joined tables.

`unscoped()` is the explicit escape hatch. It requires a reason string so
reviewers and static checks can find intentional bypasses.

## Table metadata

The facade needs a registry in `packages/db/src/lib/tenantTableMetadata.ts`.

```ts
type TenantTableScope =
  | { scope: 'tenant'; tenantColumn?: string }
  | { scope: 'global' }
  | { scope: 'admin' };

const tenantTableMetadata: Record<string, TenantTableScope> = {
  tickets: { scope: 'tenant' },
  clients: { scope: 'tenant' },
  rmm_integrations: { scope: 'tenant' },
  rmm_alerts: { scope: 'tenant' },
  tenants: { scope: 'tenant' },
  knex_migrations: { scope: 'global' },
};
```

Rules:

- Unknown tables fail closed in `table()`, `scoped()`, and `tenantJoin()`.
- Tenant tables default to tenant column `tenant`.
- Nonstandard tenant columns are declared in metadata.
- Global tables are readable through `table()` only when the metadata says they
  are truly global.
- Admin tables require an admin-specific path or `unscoped()`.

The first implementation should seed metadata only for the tables needed by the
first facade migration slice plus core test fixtures. Follow-up commits can add
metadata as callers move.

## Alias parsing

The facade reuses the alias inference behavior already present in
`createTenantScopedQuery`:

- `tickets` uses `tickets.tenant`
- `tickets as t` uses `t.tenant`
- `tickets t` uses `t.tenant`

The parser should normalize the base table name separately from the root alias.
Metadata lookup uses the base table. Predicate qualification uses the alias.

## Tenant joins

Tenant-aware joins are the second half of the facade. The common application
shape should be:

```ts
const query = db.table('tickets as t');

db.tenantJoin(query, 'clients as c', 'c.client_id', 't.client_id');
```

For a tenant-scoped joined table, the helper adds both:

```sql
c.client_id = t.client_id
and c.tenant = t.tenant
```

For a global joined table, it adds only the caller's join condition.

The initial implementation can support inner joins first. Left joins and
callback joins can follow once the root API is stable.

## Escape hatches

Some code must query without a tenant root:

- tenant discovery
- login and provider resolution before tenant is known
- tenant deletion and reactivation workflows
- cross-tenant maintenance jobs
- global system tables
- admin reporting

Those paths should use:

```ts
db.unscoped('tenants', 'tenant discovery before login')
```

The reason is part of the API. It should be non-empty and appear in tests or
static scans. This keeps bypasses reviewable without pretending they do not
exist.

## Error handling

Facade errors should fail early and name the unsafe condition:

- missing tenant id
- unknown table metadata
- admin table accessed through tenant path
- tenant join requested for an unknown table
- empty unscoped reason

The errors should not log secrets or SQL parameter values.

## Migration strategy

1. Add table metadata, alias parsing, and `TenantDb` facade in `@alga-psa/db`.
2. Reimplement `createTenantScopedQuery` through the same metadata and alias
   logic, keeping its public contract stable.
3. Add tests for root scoping, alias inference, metadata failures, branded
   scoped queries, tenant joins, and unscoped reasons.
4. Migrate one representative app slice from local `tenantScopedTable` to
   `tenantDb`.
5. Add static guardrails in warning mode:
   - direct `knex('tenant_table')` in production app code
   - direct root `.where({ tenant })`
   - `.where('alias.tenant', tenant)` joins outside the DB package
   - `unscoped()` without a reason
6. Continue the staged migration by package. Each slice keeps the existing
   validation rhythm: focused tests, direct-root scan, broad static check,
   commit, tracker entry, and ticket list/detail sanity check.

## First implementation slice

Start in `packages/db`:

- Add `tenantTableMetadata.ts`.
- Add `tenantDb.ts`.
- Export `tenantDb`, `TenantDb`, and metadata helpers from `packages/db/src/index.ts`.
- Keep `createTenantScopedQuery` as a compatibility API.
- Add package tests in `packages/db/src/lib/tenantDb.test.ts`.

Then migrate a small application section that already has focused contract
coverage. The NinjaOne action file is a good candidate because it is the active
staged migration target and has section-level tenant-scope contracts.

## Verification

For the DB package:

- root tenant predicate uses the inferred alias
- branded `scoped()` queries are accepted by existing authorization compiler
  tests
- unknown tables throw
- global tables do not get tenant predicates
- admin tables fail through tenant access
- `tenantJoin()` adds tenant equality for tenant tables
- `unscoped()` requires a reason

For each migrated app slice:

- focused contract tests prove the facade is used
- scans prove direct root predicates are absent from the migrated section
- `git diff --check` passes
- package typecheck or the broadest available static check is attempted
- `/msp/tickets` loads and a ticket detail page opens in Alga Dev

## Risks

Metadata can become stale. Keep the first registry small, require tests for
every table used by the first migrations, and grow it as part of each slice.

Knex typing may widen in some call sites. Prefer explicit row types at the edge
instead of weakening the facade contract.

Overly broad static gates can block legitimate scripts and tests. Start warning
mode for production app code and keep explicit allowlists for migrations, test
fixtures, and tenant lifecycle tooling.

Tenant deletion and login flows have valid unscoped access. Keep those paths
behind named escape hatches rather than special-casing them invisibly.
