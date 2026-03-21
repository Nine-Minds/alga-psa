# Scratchpad — Service Catalog Billing Mode Decoupling

- Plan slug: `service-catalog-billing-mode-decoupling`
- Created: `2026-03-21`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-21) Canonical billing vocabulary is `fixed|hourly|usage`; `per_unit` is compatibility-only. Rationale: current migrations already moved toward `usage`, while product APIs still emit `per_unit`; plan must converge on one canonical set.
- (2026-03-21) Service catalog defines identity and optional defaults; contract-line context defines billing behavior. Rationale: same service must be billable differently per agreement.
- (2026-03-21) Non-contract time/usage is explicit invoiceable scope, not implicit fallback absorption into contract lines. Rationale: deterministic allocation and user control over separate invoicing.
- (2026-03-21) Hard cutover selected: no dual-read/dual-write and no transitional alias retention after migration. Rationale: avoid long-term complexity debt and hidden fallback regressions.
- (2026-03-21) Wave 0 canonicalization starts by rejecting `per_unit` at server write-schema boundaries (`serviceSchemas`, `financialSchemas`, `contractLineSchemas`) and hardening migration post-conditions. Rationale: immediate write-path guardrails plus deterministic migration safety without waiting for downstream UI/type cleanup waves.
- (2026-03-21) Mode-specific catalog defaults are stored in a dedicated table (`service_catalog_mode_defaults`) rather than overloading existing `service_prices`. Rationale: keep contract-mode defaults explicit and avoid breaking multi-currency price reads while migration/backfill work lands.
- (2026-03-21) Backfill semantics for mode-defaults are one-way and service-scoped: seed from `service_prices` first, fallback to `service_catalog.default_rate` only when no per-currency rows exist, and fail on unresolved active-service mappings. Rationale: preserve the richest existing pricing data while preventing silent gaps.

## Discoveries / Constraints

- (2026-03-21) Wizard gates services by `billing_method` in picker and server submit validation. Key refs: `ServiceCatalogPicker`, `FixedFeeServicesStep`, `HourlyServicesStep`, `UsageBasedServicesStep`, `contractWizardActions`.
- (2026-03-21) `contractLineServiceActions` still enforces service/type billing-mode coupling in add/attach paths, so wizard-only changes are insufficient.
- (2026-03-21) Billing engine still includes `contract_line_id IS NULL` in time/usage queries per contract-line pass, which can multi-claim unresolved rows without service-aware guard.
- (2026-03-21) `time_entries` default to `contract_line_id = null` in save paths, so allocation correctness must be enforced centrally at billing execution.
- (2026-03-21) Many downstream APIs and schemas require/expose `billing_method` as identity truth (`serviceSchemas`, `productSchemas`, `financialSchemas`, shared interfaces, scheduling aliases); all are in-scope for one-shot cutover updates.
- (2026-03-21) E2E setup currently injects legacy billing-method constraints (`per_unit` etc.), which can mask decoupled behavior regressions.
- (2026-03-21) Existing migration `20251016120000_update_billing_method_to_text.cjs` normalized `per_unit` to `usage` but did not fail when residual legacy rows remained; added explicit residual-count guard + throw.
- (2026-03-21) Product flows still actively write `billing_method: 'per_unit'` (`ProductCatalogService`, `productSchemas`), so canonicalization for product writes remains follow-up in `F037/F039`.
- (2026-03-21) Added migration `20260321110000_create_service_catalog_mode_defaults.cjs` with tenant+service scoped FK, strict unique key `(tenant, service_id, billing_mode, currency_code)`, billing_mode check (`fixed|hourly|usage`), and non-negative rate check.
- (2026-03-21) Added migration `20260321113000_backfill_service_catalog_mode_defaults.cjs` that normalizes `per_unit -> usage`, inserts from `service_prices`, falls back to `service_catalog` defaults, and throws when active services with source defaults still have no mode-default rows.

## Commands / Runbooks

- (2026-03-21) Locate all wizard and action gating points:
  - `rg -n "billingMethods=|must be a .*billing service|billing_method" packages/billing/src/components/billing-dashboard/contracts packages/billing/src/actions`
- (2026-03-21) Locate billing engine null-fallback clauses:
  - `rg -n "contract_line_id IS NULL|usage_tracking\\.contract_line_id.*IS NULL" packages/billing/src/lib/billing/billingEngine.ts`
- (2026-03-21) Locate downstream schema/interface coupling:
  - `rg -n "billing_method|service_type" server/src/lib/api/schemas server/src/interfaces packages/types/src/interfaces packages/scheduling/src/actions packages/client-portal/src/services`
- (2026-03-21) Validate plan artifacts:
  - `jq empty ee/docs/plans/2026-03-21-service-catalog-billing-mode-decoupling/features.json`
  - `jq empty ee/docs/plans/2026-03-21-service-catalog-billing-mode-decoupling/tests.json`
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-21-service-catalog-billing-mode-decoupling`
- (2026-03-21) Validate canonicalization changes and migration guard:
  - `cd server && npx vitest run src/test/unit/migrations/billingMethodCanonicalizationMigration.test.ts src/test/unit/api/contractLineCadenceOwner.schema.test.ts src/test/unit/api/defaultBillingSettings.cadenceOwner.schema.test.ts`
- (2026-03-21) Validate API rejection + mode-default table migration tests:
  - `cd server && npx vitest run src/test/unit/api/serviceBillingMethodCutover.schema.test.ts src/test/unit/migrations/serviceCatalogModeDefaultsMigration.test.ts src/test/unit/migrations/billingMethodCanonicalizationMigration.test.ts`
- (2026-03-21) Validate mode-default backfill migration tests:
  - `cd server && npx vitest run src/test/unit/migrations/serviceCatalogModeDefaultsMigration.test.ts src/test/unit/migrations/serviceCatalogModeDefaultsBackfillMigration.test.ts`

## Links / References

- Plan folder: `ee/docs/plans/2026-03-21-service-catalog-billing-mode-decoupling/`
- Prior related plans:
  - `ee/docs/plans/2026-03-18-service-driven-invoicing-cutover/`
  - `ee/docs/plans/2026-03-20-grouped-automatic-invoices-selection/`
  - `ee/docs/plans/2026-03-20-multi-active-contracts-per-client/`
- Key files:
  - `packages/billing/src/actions/contractWizardActions.ts`
  - `packages/billing/src/actions/contractLineServiceActions.ts`
  - `packages/billing/src/lib/billing/billingEngine.ts`
  - `packages/billing/src/actions/serviceActions.ts`
  - `server/src/lib/api/services/ServiceCatalogService.ts`
  - `server/src/lib/api/services/ProductCatalogService.ts`
  - `packages/scheduling/src/actions/timeEntryCrudActions.ts`
  - `packages/client-portal/src/services/availabilityService.ts`
  - `server/src/lib/api/schemas/serviceSchemas.ts`
  - `server/src/test/e2e/utils/e2eTestSetup.ts`

## Open Questions

- None blocking. Hard cutover policy is set; remaining implementation work is execution order only.
