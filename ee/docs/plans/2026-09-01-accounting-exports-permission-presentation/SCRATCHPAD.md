# Scratchpad — Permission-Aware Accounting Exports Presentation

- Plan slug: `accounting-exports-permission-presentation`
- Created: `2026-09-01`

## Decisions

- (2026-09-01) Treat the supplied mitigation work order as the approved PRD; its scope and acceptance criteria are explicit.
- (2026-09-01) Reuse `useAccountingCapabilities` through its specific integrations subpath, matching the existing billing sync-health component.
- (2026-09-01) Use the sidebar's already-loaded permission strings for navigation filtering and keep server actions authoritative.
- (2026-09-01) Move the existing capability hook implementation to `@alga-psa/auth/hooks/useAccountingCapabilities`; keep the integrations path as a compatibility re-export. The lint-enforced feature-package boundary does not allow billing to import integrations.

## Discoveries / Constraints

- (2026-09-01) `BillingDashboard` derives available tabs from `billingTabDefinitions`; direct unauthorized URLs currently fall back to the first tab.
- (2026-09-01) `AccountingExportsTab` converts a denied list response to an empty batch array and still renders all controls.
- (2026-09-01) All four integration settings components already consume the shared capability hook.
- (2026-09-01) A denied list or batch mutation response now replaces the functional export surface with the same generic denied card used by the dashboard direct-URL guard.

## Commands / Runbooks

- Focused component tests: run the affected billing, integrations, and sidebar Vitest files.
- Full server typecheck requires `NODE_OPTIONS=--max-old-space-size=16384`.
- Focused UI results: billing 5/5, integration-settings contracts 39/39, sidebar composition 9/9.
- Accounting regression results on `TEST_DB_NAME=alga_acct_exports_perm_3292`: role matrix 26/26, mapping CRUD 3/3, mapping permissions 2/2, accounting export server enforcement 5/5.
- Full server typecheck and root `npm run build` passed.

## Links / References

- PR: https://github.com/Nine-Minds/alga-psa/pull/3292
- `packages/billing/src/components/billing-dashboard/accounting/AccountingExportsTab.tsx`
- `packages/billing/src/components/billing-dashboard/BillingDashboard.tsx`

## Open Questions

- None. Full build retains unrelated existing broad-file-tracing and duplicate-config warnings.
