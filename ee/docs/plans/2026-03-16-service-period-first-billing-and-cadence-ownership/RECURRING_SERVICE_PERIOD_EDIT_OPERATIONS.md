# Recurring Service-Period Edit Operations

`F245` defines the minimal v1 edit surface for future persisted service periods before the later continuity, skip/defer, and UI/API passes land.

## Minimal Supported Operation

The first supported v1 edit operation is `boundary_adjustment`.

It means:

- billing staff may explicitly adjust the persisted `servicePeriod` boundary
- the due `invoiceWindow` and optional `activityWindow` may also be adjusted explicitly in the same edit
- the edit creates a new persisted revision instead of mutating the prior row in place

`shared/billingClients/editRecurringServicePeriodBoundaries.ts` is the v1 helper for this operation.

## Revision And Provenance Rule

A successful boundary adjustment:

- requires the normal `edit_boundaries` mutation permission
- supersedes the prior row by setting the older record to `lifecycleState = superseded`
- creates a new row with `lifecycleState = edited`
- stamps `provenance.kind = user_edited`
- stamps `provenance.reasonCode` as one of:
  - `boundary_adjustment`
  - `invoice_window_adjustment`
  - `activity_window_adjustment`

This keeps the user action explicit in the ledger rather than silently changing the generated schedule draft.

## Minimal Local Validation

`F245` is intentionally narrower than the later continuity pass.

The first helper validates only local record integrity:

- `servicePeriod` and `invoiceWindow` must remain valid half-open ranges
- `activityWindow`, when present, must also remain half-open and stay within the edited service period
- the edit must change at least one persisted boundary
- billed or locked rows remain non-editable in place under the existing immutability rule

## Deliberate Boundary

This checkpoint still does not define:

- gap / overlap / neighbor continuity validation across adjacent periods
- skip or defer operations
- split or merge support
- UI or API transport surfaces for editing

Those remain sequenced behind `F246-F251`.
