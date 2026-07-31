# Stop BaseService writing audit columns that don't exist

Branch: `fix/valid-api-action-error-response`
Issue: Nine-Minds/alga-psa#2968 — `PUT /api/v1/statuses/{id}` returns 500 `INTERNAL_ERROR` for a spec-valid request

## Problem

A documented, schema-valid `PUT /api/v1/statuses/{id}` with `{"name": "New"}` returns:

```json
HTTP 500
{ "error": { "code": "INTERNAL_ERROR", "message": "An unexpected error occurred" } }
```

The reporter ruled out request shape (full-field retry gave the identical 500), so this is an
unhandled server-side exception on a valid action.

## Diagnosis (confirmed in code + live schema)

`BaseService.update()` unconditionally stamps audit fields onto every UPDATE
(`packages/db/src/services/BaseService.ts:273-290` via `addUpdateAuditFields`, lines 198-204):

```ts
{ ...data, [this.auditFields.updatedBy]: context.userId, [this.auditFields.updatedAt]: new Date().toISOString() }
```

But the `statuses` table (verified against the running wired DB) has **no `updated_by` and no
`updated_at` columns** — only `created_by`/`created_at`. Postgres rejects the UPDATE with
`42703 undefined_column`; `handleApiError` (`server/src/lib/api/middleware/apiMiddleware.ts:420`)
has no mapping for it and falls through to the generic 500. `StatusService` defines no `update`
override (`server/src/lib/api/services/StatusService.ts`), so every PUT hits this path. Same for
`create()` (`addCreateAuditFields` writes all four audit columns), so `POST /api/v1/statuses` is
broken identically.

### Blast radius — this is an engine defect, not a statuses bug

Cross-referencing every API service's `tableName` against the live schema, services that fall
through to the generic `BaseService` write paths against tables missing audit columns:

| Service | Table | Missing columns | Broken generic verbs |
| --- | --- | --- | --- |
| `StatusService` | `statuses` | `updated_at`, `updated_by` | PUT (reported), POST |
| `CategoryService` | `categories` | `updated_at`, `updated_by` | PUT, POST |
| `PriorityService` | `priorities` | `updated_by` | PUT, POST |
| `TagService` | `tag_mappings` | `updated_at`, `updated_by` | base-path writes |
| `FinancialService` | `transactions` | all four | base-path writes (if routed) |

Two services already fight this exact gap, confirming the engine is the wrong layer:

- `CategoryService` configures `auditFields: { createdBy, createdAt }` intending to opt out of the
  updated-pair (`server/src/lib/api/services/CategoryService.ts:73-76`) — but the constructor
  spread-merges defaults over partial configs (`BaseService.ts:68-74`), so the opt-out is silently
  ignored. There is literally no way to say "this table doesn't have that column."
- `PermissionRoleService` overrides both `add*AuditFields` helpers by hand to strip fields its
  tables lack (`server/src/lib/api/services/PermissionRoleService.ts:98-111`).

## Decisions made in design review

1. **Engine fix, not per-service or per-table** — fix `BaseService` once rather than patching
   `StatusService` or adding migration columns everywhere.
2. **Column introspection, not config** — filter the engine's own audit fields against the table's
   real columns. Explicit config was rejected because it's the mechanism that already failed
   silently twice (above), and `TagService` explicitly declares columns its table doesn't have.
3. **Warn on skip** — implicit behavior must stay visible: log once per table+column when an audit
   field is skipped.
4. **No error-layer changes** — `handleApiError` already logs the underlying error server-side;
   scope stays tight to making the valid action succeed.

## Design

All changes in `packages/db/src/services/BaseService.ts`; no call-site changes anywhere.

### Column cache

```ts
const tableColumnsCache = new Map<string, Promise<Set<string>>>();
```

- `protected getTableColumns(conn: Knex | Knex.Transaction): Promise<Set<string>>` — on miss, runs
  `conn(this.tableName).columnInfo()` and caches the resulting key-set by `this.tableName`,
  module-level. Schema is identical across tenants in a database, so one entry per table is
  correct; a stale cache after a live migration lasts only until process restart, which is
  acceptable. On query failure, delete the cache entry (don't poison it) and rethrow.
- `protected` (not private/free function) so unit tests can override it in a test subclass, and so
  an unusual service could substitute its own source of truth.

### Audit-field filter

`protected async filterAuditFields(conn, data: any): Promise<any>`:

- Looks up the table's column set.
- Removes **only** keys matching the four configured audit column names
  (`this.auditFields.{createdBy,updatedBy,createdAt,updatedAt}`) when that column is absent from
  the table. Every other key passes through untouched — a genuinely wrong payload column must
  still fail loudly.
- First time a given table+column is skipped, `logger.warn` (logger: `@alga-psa/core/logger`, the
  package convention — see `packages/db/src/lib/admin.ts`) e.g.
  `[db/BaseService] table "statuses" has no column "updated_by"; skipping audit field`. Track
  warned pairs in a module-level `Set<string>`.

### Wiring into write paths

Apply the filter after `add*AuditFields`, inside the transaction, in the three engine write paths:

- `create()` (`BaseService.ts:258-268`)
- `update()` (`BaseService.ts:273-290`)
- `delete()` soft-delete branch (`BaseService.ts:299-307`)

The sync helpers `addCreateAuditFields`/`addUpdateAuditFields` keep their exact signatures and
behavior — `ContractLineService` (12 direct call sites) and `PermissionRoleService` (overrides)
are untouched. Their tables' base-path writes gain the same protection automatically because the
filter lives in `create`/`update`/`delete`, not in the helpers.

`tenantColumn` is never filtered — every tenant-scoped table has it, and silently dropping it
would be a correctness hazard, not a convenience.

### Non-goals

- No migrations. Adding `updated_at`/`updated_by` columns everywhere is a separate product
  decision about audit trails, and those columns would only be populated by the v1 API path.
- No change to which fields count as audit fields, no change to error envelopes, no cleanup of the
  non-standard error shapes in the EE chat action path (noted during investigation; different
  branch if ever).

## Implementation steps

1. **Engine change** — `packages/db/src/services/BaseService.ts`: add module-level
   `tableColumnsCache` + warned-pairs set, `getTableColumns`, `filterAuditFields`; call the filter
   in `create`, `update`, and soft-`delete`. Import `logger` from `@alga-psa/core/logger`.
2. **Unit tests** — new `packages/db/src/services/BaseService.auditFields.test.ts` (vitest, beside
   the existing `BaseService.tenantScopedQuery.test.ts`). Use a `TestService` subclass overriding
   `getTableColumns` to return a fixed column set (no DB needed; the existing test's
   connectionless `knex({client:'pg'})` pattern doesn't support `.columnInfo()`):
   - table lacking `updated_by`/`updated_at`: filtered payload contains neither, still contains
     the user's data keys and `created_*` on create;
   - table with all four columns: payload unchanged;
   - non-audit unknown key (e.g. `bogus_column`) is **not** removed;
   - warn emitted once per table+column across repeated calls (spy on logger).
3. **Integration regression test** — new
   `server/src/test/integration/apiStatusUpdate.integration.test.ts` following the existing
   integration-suite conventions (see `server/src/test/integration/*.integration.test.ts` and the
   `integration-testing` skill): drive `StatusService.update` (and `create`) against the real
   `statuses` table with a tenant context — the exact repro of #2968 at the service layer.
   Assert the row is updated and the returned record reflects the change. Before the fix this
   fails with Postgres 42703.
4. **Live verification** (verify skill) — wired stack, dev server `npm run dev` (port 3329):
   - `GET /api/v1/statuses?item_type=ticket` to pick a `status_id`;
   - `PUT /api/v1/statuses/{id}` with `{"name": "..."}` → expect 200 + StatusEnvelope
     (issue's exact repro);
   - `POST /api/v1/statuses` → expect 201;
   - `PUT /api/v1/categories/{id}` and `PUT /api/v1/priorities/{id}` happy path → 200;
   - confirm the one-time skip warning appears in server logs, and that a PUT to a table with
     full audit columns (e.g. `PUT /api/v1/teams/{id}`) still stamps `updated_at`.
5. **Suites** — run `packages/db` vitest and the touched server integration tests.

## Risks

- **Behavioral widening**: base-path writes that previously 500'd on these tables now succeed —
  that is the fix, but it means POST/PUT on categories/priorities/tags start working through the
  generic path; their Zod schemas still gate the payloads.
- **Cache staleness** after an online migration adding an audit column: writes skip the new column
  until restart. Harmless (column is nullable/unpopulated by definition at that moment) and
  self-corrects.
- **`columnInfo()` per table** adds one metadata query per table per process lifetime; negligible.
