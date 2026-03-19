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
- Due-work cutover slice completed:
  - Updated [billingAndTax.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/billingAndTax.ts) so ready recurring work comes only from persisted `recurring_service_periods`, with client-cadence materialization gaps surfaced separately as repair records instead of compatibility due rows.
  - Updated [recurringRunExecutionIdentity.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/shared/billingClients/recurringRunExecutionIdentity.ts) to add canonical `client_cadence_window` identity keyed by schedule/period/window instead of `billingCycleId`.
  - Updated [recurringDueWork.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/shared/billingClients/recurringDueWork.ts) so client-cadence due-work rows can be built bridge-free while still carrying optional `billingCycleId` metadata for display.
  - Updated [billingEngine.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/lib/billing/billingEngine.ts) to stop treating missing recurring-service-period relations as an acceptable mixed-schema fallback.
  - Added/updated focused tests:
    - [recurringDueWork.domain.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/recurringDueWork.domain.test.ts)
    - [recurringDueWorkReader.integration.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/recurringDueWorkReader.integration.test.ts)
    - [recurringDueWorkReader.static.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/recurringDueWorkReader.static.test.ts)
- Recurring run-orchestration slice completed:
  - Updated [recurringBillingRunActions.shared.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/recurringBillingRunActions.shared.ts) so recurring run targets always carry canonical `selectorInput` plus execution-window identity; client-cadence target mapping now starts from canonical due-work rows instead of billing periods.
  - Updated [recurringBillingRunActions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/recurringBillingRunActions.ts) so recurring batch selection reads only `getAvailableRecurringDueWork(...)`, recurring runs no longer accept raw `billingCycleIds`, and execution always delegates through `generateInvoiceForSelectionInput(...)`.
  - Updated [AutomaticInvoices.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx) so ready-table, preview, and PO-overage generate flows submit canonical recurring targets for both bridged client rows and bridge-free contract rows.
  - Updated recurring workflow metadata in [recurringBillingRunEventBuilders.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/shared/workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders.ts) and [billingEventSchemas.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/shared/workflow/runtime/schemas/billingEventSchemas.ts) so run payloads use `client_cadence_window`, `contract_cadence_window`, or `mixed_execution_windows`, rather than treating billing-cycle windows as the default live recurring mode.
  - Added/updated focused tests:
    - [recurringBillingRunActions.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/recurringBillingRunActions.test.ts)
    - [recurringBillingRunActions.static.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/recurringBillingRunActions.static.test.ts)
    - [recurringBillingRunWorkflowEvents.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/recurringBillingRunWorkflowEvents.test.ts)
    - [recurringBillingRunWindowIdentity.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/recurringBillingRunWindowIdentity.test.ts)
    - [automaticInvoices.recurringDueWork.ui.test.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/automaticInvoices.recurringDueWork.ui.test.tsx)
    - [contractPurchaseOrderSupport.ui.test.tsx](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/contractPurchaseOrderSupport.ui.test.tsx)
- Billing-calculation and duplicate-detection slice completed:
  - Updated [invoiceGeneration.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/invoiceGeneration.ts) so selector-input billing always executes through `calculateBillingForExecutionWindow(...)`, no longer runs rollout-era legacy-vs-canonical comparison mode, and checks client-cadence duplicates via canonical `recurring_service_periods` schedule/period linkage before any legacy billing-cycle fallback.
  - Updated [billingEngine.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/lib/billing/billingEngine.ts) to remove the unused billing-cycle parameter from persisted recurring due-selection loading.
  - Added/updated focused tests:
    - [invoiceGeneration.recurringSelection.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/invoiceGeneration.recurringSelection.test.ts)
    - [invoiceGeneration.duplicate.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/invoiceGeneration.duplicate.test.ts)
    - [invoiceGeneration.duplicate.static.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/invoiceGeneration.duplicate.static.test.ts)
    - [invoiceGeneration.selectorInputGenerate.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/invoiceGeneration.selectorInputGenerate.test.ts)
    - [invoiceGeneration.preview.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/invoiceGeneration.preview.test.ts)
    - [invoiceGeneration.emptyResult.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/invoiceGeneration.emptyResult.test.ts)
    - [invoiceGeneration.zeroDollarFinalization.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/invoiceGeneration.zeroDollarFinalization.test.ts)

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
- (2026-03-18) The due-work reader still needs later UI/run-action follow-up because some surfaces continue to use `billingCycleId` for row actions even though due-work identity is now canonical.
- (2026-03-18) `invoiceModification.ts` still uses null/non-null `billing_cycle_id` to classify prepayment-style invoices, which will misclassify bridge-less recurring invoices.
- (2026-03-18) `billingAndTax.ts` now sources ready recurring work only from `recurring_service_periods`, but the separate repair-gap surface still needs downstream UI handling so operators can act on missing materialization without relying on compatibility rows.
- (2026-03-18) recurring run selection, `AutomaticInvoices`, and recurring preview/generate API requests now use canonical selector-input targets, but shared type unions and some read-side/history surfaces still carry legacy `billing_cycle_id` or `billing_cycle_window` semantics.
- (2026-03-18) `generateInvoice(...)`, `previewInvoice(...)`, and PO-overage selection now normalize legacy billing-cycle entrypoints onto canonical client-cadence selector input before duplicate detection or billing calculation. `billingCycleId` remains only as optional metadata on the normalized selector while request-shape cleanup is still pending.
- (2026-03-18) recurring preview/generate API schemas now reject top-level `billing_cycle_id` and `billing_cycle_window` selector inputs. The remaining bridge-only fields live in shared type unions and read-side/history surfaces, not in recurring preview/generate request handling.
- (2026-03-18) Legitimate client billing schedule administration still has separate schedule-specific schemas and actions (`financialSchemas.ts`, `billingScheduleActions.ts`, `billingCycleAnchorActions.ts`) after recurring preview/generate stopped accepting `billing_cycle_id`.
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
- `cd server && pnpm exec vitest run src/test/unit/billing/recurringDueWork.domain.test.ts src/test/unit/billing/recurringDueWorkReader.integration.test.ts src/test/unit/billing/recurringDueWorkReader.static.test.ts src/test/unit/billing/billingEngine.timing.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/recurringServicePeriodDueSelection.domain.test.ts src/test/unit/billing/recurringTiming.domain.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/recurringBillingRunActions.test.ts src/test/unit/billing/recurringBillingRunActions.static.test.ts src/test/unit/billing/recurringBillingRunWorkflowEvents.test.ts src/test/unit/billing/recurringBillingRunWindowIdentity.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/automaticInvoices.recurringDueWork.ui.test.tsx src/test/unit/billing/contractPurchaseOrderSupport.ui.test.tsx --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/invoiceGeneration.recurringSelection.test.ts src/test/unit/billing/invoiceGeneration.selectorInputGenerate.test.ts src/test/unit/billing/invoiceGeneration.preview.test.ts src/test/unit/billing/invoiceGeneration.emptyResult.test.ts src/test/unit/billing/invoiceGeneration.duplicate.test.ts src/test/unit/billing/invoiceGeneration.duplicate.static.test.ts src/test/unit/billing/invoiceGeneration.zeroDollarFinalization.test.ts --coverage.enabled=false`

## Completed Items

- (2026-03-18) F001 implemented by defining canonical service-period or execution-window identity as the only recurring execution identity in `ARCHITECTURE.md`.
- (2026-03-18) F002 implemented by documenting `client_billing_cycles` as cadence/source-rule infrastructure and optional historical context only.
- (2026-03-18) F074 implemented by documenting `invoices.billing_cycle_id` as passive historical metadata only in recurring code until later physical removal.
- (2026-03-18) F080 implemented by adding hard-cutover architecture and operator runbook guidance for the final recurring model.
- (2026-03-18) T072/T073/T074 implemented with a focused documentation regression test for the final model, client-cycle role, and `billing_cycle_id` deprecation posture.
- (2026-03-18) F003/F004/F005/F006 implemented by removing recurring due-work compatibility merges, removing recurring mixed-schema fallback guards from the reader/engine, and sourcing ready recurring work only from persisted service-period rows.
- (2026-03-18) F007/F008/F009 implemented by introducing canonical client-cadence execution identity keyed by schedule/period/window and treating `billingCycleId` only as optional read-side metadata on due-work rows.
- (2026-03-18) T001/T002/T003/T004/T005/T006 implemented with static, integration, and unit coverage for canonical due-work sourcing and bridge-free client-cadence row identity.
- (2026-03-18) F010/F011/F012/F013 implemented by removing raw-cycle recurring run entrypoints, selecting recurring runs from canonical due-work rows only, and making the recurring run executor invoke selector-input invoice generation for all cadence owners.
- (2026-03-18) F014/F015 implemented at the run-target boundary by removing required `billingCycleId` from recurring run target contracts and making client-cadence run identity schedule/period/window keyed end to end.
- (2026-03-18) T007/T008/T023/T024/T026/T027/T028 implemented with unit, integration, static, and UI coverage for bridge-free execution identity keys, canonical recurring run selection, and selector-input-only recurring run execution.
- (2026-03-18) F016 implemented by removing the billing-cycle-vs-execution-window branch from selector-input billing calculation helpers and using execution-window-first billing for recurring selector inputs and compatibility wrappers alike.
- (2026-03-18) F017 implemented by deleting the rollout-era recurring comparison-mode branch from `invoiceGeneration.ts`.
- (2026-03-18) F018/F019/F020 implemented by normalizing legacy billing-cycle preview/generate entrypoints onto canonical client-cadence selector identity, deleting the remaining `invoices.billing_cycle_id` duplicate fallback, and keeping rerun or retry behavior keyed off canonical execution identity even when `billing_cycle_id` is retained as passive metadata.
- (2026-03-18) F021/F022 implemented by making recurring preview/generate API schemas require canonical `selector_input` and reject `billing_cycle_id` request shapes or `billing_cycle_window` selector inputs.
- (2026-03-18) F023/F024 implemented by proving the `AutomaticInvoices` preview/generate actions submit canonical selector input for both client-cadence and contract-cadence due rows, even when passive billing-cycle metadata is still displayed on the row.
- (2026-03-18) F025/F026 implemented by removing API service/controller routing through `generateInvoice(...)` or `previewInvoice(...)`, renaming the generate controller path away from billing-cycle framing, and making recurring API routes depend only on selector-input actions.
- (2026-03-18) F027 confirmed by keeping billing-cycle-specific schedule administration surfaces separate from recurring execution APIs; no recurring preview/generate contract still depends on those schedule-only endpoints.
- (2026-03-18) T020/T021/T022 implemented with client-cadence, contract-cadence, and static source coverage showing duplicate detection uses canonical recurring linkage before any legacy billing-cycle fallback.

## Links / References

- Broad architecture:
  - [PRD.md](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-16-service-period-first-billing-and-cadence-ownership/PRD.md)
- Softer cutover plan:
  - [PRD.md](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-18-service-driven-invoicing-cutover/PRD.md)

## Open Questions

- Should there be a later physical schema removal plan for `invoices.billing_cycle_id`, or is passive historical retention enough?
- How much read-side fallback for historically incomplete recurring linkage is acceptable after live recurring compatibility branches are removed?
