# Scratchpad: accounting export Fixed-line service periods

Ticket: alga-2026-0003366.

## Root cause (verified at origin/main 18a1df19f6, 2026-11-19)

- Selector `packages/billing/src/services/accountingExportInvoiceSelector.ts` ~L285-312: `recurringDetailPeriodsByKey` Map keyed `${start}|${end}|${billingTiming}`, so the payload holds distinct periods.
- Validator `packages/billing/src/services/accountingExportValidation.ts` ~L240: `canonicalPeriodsByChargeId` pushes every `invoice_charge_details` row, with no dedupe.
- Comparison: `areRecurringPeriodsEqual` (~L784) checks length first, then the pairwise start/end/timing.
- Error emitted ~L497, code `service_period_projection_mismatch`.
- `canonicalPeriodsByChargeId` is keyed by the parent charge id. `expandAccountingExportCharges` (accountingExportChargeExpansion.ts) splits fixed-plan parents into per-service lines that keep the parent's identity and payload, so each child line is compared with the parent's N-row list.
- One service on a Fixed line passes (1 = 1). Two or more services sharing a period always fails.

## Decisions

- Fix by giving the projection one definition used by both seams (not by adding a dedupe inline in the validator): the selector and the validator disagreeing is the defect class.
- Deduplicated is the correct semantics for export: an export line represents the charge, and its period set is the set of distinct periods covered.
- Invoice model (`packages/billing/src/models/invoice.ts` `attachCanonicalRecurringDetailPeriods`) is a third copy without dedupe. Left alone because it changes API and template output. Marker only.

## Recovery of existing stuck batches

- `ensureMappingsForBatch` resolves prior open errors at the start of each run ("Clear prior unresolved validation errors..."), and `executeReservedBatch` revalidates. Stored payloads are already deduplicated, so the same batch passes once the fix is deployed. No data repair.

## Tests to extend

- `server/src/test/unit/accounting/accountingExportValidation.servicePeriodProjection.test.ts` (mocked-query pattern, T270)
- `server/src/test/unit/accounting/accountingExportInvoiceSelector.servicePeriods.test.ts`
- `server/src/test/integration/accounting/invoiceSelection.integration.test.ts`, `validationUnmapped.integration.test.ts` (DB-backed patterns)
