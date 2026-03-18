# Scratchpad — Service-Driven Invoicing Cutover

- Plan slug: `service-driven-invoicing-cutover`
- Created: `2026-03-18`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this cutover plan.

## Decisions

- (2026-03-18) Treat this as a finishing-cutover plan layered on top of the broader `service-period-first-billing-and-cadence-ownership` plan, not a replacement for the whole architecture plan.
- (2026-03-18) Scope includes all remaining app-level work necessary to make service-period-driven invoicing operationally true, including broader unfinished items that directly affect invoicing behavior.
- (2026-03-18) Hourly and usage are in scope for service-driven invoicing windows. They do not precompute charges, but they must bill available content inside the selected service period.
- (2026-03-18) The first cutover checkpoint should establish a shared due-work contract/builder layer in `shared/` and `@alga-psa/types` before changing any reader or UI code, so later steps reuse the same execution identity and display metadata.

## Discoveries / Constraints

- (2026-03-18) `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx` still sources ready rows from `getAvailableBillingPeriods(...)`, stores selection as `Set<billing_cycle_id>`, previews only by `billing_cycle_id`, and maps PO-overage, generate, reverse, and delete flows through billing-cycle IDs.
- (2026-03-18) `packages/billing/src/actions/billingAndTax.ts:getAvailableBillingPeriods(...)` still joins `client_billing_cycles` and `invoices` directly and has no service-period reader contract.
- (2026-03-18) `packages/billing/src/actions/billingCycleActions.ts` still owns invoiced-history, reverse, and delete behavior, all through `client_billing_cycles` plus `invoices.billing_cycle_id`.
- (2026-03-18) `packages/billing/src/actions/invoiceGeneration.ts` has selector-input execution support internally, but `previewInvoice(...)` and `getPurchaseOrderOverageForBillingCycle(...)` still only accept `billing_cycle_id`.
- (2026-03-18) `server/src/lib/api/schemas/invoiceSchemas.ts` still defines `generateInvoiceSchema` and `invoicePreviewRequestSchema` strictly in terms of `billing_cycle_id`.
- (2026-03-18) `server/src/lib/api/services/InvoiceService.ts:generatePreview(...)` still loads `client_billing_cycles` directly and uses `cycle_id` rather than a recurring execution-window contract.
- (2026-03-18) `packages/billing/src/lib/billing/billingEngine.ts` reads `recurring_service_periods` for due selection, but the application has almost no operator-facing read/write layer around those records.
- (2026-03-18) `shared/billingClients/materializeClientCadenceServicePeriods.ts` and `shared/billingClients/materializeContractCadenceServicePeriods.ts` exist as pure planning/materialization helpers, but the scan did not find a real app-level writer/replenishment flow that keeps due rows available for operations.
- (2026-03-18) `server/migrations/20260318120000_create_recurring_service_periods.cjs` constrains `charge_family` to `fixed`, `product`, `license`, `bucket`. That likely blocks a fully explicit hourly/usage materialization story unless widened or reframed.
- (2026-03-18) The engine already supports selector-input recurring execution windows and can distinguish `billing_cycle_window` vs `contract_cadence_window`, so this plan should reuse that runtime path rather than invent another execution model.
- (2026-03-18) Existing shared helpers in `shared/billingClients/recurringRunExecutionIdentity.ts` already provide deterministic execution identity, selection key, and retry key semantics. The new due-work builder can wrap those helpers rather than duplicating key-generation logic.
- (2026-03-18) `server/src/test/test-utils/recurringTimingFixtures.ts` already has a persisted recurring service-period record fixture builder, which makes it straightforward to add contract-cadence due-work tests without standing up DB fixtures yet.
- (2026-03-18) A due-work reader can safely merge persisted service-period rows with compatibility `client_billing_cycles` rows by deduping on `executionIdentityKey`, letting persisted canonical rows win while still surfacing legacy client-cadence work when no canonical row exists.
- (2026-03-18) The current persisted-reader implementation can resolve `contract_line` and `client_contract_line` obligations directly from `recurring_service_periods`; other obligation types remain outside this first reader cut and therefore continue to rely on compatibility/fallback behavior.
- (2026-03-18) `shared/billingClients/backfillRecurringServicePeriods.ts` was already present and exported through `packages/billing/src/index.ts`; the missing work for `F014` was plan-specific validation that the zero-existing-records case is covered explicitly.

## Commands / Runbooks

- (2026-03-18) `rg -n "billing_cycle_id" packages/billing/src/actions packages/billing/src/components server/src/lib/api packages/client-portal/src/actions -g '!**/*.test.*'`
- (2026-03-18) `rg -n "recurring_service_periods" packages/billing/src/actions packages/client-portal/src/actions server/src/lib/api -g '!**/*.test.*'`
- (2026-03-18) `sed -n '1,260p' packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`
- (2026-03-18) `sed -n '428,535p' packages/billing/src/actions/invoiceGeneration.ts`
- (2026-03-18) `sed -n '260,520p' packages/billing/src/actions/billingCycleActions.ts`
- (2026-03-18) `sed -n '1720,1815p' server/src/lib/api/services/InvoiceService.ts`
- (2026-03-18) `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Service-Driven Invoicing Cutover" --slug service-driven-invoicing-cutover`
- (2026-03-18) `pnpm exec vitest run src/test/unit/billing/recurringDueWork.domain.test.ts src/test/unit/billing/recurringTiming.domain.test.ts` (from `server/`; passed)
- (2026-03-18) `pnpm exec tsc --noEmit -p tsconfig.json` (from `server/`; broad compile did not return promptly during this checkpoint, so relied on targeted unit coverage instead)
- (2026-03-18) `pnpm exec vitest run src/test/unit/billing/recurringDueWork.domain.test.ts src/test/unit/billing/recurringServicePeriodDueSelection.domain.test.ts src/test/unit/billing/recurringTiming.domain.test.ts` (from `server/`; passed)
- (2026-03-18) `pnpm exec tsc --noEmit -p tsconfig.json` (from `packages/billing/`; passed after fixing one implicit-`any` in `billingAndTax.ts`)

## Links / References

- Broad architecture plan:
  - [PRD.md](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-16-service-period-first-billing-and-cadence-ownership/PRD.md)
- Key files:
  - [AutomaticInvoices.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx)
  - [billingAndTax.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/billingAndTax.ts)
  - [billingCycleActions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/billingCycleActions.ts)
  - [invoiceGeneration.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/invoiceGeneration.ts)
  - [billingEngine.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/lib/billing/billingEngine.ts)
  - [invoiceSchemas.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/lib/api/schemas/invoiceSchemas.ts)
  - [InvoiceService.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/lib/api/services/InvoiceService.ts)
  - [materializeClientCadenceServicePeriods.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/shared/billingClients/materializeClientCadenceServicePeriods.ts)
  - [materializeContractCadenceServicePeriods.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/shared/billingClients/materializeContractCadenceServicePeriods.ts)
  - [recurringDueWork.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/shared/billingClients/recurringDueWork.ts)
  - [recurringTiming.interfaces.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/types/src/interfaces/recurringTiming.interfaces.ts)
  - [recurringDueWork.domain.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/recurringDueWork.domain.test.ts)
  - [billingAndTax.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/billingAndTax.ts)
  - [recurringServicePeriodDueSelection.domain.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/recurringServicePeriodDueSelection.domain.test.ts)
  - [backfillRecurringServicePeriods.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/shared/billingClients/backfillRecurringServicePeriods.ts)
  - [recurringServicePeriodBackfill.domain.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/recurringServicePeriodBackfill.domain.test.ts)

## Completed Checkpoints

- (2026-03-18) Completed `F001`, `F002`, `F005`, `F006`, and `F007` by adding `IRecurringDueWorkRow` plus `buildClientScheduleDueWorkRow(...)` / `buildServicePeriodRecurringDueWorkRow(...)`. The builders now normalize row identity, cadence-source metadata, service-period labels, invoice-window labels, and contract context on top of the existing recurring execution-window identity helpers.
- (2026-03-18) Completed `T001` through `T005` with focused server-side unit coverage proving stable client/contract execution identities and the new display/context fields on due-work rows.
- (2026-03-18) Completed `F003`, `F004`, `F008`, `F009`, `F010`, `F011`, `F012`, and `F013` by adding `getAvailableRecurringDueWork(...)` in `billingAndTax.ts`. The reader now pulls ready persisted rows from `recurring_service_periods`, carries schedule/period keys and due-state metadata into due-work rows, allows unbridged contract-cadence windows, and merges compatibility billing-cycle rows underneath canonical rows by execution identity.
- (2026-03-18) Completed `T006`, `T007`, and `T008` with unit coverage for billed/archived/superseded suppression and compatibility-row merge behavior when canonical persisted rows are absent.
- (2026-03-18) Completed `F014` / `T013` by validating the pre-existing `backfillRecurringServicePeriods(...)` support with an explicit zero-existing-records test. Active recurring obligations can now be asserted to backfill into future generated service-period rows before the UI depends on them.

## Open Questions

- Should the first cut of the UI show client-cadence and contract-cadence due rows in one unified table or grouped sections?
- Should hourly/usage participation widen `recurring_service_periods.charge_family`, or should the due-work reader treat service periods as cadence windows independent of eventual charge-family projection?
- What exact historical repair semantics should reverse/delete use for billed recurring service periods with no `billing_cycle_id` bridge?
