# Scratchpad - Tenant query full facade

## 2026-06-26 (typecheck cleanup)

- After T408-T411 migration waves, `ee/server` typecheck had ~176 residual errors.
- Root cause of the bulk (TS2551/TS2339): `tenantDb().table('x as t').select('t.col', ...)` narrows the Knex row to `Pick<DynamicTenantRow, "t.col">`, so consuming `.col` fails. Knex string-column types do NOT parse `as` aliases, and `.*` wildcards still produce a `Pick` key.
- Fix pattern: terminate aliased-column queries with `.first<any>()` (or annotate array results `as any[]` / `as unknown as Promise<Array<...>>`). This matches what `optimizedTicketActions.ts` already does via a `as Knex.QueryBuilder` cast on `tenantScopedTable`.
- Fixed so far: documentAssistContextService, projectEmailSubscriber, slaNotificationSubscriber, expireQuotesHandler, slaTimerHandler, internalNotificationSubscriber (`scopedDb` was undefined in appointment-request staff query — added local `tenantDb` facade), ticketEmailSubscriber (`fetchTicketResourceEmails` return cast), webhook project/task payloads.
- `@alga-psa/search` (and `/acl`, `/query`, `/upsert`, `/runAppSearch`, `/actions/searchActionShared`) TS2307 errors were a missing path mapping in `ee/server/tsconfig.json` (server/tsconfig.json had it). Added `@alga-psa/search` + `@alga-psa/search/*` paths.
- `searchAppTypeaheadAction` input type widened to `Partial<Pick<SearchAppInput,...>> & { query: string }` so `{ query }` callers typecheck.
- Remaining: PortalInvitationService, priorityActions, boardActions (TS2352 `as` casts need `as unknown as`), WorkflowDesigner, portal-domain + contract-wizard tests, auditService (done), ImportManager readonly array (done), apiRateLimitSettingsModel onConflict overload (done).
- **RESOLVED**: All 176 residual `ee/server` typecheck errors cleared (0 errors). `server` typecheck also clean (0 errors). Root causes fixed: (1) Knex `Pick<DynamicTenantRow, "t.col">` narrowing on aliased selects — fixed with `.first<any>()` / array `as any[]` / `as unknown as Promise<Array<...>>`; (2) missing `@alga-psa/search` path mapping in `ee/server/tsconfig.json`; (3) `searchAppTypeaheadAction` input widened to `Partial<Pick<...>> & { query }`; (4) `as Type` casts widened to `as unknown as Type`; (5) `internalNotificationSubscriber` undefined `scopedDb` in appointment-request staff query; (6) `ImportManager` readonly `exactFields` spread to mutable; (7) `apiRateLimitSettingsModel` `onConflict` overload fixed via untyped `Knex.QueryBuilder` cast; (8) `WorkflowDesigner` `getTicketsForList` returns `ITicketListItem[]` directly (not wrapped) — used array directly.
- DB facade tests (`tenantDb.test.ts`, `tenantScopedQuery.test.ts`) still pass (21/21).
- T411B marked done in tasks.json; all tasks T408-T411 now complete.

## 2026-06-25

- Full-facade direction approved.
- Design doc: `docs/plans/2026-06-25-tenant-query-full-facade-design.md`.
- Leverage ledger entry: `tenant-query-facade`.
- Batch strategy: use larger swathes and fewer commit/check cycles. Keep
  package tests and one Algadev ticket sanity at code-bearing batch boundaries.
- First batch target: DB facade, facade tests, exports, and representative
  NinjaOne action migration.
- Implemented `tenantDb` with metadata-backed tenant/global/admin table
  categories, root scoping, tenant joins, subquery alias, and reasoned
  unscoped access.
- Migrated NinjaOne action tenant roots from the local `tenantScopedTable`
  helper to `tenantDb`; removed direct tenant-root predicates from the file.
- Shared table-expression alias parsing between `tenantDb` and
  `createTenantScopedQuery`.
- Validation:
  - `packages/db`: `npx vitest run src/lib/tenantDb.test.ts src/lib/tenantScopedQuery.test.ts src/services/BaseService.tenantScopedQuery.test.ts` passed.
  - `packages/db`: `npm run build` passed.
  - `ee/server`: `npx vitest run --config vitest.config.ts src/__tests__/unit/integrations/ninjaoneActionsTenantScoped.contract.test.ts src/__tests__/unit/integrations/rmmDefaultContactActions.contract.test.ts` passed.
  - `ee/server`: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json --pretty false` has no facade or NinjaOne errors; it still fails on existing `@alga-psa/search` module/type errors.
  - `git diff --check` passed.
  - Focused direct tenant-root scan over `ninjaoneActions.ts` returned no matches.
  - Algadev sanity passed for `/msp/tickets` and ticket detail `TIC001015`.
