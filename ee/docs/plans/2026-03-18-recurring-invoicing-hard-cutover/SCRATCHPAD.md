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
- (2026-03-18) Recurring invoice linkage should derive candidate obligations from canonical persisted detail metadata (`config_id`, service-period window, due position, invoice window) plus contract-line or assignment identity, never from invoice-header `billing_cycle_id`.
- (2026-03-18) Prepayment classification should use explicit invoice-kind state (`is_prepayment`) rather than the absence of a recurring bridge field; bridge-less recurring invoices and prepayments are separate concepts.
- (2026-03-18) Persisted recurring execution windows are already canonical recurring truth, so billing-engine validation for selector-input recurring runs must not round-trip back through `client_billing_cycles` or auto-create cycle rows just to validate the window.
- (2026-03-18) Direct `selector_input` preview/generate requests must normalize and validate against persisted `recurring_service_periods`; treating the caller-provided window as trusted input leaves a gap where mutated windows can bypass canonical service-period authority.

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
- Billing-engine recurring execution slice completed:
  - Updated [billingEngine.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/lib/billing/billingEngine.ts) so selector-input recurring due-work loading and execution-window billing stay on canonical persisted service-period selections, bypass `validateBillingPeriod(...)` for `recurringTimingSelectionSource = "persisted"`, and never call `getClientContractLinesAndCycle(...)` or `getBillingCycle(...)` on the live recurring execution path.
  - This keeps client cadence source rules relevant only before execution, when recurring service periods are materialized; the runtime billing engine now treats the persisted service-period window as the recurring source of truth.
  - Added/updated focused tests:
    - [billingEngine.timing.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/billingEngine.timing.test.ts)
    - [billingEngine.recurringExecution.static.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/billingEngine.recurringExecution.static.test.ts)
- Selector-input window-validation slice completed:
  - Updated [invoiceGeneration.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/invoiceGeneration.ts) so `normalizeRecurringSelectorInput(...)` canonicalizes client-cadence and contract-cadence selector input by looking up persisted `recurring_service_periods`, rejects windows that do not match materialized service periods, and wraps generation-side normalization failures with execution-identity diagnostics.
  - Added focused preview/generate regressions:
    - [invoiceGeneration.preview.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/invoiceGeneration.preview.test.ts)
    - [invoiceGeneration.selectorInputGenerate.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/invoiceGeneration.selectorInputGenerate.test.ts)

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
- Recurring invoice-linkage slice completed:
  - [invoiceService.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/services/invoiceService.ts) now builds recurring linkage candidates from canonical config and invoice-window data, then matches `recurring_service_periods` across explicit `contract_line` and `client_contract_line` obligations without any `invoice.billing_cycle_id` branch.
  - The linkage helper no longer suppresses missing-relation errors as a rollout-era fallback; required recurring linkage relations are now assumed to exist in steady state.
  - Added persistence coverage in [invoiceService.fixedPersistence.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/invoiceService.fixedPersistence.test.ts) for both client-cadence and contract-cadence rows with null `billing_cycle_id`.
  - Added static guards in [recurringInvoiceLinkage.static.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/recurringInvoiceLinkage.static.test.ts) to lock out `billing_cycle_id`-driven widening and mixed-schema fallback logic.
- Invoice-kind classification slice completed:
  - [invoiceModification.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/invoiceModification.ts) now classifies prepayment handling from explicit invoice kind (`is_prepayment`) and negative totals, rather than treating `billing_cycle_id = null` as a proxy.
  - [creditActions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/creditActions.ts) now persists `is_prepayment: true` when creating prepayment invoices so finalization and later reads use the same explicit kind signal.
  - Added behavior and static coverage in [invoiceFinalization.kindClassification.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/invoiceFinalization.kindClassification.test.ts), plus a prepayment persistence assertion in [prepaymentInvoice.periodPolicy.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/server/src/test/unit/billing/prepaymentInvoice.periodPolicy.test.ts).

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
- (2026-03-18) Shared recurring identity types now drop bridge-only `billingCycleId` and `hasBillingCycleBridge` fields, but read-side invoice history types still legitimately expose `billing_cycle_window` and bridge metadata for historical context.
- (2026-03-18) `generateInvoiceHandler` and `scheduleRecurringWindowInvoiceGeneration` are now selector-input-only. The old `scheduleInvoiceGeneration(...)` helper is left as an explicit hard failure if something still tries to schedule recurring work from a raw `billingCycleId`.
- (2026-03-18) DB-backed verification for `billingInvoiceTiming.integration.test.ts` could not run locally because PostgreSQL was unavailable on `127.0.0.1:5438` / `::1:5438`. The targeted tests were skipped before any test body executed.
- (2026-03-18) Recurring preview/generation diagnostics now emit only `executionIdentityKey` for live recurring failures. `billingCycleId` still exists as passive persistence or read-side metadata, but it is no longer part of the recurring preview/generate error contract.
- (2026-03-18) Invoice API list/detail contracts now distinguish client recurring invoices as `client_cadence_window`, not `billing_cycle_window`. `billing_cycle_id` remains available on invoice DTOs only as optional historical metadata or explicit include-side context, not as the recurring classifier.
- (2026-03-18) `recurring_projection` was dead compatibility metadata in the clean runtime paths. Canonical recurring reads now key directly off `recurring_detail_periods`; only the already-dirty `billingInvoiceTiming.integration.test.ts` still references the removed field and was intentionally left untouched until that file is clean.
- (2026-03-18) Live recurring history now loads through `getRecurringInvoiceHistoryPaginated(...)` and labels the surface as recurring invoice history, not invoiced billing cycles. A deprecated `getInvoicedBillingCyclesPaginated(...)` alias remains only so the already-dirty `billingInvoiceTiming.integration.test.ts` harness can be cleaned up separately without mixing in its unrelated edits.
- (2026-03-18) `invoiceService.ts` no longer uses `invoice.billing_cycle_id` to choose recurring linkage candidates. The next remaining bridge-like misclassification seam is still in [invoiceModification.ts](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/packages/billing/src/actions/invoiceModification.ts), where null/non-null `billing_cycle_id` is still used for prepayment logic (`F046`/`F047`).
- (2026-03-18) `invoiceModification.ts` now classifies prepayment behavior from `is_prepayment`, and `creditActions.ts` now persists that flag for new prepayment invoices. Historical rows that predate the explicit flag may still need later read-side or backfill consideration if they relied on the old null-bridge proxy.

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
- `cd server && pnpm exec vitest run src/test/unit/billing/recurringIdentityTypes.static.test.ts src/test/unit/billing/recurringTiming.domain.test.ts src/test/unit/billing/recurringServicePeriodDueSelection.domain.test.ts src/test/unit/billing/recurringDueWork.domain.test.ts src/test/unit/billing/recurringDueWorkReader.integration.test.ts src/test/unit/billing/contractPurchaseOrderSupport.ui.test.tsx src/test/unit/jobs/generateInvoiceHandler.recurringExecutionIdentity.test.ts src/test/unit/billing/invoiceGeneration.recurringSelection.test.ts src/test/unit/billing/automaticInvoices.recurringDueWork.ui.test.tsx --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/integration/billingInvoiceTiming.integration.test.ts -t "T321|T322/T328" --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/invoiceGeneration.selectorInputGenerate.test.ts src/test/unit/billing/invoiceGeneration.preview.test.ts src/test/unit/billing/invoiceGeneration.duplicate.test.ts src/test/unit/billing/invoiceGeneration.duplicate.static.test.ts src/test/unit/billing/invoiceGeneration.zeroDollarFinalization.test.ts src/test/unit/billing/invoiceGeneration.emptyResult.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/api/invoiceRecurringList.contract.test.ts src/test/unit/api/invoiceRecurringSelectorInput.schema.test.ts src/test/unit/api/invoiceService.recurringSelectorInput.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/api/invoiceService.recurringDetailProjection.test.ts src/test/unit/api/invoiceResponseSchema.compatibility.test.ts src/test/unit/billing/invoiceModel.servicePeriods.test.ts src/test/unit/billing/invoiceQueries.recurringDetailRead.test.ts src/test/unit/billing/manualInvoiceActions.viewing.test.ts src/test/unit/api/invoiceService.deleteRecurringDetailGuard.test.ts src/test/unit/invoiceWorkflowEvents.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/automaticInvoices.recurringDueWork.ui.test.tsx --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/integration/api/invoiceService.recurringCoexistence.integration.test.ts src/test/integration/accounting/invoiceSelection.integration.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/automaticInvoices.recurringDueWork.ui.test.tsx src/test/unit/billing/contractPurchaseOrderSupport.ui.test.tsx src/test/unit/billing/recurringInvoiceHistory.static.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/invoiceService.fixedPersistence.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/recurringInvoiceLinkage.static.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/invoiceFinalization.kindClassification.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/prepaymentInvoice.periodPolicy.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/billingEngine.timing.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/billingEngine.recurringExecution.static.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/invoiceGeneration.preview.test.ts --coverage.enabled=false`
- `cd server && pnpm exec vitest run src/test/unit/billing/invoiceGeneration.selectorInputGenerate.test.ts --coverage.enabled=false`

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
- (2026-03-18) F028/F029 implemented by removing bridge-only `billingCycleId` and `hasBillingCycleBridge` fields from shared recurring identity interfaces, dropping shared `billing_cycle_window` builders, converting shared client due-work builders to canonical schedule/period selector input, and updating recurring jobs to require canonical selector-input payloads.
- (2026-03-18) T009 implemented with a static contract test for the shared recurring type file plus domain/UI/job coverage proving client-cadence and contract-cadence shared builders still work after the bridge fields were removed.
- (2026-03-18) F030 implemented by removing `billingCycleId` from recurring preview/generation error payloads and duplicate errors so live recurring diagnostics key only on canonical `executionIdentityKey`.
- (2026-03-18) F031/F032/F033/F034 implemented by renaming client recurring invoice DTO execution-window kind to `client_cadence_window`, keeping `billing_cycle_id` only as optional metadata, and cutting `InvoiceService` list/detail projection plus filter classification over to canonical recurring summary data without any `invoices.billing_cycle_id` fallback.
- (2026-03-18) F035/F036 implemented by removing `recurring_projection` from invoice charge types, schema contracts, invoice model hydration, and workflow-event provenance so canonical recurring detail reads depend only on `recurring_detail_periods` plus summary parent period fields.
- (2026-03-18) T010 implemented with a UI regression proving `AutomaticInvoices` can render, preview, and generate a client-cadence row whose `billingCycleId` metadata is null while still sending canonical selector-input targets.
- (2026-03-18) F037/F038 implemented by renaming the live recurring history reader to `getRecurringInvoiceHistoryPaginated(...)`, removing the remaining billing-cycle cadence fallback from the history query, and updating `AutomaticInvoices` copy from billing-cycle framing to recurring-invoice-history framing.
- (2026-03-18) T011/T035/T036/T037 implemented with ready-row UI coverage for an unbridged contract-cadence row, recurring-history UI coverage for row actions and service-period/execution-window copy, and a static guard that the live history surface no longer imports or labels itself as invoiced billing cycles.
- (2026-03-18) F039/F040/F041 implemented by making recurring reverse/delete wrappers delete the invoice first through `hardDeleteInvoice(...)` for both bridged and unbridged rows, then apply any optional billing-cycle metadata cleanup afterward. Canonical recurring service-period linkage repair remains the primary delete path via `releaseRecurringServicePeriodInvoiceLinkageForInvoice(...)`.
- (2026-03-18) T012/T013 implemented by extending the existing client-cadence `AutomaticInvoices` UI regression so the same proof covers both preview and generate actions submitting canonical selector input with no `billing_cycle_id`.
- (2026-03-18) F042/F043/F044/F045 implemented by making `invoiceService.ts` derive recurring linkage candidates from canonical config/window identity, matching both `contract_line` and `client_contract_line` obligations without consulting `invoice.billing_cycle_id`, and deleting the mixed-schema missing-relation fallback guard from recurring linkage persistence.
- (2026-03-18) T031/T032 implemented with static source guards proving recurring invoice linkage no longer widens or narrows from `invoice.billing_cycle_id` and no longer suppresses missing-relation fallback errors.
- (2026-03-18) F046/F047/F048 implemented by classifying invoice finalization behavior from explicit `is_prepayment` plus negative totals, persisting `is_prepayment: true` on prepayment creation, and proving bridge-less recurring invoices with null `billing_cycle_id` no longer get routed through prepayment credit logic.
- (2026-03-18) T048 implemented with a static source guard proving invoice finalization no longer keys recurring or prepayment classification from null/non-null `billing_cycle_id`.
- (2026-03-18) F049/F050/F051 implemented by making persisted recurring execution-window billing bypass cycle validation, loading contract lines directly for the execution window, and preventing selector-input recurring runs from auto-loading or auto-creating `client_billing_cycles` during live execution.
- (2026-03-18) T051 implemented with static and unit coverage proving the billing engine’s persisted recurring path no longer routes through `getClientContractLinesAndCycle(...)`, `validateBillingPeriod(...)`, or `getBillingCycle(...)` to execute recurring work.
- (2026-03-18) Added T089 because the original checklist lacked a focused validation test for direct selector-input windows drifting away from persisted recurring service periods; preview and generate both now reject that mismatch explicitly.
- (2026-03-18) F052 implemented by normalizing client-cadence and contract-cadence selector input against persisted `recurring_service_periods`, so recurring preview/generate validate canonical service-period windows instead of trusting caller-supplied windows or legacy cycle semantics.
- (2026-03-18) T089 implemented with preview/generate regressions proving selector-input recurring actions reject execution windows that do not match materialized recurring service periods and still surface canonical execution-identity diagnostics.

## Links / References

- Broad architecture:
  - [PRD.md](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-16-service-period-first-billing-and-cadence-ownership/PRD.md)
- Softer cutover plan:
  - [PRD.md](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-18-service-driven-invoicing-cutover/PRD.md)

## Open Questions

- Should there be a later physical schema removal plan for `invoices.billing_cycle_id`, or is passive historical retention enough?
- How much read-side fallback for historically incomplete recurring linkage is acceptable after live recurring compatibility branches are removed?
