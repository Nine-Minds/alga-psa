# PRD: Accounting export accepts Fixed contract lines with several services

- Slug: `accounting-export-fixed-line-service-periods`
- Date: `2026-11-19`
- Status: Ready
- Ticket: alga-2026-0003366

## Summary

Accounting export validation rejects every invoice charge from a Fixed contract line with two or more services that share a service period. The batch stops in `needs_attention` with `service_period_projection_mismatch` ("Export line service periods do not match canonical invoice charge details") and never reaches QuickBooks Online, QuickBooks CSV/Desktop or Xero. The export selector and the validator each derive a charge's "canonical recurring detail periods" from `invoice_charge_details`, and they derive them differently. Give that projection one definition and have both seams use it.

## Problem

A Fixed contract line bills as one parent `invoice_charges` row with one `invoice_charge_details` row per service. Every service on the line normally covers the same period with the same billing timing.

- `accountingExportInvoiceSelector.ts` (~L285-312) builds the line payload's `recurring_detail_periods` keyed by `start|end|billing_timing`, so it holds each distinct period once. Two services covering March give one period.
- `accountingExportValidation.ts` (`canonicalPeriodsByChargeId`, ~L240) pushes one period for each detail row. The same two services give two identical periods.
- `areRecurringPeriodsEqual` (~L784) compares the two lists by length first, so the line always fails. Fixed-plan expansion (`accountingExportChargeExpansion.ts`) splits the parent into one export line per service, and every child line is checked against the parent's un-deduplicated list, so every child fails.

A Fixed line with one service passes (1 = 1), which is why this has gone unnoticed. Moving the services to another Fixed line does not help, because the bug follows the shape, not the line.

The same projection exists a third time in `packages/billing/src/models/invoice.ts` (`attachCanonicalRecurringDetailPeriods`, no dedupe). The two export copies disagree, and that disagreement is the defect.

## Goals

- One pure function defines a charge's canonical recurring detail periods from its detail rows: drop rows with neither start nor end, normalize dates to calendar dates, keep each distinct (start, end, billing_timing) once, and sort by start then end.
- The export selector and export validation both use it, so the payload and the expectation cannot drift apart again.
- Fixed contract lines with any number of services sharing a period validate and export.
- Validation still reports `service_period_projection_mismatch` for genuine drift (different periods, a different summary start/end, a different source).

## Non-goals

- Changing what the invoice model, the invoice API or invoice rendering return for `recurring_detail_periods` (`invoice.ts` keeps its own, non-deduplicated projection). Moving it onto the shared function changes API output and template data, so it needs its own decision. Leave a `// LEVERAGE: pattern recurring-detail-period-projection` marker there.
- Changing the line payload shape, the error codes or the batch lifecycle.
- Data repair. No stored data is wrong: the stored line payloads are already deduplicated, and only the expectation computed at validation time is wrong.

## Users and Primary Flows

MSP billing admins exporting invoices to an accounting system (scheduled QBO/Xero sync, manual batches on Billing > Accounting Exports, QBO CSV/Desktop files).

1. Invoice a client with a Fixed contract line holding two or more services.
2. Export it, either by a scheduled sync or by creating a batch by hand.
3. Today: the batch stops in `needs_attention` with one `service_period_projection_mismatch` per service line. After the fix: the batch validates `ready` and delivers.

## UX / UI Notes

No UI change. The error stops appearing for this shape.

## Requirements

### Functional Requirements

- Shared projection function, placed beside the accounting export services in `packages/billing/src/services/` (for example `accountingExportServicePeriods.ts`, or inside `accountingExportDateUtils.ts`), with input rows of `{ service_period_start, service_period_end, billing_timing }`.
- The selector builds `recurring_detail_periods` (and the summary start/end derived from it) through the shared function. Its output must stay byte-for-byte the same.
- Validation builds `canonicalPeriodsByChargeId` through the shared function, grouping detail rows by `item_id` first.
- Validation compares a line's payload periods with the same normalization and ordering. `normalizeExportLinePeriods` should reuse the shared normalize/sort, so both sides go through one comparator.

### Non-functional Requirements

- Pure function, no DB access. It is unit-testable in isolation.

## Data / API / Integrations

- Tables read: `invoice_charges`, `invoice_charge_details`, `invoice_charge_fixed_details` (unchanged queries).
- Line payload: `recurring_detail_periods`, `service_period_source`, plus the summary `service_period_start` and `service_period_end` on `accounting_export_lines` (shape unchanged).
- Adapters (QBO online, QBO CSV/Desktop, Xero) are unaffected. They consume the same payload.

## Security / Permissions

None.

## Observability

None beyond the existing per-line error rows.

## Rollout / Migration

- No migration and no flag.
- Batches already stuck in `needs_attention` for this reason recover on retry. `ensureMappingsForBatch` resolves prior open errors before revalidating, execution revalidates, and the stored payloads are already deduplicated. A scheduled sync re-selects invoices once the blocked batch is cancelled.

## Open Questions

- Should the invoice model and API also deduplicate `recurring_detail_periods`? Out of scope here, recorded as a LEVERAGE marker.

## Acceptance Criteria (Definition of Done)

- An invoice whose Fixed contract line has two services covering the same period produces an export batch that validates `ready` (DB-backed test through the real selector and validation).
- A genuine period mismatch on such a line is still reported as `service_period_projection_mismatch`.
- The existing service-period tests (`accountingExportValidation.servicePeriodProjection.test.ts` T270, `accountingExportInvoiceSelector.servicePeriods.test.ts`, the wiring tests) stay green.
