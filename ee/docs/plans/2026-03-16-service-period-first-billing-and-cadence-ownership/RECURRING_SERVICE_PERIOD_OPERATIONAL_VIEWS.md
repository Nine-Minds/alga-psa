# Recurring Service-Period Operational Views

`F257` defines the first shared operational-view contract for billing staff to inspect upcoming materialized service periods before invoice generation.

## Shared View Contract

The shared operational-view layer now lives in:

- `packages/types/src/interfaces/recurringTiming.interfaces.ts` as `IRecurringServicePeriodOperationalView`, `IRecurringServicePeriodOperationalViewSummary`, and `IRecurringServicePeriodOperationalViewRow`
- `shared/billingClients/recurringServicePeriodOperationalView.ts` as `buildRecurringServicePeriodOperationalView(...)`

The operational view composes the earlier shared seams instead of inventing a new selector:

- future-row filtering still comes from `IRecurringServicePeriodListingQuery`
- lifecycle badges and reason labels still come from `IRecurringServicePeriodDisplayState`

## Required Upcoming Rows

Every operational row carries the minimum fields billing staff need before invoice generation:

- source obligation reference
- charge family
- cadence owner
- due position
- service-period boundaries
- invoice-window boundaries
- optional activity-window clipping
- revision
- display-state label, tone, detail, and optional reason label

That keeps inspection tied to explicit future billing intent instead of invoice-header heuristics.

## Default Operational Summary

The first shared summary counts:

- `totalRows`
- `exceptionRows`
- `generatedRows`
- `editedRows`
- `skippedRows`
- `lockedRows`

`exceptionRows` intentionally highlights rows in `edited`, `skipped`, or `locked` state so dashboard and operational readers can focus on future periods that differ from untouched generated cadence.

## Default Inspection Scope

The operational view intentionally builds on the future-listing scope from `F250`:

- upcoming rows only
- billed, superseded, and archived history excluded by default
- deterministic chronological ordering from the listing helper

That means billing staff can inspect future materialized periods independently of invoice generation without pulling billed history into the default queue.

## Deliberate Boundary

This checkpoint still does not define:

- concrete React layouts, table components, or route wiring
- billed-history audit views or archive screens
- edit action wiring, mutation permissions, or actor identity rendering on the rows
- client-facing portal explanations for future periods

Those remain sequenced behind `F258-F266`.
