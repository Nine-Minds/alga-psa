# Scratchpad — Recurring Invoicing Hard Cutover

- Plan slug: `recurring-invoicing-hard-cutover`
- Created: `2026-03-18`

## What This Is

Working notes for the hard-cutover plan that removes recurring invoice bridge assumptions after service-period-driven recurring execution already exists.

## Decisions

- (2026-03-18) Treat `client_billing_cycles` as a legitimate client cadence concept, not as recurring invoice execution identity.
- (2026-03-18) Treat `billing_cycle_id` as historical/optional metadata only in the target state; it should not remain a first-class recurring contract.
- (2026-03-18) Do not support mixed recurring schema states in steady-state application code.
- (2026-03-18) Prefer explicit hard failures and repair actions over fallback compatibility rows when recurring service-period materialization is missing.
- (2026-03-18) This plan is a hard-cutover follow-on to the broader service-period-first plan and the softer service-driven invoicing cutover plan.
- (2026-03-18) Keep the hard-cutover architecture notes separate from the softer service-driven runbook so the steady-state model is explicit and testable.

## Agent Findings

- Documentation slice completed:
  - Added [ARCHITECTURE.md](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-18-recurring-invoicing-hard-cutover/ARCHITECTURE.md) to define the hard-cutover invariant, the limited role of `client_billing_cycles`, the required-schema posture, and the `invoices.billing_cycle_id` deprecation posture.
  - Added [RUNBOOK.md](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-18-recurring-invoicing-hard-cutover/RUNBOOK.md) to describe the final recurring mental model, missing-materialization diagnosis, and canonical reverse/delete repair expectations.
  - Added [recurringInvoicingHardCutover.runbook.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/docs/recurringInvoicingHardCutover.runbook.test.ts) to lock T072/T073/T074 against regressions.

- Billing UI/actions sweep:
  - `AutomaticInvoices`, due-work selection, recurring run target selection, history, reversal/delete, accounting export, and some authoring/storage helpers still preserve bridge-first recurring behavior.
  - Notable files:
    - [AutomaticInvoices.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx)
    - [billingAndTax.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/billingAndTax.ts)
    - [recurringBillingRunActions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/recurringBillingRunActions.ts)
    - [recurringBillingRunActions.shared.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/recurringBillingRunActions.shared.ts)
    - [billingCycleActions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/billingCycleActions.ts)
    - [accountingExportInvoiceSelector.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/services/accountingExportInvoiceSelector.ts)
- API/contracts sweep:
  - recurring preview/generate request contracts, invoice DTOs, recurring shared types, and invoice list/read classification still preserve `billing_cycle_id` as a recurring concept.
  - Notable files:
    - [ApiInvoiceController.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/lib/api/controllers/ApiInvoiceController.ts)
    - [invoiceSchemas.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/lib/api/schemas/invoiceSchemas.ts)
    - [InvoiceService.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/lib/api/services/InvoiceService.ts)
    - [recurringTiming.interfaces.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/types/src/interfaces/recurringTiming.interfaces.ts)
    - [invoice.interfaces.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/types/src/interfaces/invoice.interfaces.ts)
- Runtime/history sweep:
  - billing engine, invoice generation, invoice linkage, bucket usage, schedule changes, jobs, and migrations still preserve bridge-era assumptions.
  - Notable files:
    - [billingEngine.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/lib/billing/billingEngine.ts)
    - [invoiceGeneration.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/invoiceGeneration.ts)
    - [invoiceService.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/services/invoiceService.ts)
    - [bucketUsageService.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/services/bucketUsageService.ts)
    - [billingScheduleActions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/billingScheduleActions.ts)
    - [20241130164200_add_billing_cycle_id_to_invoices.cjs](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/migrations/20241130164200_add_billing_cycle_id_to_invoices.cjs)

## Discoveries / Constraints

- (2026-03-18) The repo already had an in-progress service-driven runbook/test update in the worktree; the hard-cutover docs were added in separate files to avoid mixing coexistence guidance with the post-bridge model.
- (2026-03-18) `invoiceModification.ts` still uses null/non-null `billing_cycle_id` to classify prepayment-style invoices, which will misclassify bridge-less recurring invoices.
- (2026-03-18) `billingAndTax.ts` still merges canonical recurring due work with synthetic compatibility rows and has mixed-schema missing-relation guards.
- (2026-03-18) `recurringRunExecutionIdentity.ts` still embeds `billingCycleId` into recurring identity and selection contracts.
- (2026-03-18) `billingCycleActions.ts` still frames recurring history and reversal as billing-cycle operations.
- (2026-03-18) `InvoiceService.ts` still classifies recurring invoice rows via `invoices.billing_cycle_id` in some read paths.
- (2026-03-18) one API service path still appears to reference old cycle column names (`cycle_id`, `period_start`, `period_end`) and should be rechecked during cleanup.
- (2026-03-18) bucket recurring logic still prefers `client_billing_cycles` as a resolution source.
- (2026-03-18) accounting export still carries canonical-vs-fallback recurring provenance states.

## Commands / Runbooks

- `rg -n "billing_cycle_id|client_billing_cycles|getAvailableBillingPeriods|missing_service_period_materialization|isMissingRecurringDueWorkRelation" packages/billing/src server/src/lib/api shared -g '!**/*.test.*'`
- `rg -n "prepayment|billing_cycle_id" packages/billing/src/actions packages/billing/src/services -g '!**/*.test.*'`
- `rg -n "recurring_projection|hasBillingCycleBridge|billingCycleId" packages/types/src server/src/interfaces server/src/lib/api -g '!**/*.test.*'`
- `rg -n "billing cycle" packages/billing/src/components packages/billing/src/actions -g '!**/*.test.*'`
- `cd server && pnpm exec vitest run src/test/unit/docs/recurringInvoicingHardCutover.runbook.test.ts --coverage.enabled=false`

## Completed Items

- (2026-03-18) F001 implemented by defining canonical service-period or execution-window identity as the only recurring execution identity in `ARCHITECTURE.md`.
- (2026-03-18) F002 implemented by documenting `client_billing_cycles` as cadence/source-rule infrastructure and optional historical context only.
- (2026-03-18) F074 implemented by documenting `invoices.billing_cycle_id` as passive historical metadata only in recurring code until later physical removal.
- (2026-03-18) F080 implemented by adding hard-cutover architecture and operator runbook guidance for the final recurring model.
- (2026-03-18) T072/T073/T074 implemented with a focused documentation regression test for the final model, client-cycle role, and `billing_cycle_id` deprecation posture.

## Links / References

- Broad architecture:
  - [PRD.md](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-16-service-period-first-billing-and-cadence-ownership/PRD.md)
- Softer cutover plan:
  - [PRD.md](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-18-service-driven-invoicing-cutover/PRD.md)

## Open Questions

- Should there be a later physical schema removal plan for `invoices.billing_cycle_id`, or is passive historical retention enough?
- How much read-side fallback for historically incomplete recurring linkage is acceptable after live recurring compatibility branches are removed?
