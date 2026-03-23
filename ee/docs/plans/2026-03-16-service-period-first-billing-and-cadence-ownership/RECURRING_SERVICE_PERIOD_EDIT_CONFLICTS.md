# Recurring Service-Period Edit Conflicts

`F249` defines the first explicit conflict surface between preserved user edits and later source-rule regeneration.

## Conflict Rule

When regeneration encounters a preserved user-edited override, it must not silently overwrite the row and it must not silently discard the conflict either.

`shared/billingClients/regenerateRecurringServicePeriods.ts` now surfaces explicit conflict records while still preserving the edited row.

## Conflict Kinds

The first v1 conflict kinds are:

- `missing_candidate`
- `service_period_mismatch`
- `invoice_window_mismatch`
- `activity_window_mismatch`

These conflicts mean:

- no current regenerated candidate still maps to the preserved override slot
- or the regenerated candidate now disagrees with the preserved override on canonical service-period or due-window boundaries

## Current Handling

The v1 handling rule is conservative:

- preserved user edits remain active
- conflicting source candidates are not allowed to overwrite them
- regeneration surfaces the conflict record so later UI/API or operator tooling can explain why the override now diverges from source rules

This makes the disagreement explicit instead of leaving it as silent candidate discard.

## Deliberate Boundary

This checkpoint still does not define:

- operator-facing repair UI
- automatic merge rules between source changes and user edits
- bulk conflict resolution across many schedules

Those remain sequenced behind `F250-F259`.
