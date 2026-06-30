# Scratchpad - Tenant query full facade

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
