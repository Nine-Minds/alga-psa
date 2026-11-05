# Spec — three REST 500/403s, two missing contracts

Card `64ebdeec` · "REST: board PUT 500, team create 403 with admin key, category tree 500" (YourColo
alga-2026-0002687, item 4, v1.6.9)

## 1. What the code already shows

**POST /api/v1/teams → 403 with a full admin API key.** The controller declares
`resource: 'team'` with `create: 'create'` (`server/src/lib/api/controllers/ApiTeamController.ts:54-59`),
but the permission catalog seeds only `team: delete`, `team: read`, `team: update`
(`server/migrations/utils/permissions/catalog.cjs:308-310`). **There is no `team: create` permission
anywhere**, so no role — including `msp:Admin` — can hold it, and every create is refused. This is the
same class as card `78af6fe8` (403 on `/meta`, `/roles`, `/webhooks`): the RBAC resource the controller
checks was never added to the catalog, and the failure looks like an authorization bug in the customer's
key instead of a missing seed.

**PUT /api/v1/boards/{id} → 500 and category tree → 500.** `INTERNAL_CONFIGURATION` is
`apiMiddleware.ts`'s mapping for Postgres `42703` (undefined column), logged server-side with the
table/column. Both are therefore *schema/query drift* — a REST path naming a column the migration set no
longer has (or never had) — and the class is already visible on the sibling card `45d31de9`
(`/teams/hierarchy` 500). Card `cf4fedfd` records that `createBoard` silently ignores
`default_assigned_team_id`, which is the same drift seen from the write side.

## 2. Two contracts that must exist, instead of three patches

### 2.1 Permission catalog completeness (fixes the 403 class)

1. Add `{ resource: 'team', action: 'create', msp: true, client: false, defaultGrants: { algadesk:
   ['msp:Admin'], psa: ['msp:Admin'], co_managed: ['msp:Admin'] } }` and seed it for existing tenants by
   migration (the catalog is a seed source, not a runtime truth — tenants already provisioned need the
   row inserted, same pattern as the earlier catalog backfills).
2. **Add the guard that makes this class impossible:** a test that enumerates every controller's
   declared permission table (the `permissions: { resource, actions }` blocks in
   `server/src/lib/api/controllers/*.ts`) and asserts each `resource:action` pair exists in
   `catalog.cjs`. A controller can then never check a permission the catalog cannot grant. This is the
   cross-route fix card `78af6fe8` asks for; do it here and have that card cite it.

### 2.2 SQL column contract (fixes the 500 class)

`42703` reaching a customer as `INTERNAL_CONFIGURATION` means a query referenced a column that the
migrated schema does not have. Two changes:

1. **Reproduce each 500 against a local stack with an admin API key** (the card's instruction: prefer a
   repro over guessing). The middleware's existing server-side log names the table and column; capture
   that line for the board PUT and for both category-tree endpoints, then fix each at the source (query
   or migration — whichever is wrong; do not paper over with a COALESCE).
2. **Add a schema-contract test** that, for the query builders under test, asserts every column named in
   the select/insert exists in the migrated schema. Practical shape: run the entity's read/write path
   against a migrated test database inside a transaction that is rolled back — a missing column fails in
   CI with the column name, not in production as a 500. Cover the board read/update path and both
   category-tree paths, and make the pattern reusable so `45d31de9` and future routes adopt it.
3. **Make the error mapping honest:** keep `42703 → INTERNAL_CONFIGURATION` for the API contract (it is
   an internal fault, not the caller's), but include the column name in the structured server log and in
   non-production responses, so the next report needs no log dig.

## 3. Deliberately not doing

- **Not loosening the permission check** on team create to "admin bypass". The missing catalog row is the
  defect; an admin bypass would hide the next missing resource too.
- **Not waiting for the customer's request bodies.** The 403 is proven from the catalog; the two 500s are
  reproducible locally, and Loki is a corroboration, not a prerequisite.
- **Not renumbering or rewriting existing migrations** to add a column the queries should not want —
  decide per site whether the query or the schema is right, and say which in the PR body.

## 4. Tests

1. Catalog completeness guard (§2.1.2) — fails on a controller permission with no catalog entry.
2. `POST /api/v1/teams` with an admin API key returns 201 (integration, using the seeded permission).
3. Board `PUT /api/v1/boards/{id}` returns 200 with a representative body; and a schema-contract test
   that would have failed on the missing column.
4. `GET /api/v1/categories/ticket/tree` and `/tree/{boardId}` return 200.
5. Regression: every existing controller permission still resolves for `msp:Admin`.
6. A 42703 raised anywhere returns INTERNAL_CONFIGURATION **and** a log line naming table + column
   (assert the log, since that is the operator contract).

## 5. Risks

- **Seeding `team: create` for existing tenants** is a data migration; verify idempotency and that a
  tenant with a custom admin role gets the grant only through its role, not directly.
- **The catalog guard may surface several pre-existing mismatches** (that is the point). Fix each by
  adding the catalog entry the controller genuinely needs; where a controller checks a permission that
  should not exist, remove the check in the same PR and say why.
- **Schema-contract tests are slower** than unit tests. Run them in the integration suite, not on every
  unit run.
