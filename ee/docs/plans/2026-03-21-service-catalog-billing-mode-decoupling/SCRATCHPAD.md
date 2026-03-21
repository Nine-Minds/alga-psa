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
- (2026-03-21) Wizard and template service pickers now apply only `itemKinds=['service']` gating for fixed/hourly/usage sections; billing-method filter arguments were removed from these step-level picker calls. Rationale: service identity is catalog-level and billing mode is contract-context.
- (2026-03-21) Contract/template wizard submit validators now enforce only `item_kind='service'` for fixed/hourly/usage service arrays; billing_method matching checks were removed from server-side submission validation.
- (2026-03-21) `addServiceToContractLine` now determines default configuration type from target `contract_line_type` (Fixed/Hourly/Usage) and validates explicit `configType` compatibility per line mode, instead of deriving from catalog/service-type billing method.

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
- (2026-03-21) `ServiceCatalogPicker` still supports optional `billing_methods`, but wizard and template steps no longer pass billing-method filters in fixed/hourly/usage service flows; only products step still uses `itemKinds=['product']` as expected.
- (2026-03-21) Added integration coverage (`T013-T018`) in `server/src/test/integration/contractWizard.integration.test.ts` for decoupled acceptance (fixed/hourly/usage) and non-service rejections.
- (2026-03-21) Removed `service_types` join and `service_type_billing_method` dependency in `contractLineServiceActions` attach flow; compatibility now enforced via target line mode + `allowedConfigTypesByPlan`.

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
- (2026-03-21) Validate wizard picker decoupling static guards:
  - `cd server && npx vitest run src/test/unit/fixedWizardPickerPolicy.static.test.ts`
- (2026-03-21) Validate server submit decoupling integration tests:
  - `cd server && npx vitest run src/test/integration/contractWizard.integration.test.ts`
  - Note: blocked locally in this run due unavailable DB test harness (`ECONNREFUSED 127.0.0.1:5438`).
- (2026-03-21) Validate contract-line service attach mode-context guards:
  - `cd server && npx vitest run src/test/unit/api/contractLineService.decoupledAttach.static.test.ts`

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
- (2026-03-21) Completed F012-F014 by resolving fixed/hourly/usage wizard prefill from `service_catalog_mode_defaults` keyed by line mode + currency, with fallback to catalog `default_rate` and explicit submission overrides taking precedence. Key ref: `packages/billing/src/actions/contractWizardActions.ts`.
- (2026-03-21) Hardened wizard currency validation to treat mode-default/catalog-default resolved rates as priced inputs so contracts do not fail when no `service_prices` row exists but valid defaults do. Rationale: preserve prefill semantics under decoupled model.
- (2026-03-21) Replaced temporary static checks with DB-backed integration tests `T021-T024` in `server/src/test/integration/contractWizard.integration.test.ts` covering mode-default prefill and override precedence for fixed/hourly/usage.
- (2026-03-21) Test run: `cd server && npx vitest run src/test/integration/contractWizard.integration.test.ts` currently blocked locally by Postgres not listening on `127.0.0.1:5438`/`::1:5438`; suite collected and skipped tests due beforeAll connection failure.
- (2026-03-21) Completed F015 by adding contract-line form metadata labels (`Effective mode`, `Default source`) and switching mode derivation to contract-line context instead of `service_catalog.billing_method`. Key refs: `ContractLineServiceForm.tsx`, `ServiceConfigurationPanel.tsx`, `BaseServiceConfigPanel.tsx`.
- (2026-03-21) Added `T025` UI test coverage in `packages/billing/tests/contractLineServiceForm.metadata.test.tsx` validating catalog-default, contract-override, and none source labels plus contract-line effective mode mapping.
- (2026-03-21) Test run: `cd server && npx vitest run ../packages/billing/tests/contractLineServiceForm.metadata.test.tsx` (pass).
- (2026-03-21) Completed F016/F017 by updating draft/template resume readers to preload `service_catalog_mode_defaults` (hourly/usage) and prefer mode-default rates before catalog fallback when reconstructing wizard snapshots. Key ref: `getDraftContractForResume`, `getContractTemplateSnapshotForClientWizard` in `contractWizardActions.ts`.
- (2026-03-21) Added/updated `T026/T027` in `packages/billing/tests/draftContractForResumeActions.test.ts` to assert resume/template round-trip uses decoupled selections and mode-default prefills when stored rates are empty.
- (2026-03-21) Test run: `cd server && npx vitest run ../packages/billing/tests/draftContractForResumeActions.test.ts` (pass).
- (2026-03-21) Completed F018-F022 in billing engine by removing unconditional null-line allocation and introducing service-constrained allocation: explicit `contract_line_id` first, otherwise unassigned rows only when service-to-line match is unique for active client assignments in the service window. Added contract-line service membership filters for both time and usage.
- (2026-03-21) Completed F023-F025 guard rails by preserving existing hourly minimum/round/overtime logic, usage minimum/custom-rate/tier logic, and bucket overage path; added static assertions to lock these behaviors.
- (2026-03-21) Added/updated tests: `server/src/test/unit/billingEngine.test.ts` (T030-T035 behavior coverage) and `server/src/test/unit/billing/billingEngine.contractLineAllocation.static.test.ts` (T028-T029, T036-T040 static guards).
- (2026-03-21) Test run: `cd server && npx vitest run src/test/unit/billingEngine.test.ts src/test/unit/billing/billingEngine.contractLineAllocation.static.test.ts` (pass).
- (2026-03-21) Completed F026/F027 by extending due-work materialization to append unresolved non-contract rows (time + usage) using deterministic `schedule:...:non_contract:<type>:<recordId>` selectors and client-level currency/tax metadata in `getAvailableRecurringDueWork`. Key refs: `packages/billing/src/actions/billingAndTax.ts`, `packages/billing/src/lib/billing/billingEngine.ts`.
- (2026-03-21) Completed F028/F029/F030 by rendering non-contract child labels in grouped Automatic Invoices UI and preserving child-level generation targeting so contract-only and non-contract-only selection paths generate independently. Key ref: `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`.
- (2026-03-21) Added non-contract selection handling in invoice generation scoping: non-contract selector keys bypass recurring obligation scoping and flow through dedicated `nonContractSelection` options. Key ref: `packages/billing/src/actions/invoiceGeneration.ts`.
- (2026-03-21) Added tests for T041-T045:
  - `server/src/test/unit/billing/nonContractDueWork.integration.test.ts`
  - `server/src/test/unit/billing/automaticInvoices.nonContractSelection.ui.test.tsx`
- (2026-03-21) Updated preview summary copy to explicitly differentiate one combined invoice vs multiple separate invoices in grouped preview dialog (`AutomaticInvoices.tsx`).
- (2026-03-21) Completed F031 by extending grouped UI combinability checks to include invoice-window scope alongside client/currency/tax/export/PO and by validating mixed selection behavior end-to-end in UI tests. Key ref: `AutomaticInvoices.tsx`.
- (2026-03-21) Marked F032 complete after verifying grouped preview summary explicitly states one combined invoice vs N separate invoices (`preview-invoice-count-summary`), with test coverage in `automaticInvoices.nonContractSelection.ui.test.tsx`.
- (2026-03-21) Added/updated `T011` in `server/src/test/unit/billing/automaticInvoices.nonContractSelection.ui.test.tsx` to assert compatible mixed selections combine as a parent-group target while incompatible scope selections (currency mismatch) split into child-level targets.
- (2026-03-21) Marked `T001` complete by validating migration canonicalization + mode-default schema/backfill suites (`billingMethodCanonicalizationMigration`, `serviceCatalogModeDefaultsMigration`, `serviceCatalogModeDefaultsBackfillMigration`).
- (2026-03-21) Completed F033 by decoupling service-catalog API filter/sort semantics from billing metadata for non-service contexts: `billing_method` filtering and sort precedence now apply only when `item_kind='service'`, with safe service-name fallback elsewhere.
- (2026-03-21) Completed F034 by mirroring the same service-only billing-metadata filter/sort semantics in shared helper `shared/billingClients/services.ts` to keep caller behavior consistent across API and shared query paths.
- (2026-03-21) Added static guard coverage `T014` in `server/src/test/unit/billing/serviceQueryDecoupling.static.test.ts` to lock decoupled filter/sort behavior in both `ServiceCatalogService` and shared billing-client helpers.
- (2026-03-21) Marked `T002` complete via backfill migration guard assertions in `serviceCatalogModeDefaultsBackfillMigration.test.ts` (unmappable mode + missing required default mappings fail fast with actionable messages).
- (2026-03-21) Completed F035 by removing scheduling lookup proxying (`sc.billing_method as service_type`) in `timeEntryCrudActions`; service identity now resolves from `service_types.name`, while billing metadata is returned separately as `billing_mode` + `item_kind`.
- (2026-03-21) Completed F036 by updating client-portal availability service queries to join `service_types` and expose `service_type` from taxonomy instead of aliasing `billing_method`; `billing_mode` and `item_kind` are returned as metadata fields.
- (2026-03-21) Added static guard coverage `T015` in `server/src/test/unit/billing/schedulingAvailabilityDecoupling.static.test.ts` to prevent regression to `billing_method as service_type` proxying in scheduling and client-portal availability reads.
- (2026-03-21) Completed F037 by canonicalizing product catalog writes in `ProductCatalogService` create/update paths from legacy `per_unit` to `usage` so active product writes no longer emit legacy billing vocabulary.
- (2026-03-21) Added static write guard `server/src/test/unit/api/productCatalogCanonicalWrites.static.test.ts` to enforce canonical product billing writes and prevent reintroduction of `billing_method: 'per_unit'` in product service APIs.
- (2026-03-21) Completed F038/F039 by hard-cutting service/product schema contracts to canonical vocabulary: product schema now accepts/defaults `usage` (not `per_unit`), and schema tests explicitly reject legacy values. Key refs: `server/src/lib/api/schemas/productSchemas.ts`, `server/src/test/unit/api/productBillingMethodCutover.schema.test.ts`.
- (2026-03-21) Completed F040 by removing `per_unit` from server/shared billing interface unions and adding static guards that financial + contract-line schemas remain canonical `fixed|hourly|usage`. Key refs: `server/src/interfaces/billing.interfaces.ts`, `packages/types/src/interfaces/billing.interfaces.ts`, `server/src/test/unit/api/billingInterfacesCutover.static.test.ts`.
- (2026-03-21) Marked T012/T013 complete based on schema + interface guard suite run (service/product cutover schemas and financial/contract-line canonical enums).
- (2026-03-21) Completed F041 by decoupling onboarding service creation from service-type billing metadata: onboarding now captures an explicit `serviceBillingMode` and `setupBilling` writes `service_catalog.billing_method` from onboarding input (fallback `usage`) instead of `service_types.billing_method`. Key refs: `packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts`, `packages/onboarding/src/components/steps/BillingSetupStep.tsx`, `packages/onboarding/src/components/OnboardingWizard.tsx`, `packages/types/src/lib/onboardingWizard.ts`.
- (2026-03-21) Completed F042 by removing service-type-driven billing auto-overwrite in service settings forms (`ServiceForm`, `QuickAddService`); changing service type now updates taxonomy only and preserves user-selected billing mode.
- (2026-03-21) Added `T016` guard coverage in `server/src/test/unit/billing/onboardingServiceTypeDecoupling.static.test.ts` to enforce onboarding/service-settings decoupling and prevent regressions to identity-level billing coupling.

- (2026-03-21) Validation runbooks:
  - `cd server && npx vitest run src/test/unit/billing/nonContractDueWork.integration.test.ts src/test/unit/billing/automaticInvoices.nonContractSelection.ui.test.tsx`
  - `cd server && npx vitest run src/test/unit/billing/recurringDueWorkReader.integration.test.ts`
  - `npx tsc -p packages/billing/tsconfig.json --noEmit` (fails on pre-existing unrelated package type errors; no new errors from the F026-F030 patch set).
  - `cd server && npx vitest run src/test/unit/billing/automaticInvoices.nonContractSelection.ui.test.tsx` (pass, includes T011 and T049 assertions)
  - `cd server && npx vitest run src/test/unit/migrations/billingMethodCanonicalizationMigration.test.ts src/test/unit/migrations/serviceCatalogModeDefaultsMigration.test.ts src/test/unit/migrations/serviceCatalogModeDefaultsBackfillMigration.test.ts` (pass)
  - `cd server && npx vitest run src/test/unit/billing/serviceQueryDecoupling.static.test.ts` (pass, T014 guards)
  - `cd server && npx vitest run src/test/unit/billing/schedulingAvailabilityDecoupling.static.test.ts` (pass, T015 guards)
  - `cd server && npx vitest run src/test/unit/api/productCatalogCanonicalWrites.static.test.ts` (pass)
  - `cd server && npx vitest run src/test/unit/api/serviceBillingMethodCutover.schema.test.ts src/test/unit/api/productBillingMethodCutover.schema.test.ts src/test/unit/api/billingInterfacesCutover.static.test.ts` (pass, T012/T013)
  - `cd server && npx vitest run src/test/unit/billing/onboardingServiceTypeDecoupling.static.test.ts` (pass, T016)
