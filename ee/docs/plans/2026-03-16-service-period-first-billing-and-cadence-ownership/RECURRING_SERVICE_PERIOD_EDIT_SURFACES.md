# Recurring Service-Period Edit Surfaces

`F251` defines the first shared UI/API transport surface for editing future persisted service periods with explicit provenance and validation feedback.

## Request Contract

The shared request contract now lives in:

- `packages/types/src/interfaces/recurringTiming.interfaces.ts` as `IRecurringServicePeriodEditRequest`
- `shared/billingClients/recurringServicePeriodEditRequests.ts` as `applyRecurringServicePeriodEditRequest(...)`

The v1 request envelope carries:

- `operation = boundary_adjustment | skip | defer`
- `recordId`
- `editedAt`
- `sourceRuleVersion`
- optional `sourceRunKey`
- optional sibling schedule rows for continuity validation feedback

Operation-specific request fields remain narrow:

- `boundary_adjustment` may carry `updatedServicePeriod`, `updatedInvoiceWindow`, and `updatedActivityWindow`
- `skip` needs only the target `recordId`
- `defer` must carry `deferredInvoiceWindow`

This keeps the transport surface aligned with the already-supported v1 edit operations instead of implying split, merge, or repair capabilities that are still deferred.

## Success Response

A successful edit response returns:

- `ok = true`
- the `supersededRecord`
- the new `editedRecord`
- explicit `provenance`
- `validationIssues = []`

That makes provenance transport explicit for later controllers and dashboard flows: callers do not need to infer whether a boundary edit, skip, or defer happened by diffing rows after the fact.

## Validation Feedback

Validation failures are returned as structured `validationIssues[]` instead of raw thrown strings.

The first v1 issue codes are:

- `record_mismatch`
- `immutable_record`
- `no_changes`
- `invalid_service_period_range`
- `invalid_invoice_window_range`
- `invalid_activity_window_range`
- `missing_deferred_invoice_window`
- `invalid_deferred_invoice_window`
- `unchanged_deferred_invoice_window`
- `continuity_gap_before`
- `continuity_overlap_before`
- `continuity_gap_after`
- `continuity_overlap_after`
- `unknown_validation_error`

Each issue carries:

- `code`
- `field`
- `message`

That gives later API controllers and dashboard forms one stable surface for inline validation copy without changing the underlying edit primitives yet.

## Deliberate Boundary

This checkpoint still does not define:

- permission or audit-policy transport beyond the existing mutation guard
- repository/controller wiring for loading `recordId` targets from the database
- repair, regeneration, or administrative edit flows

Those remain sequenced behind `F253-F259`.
