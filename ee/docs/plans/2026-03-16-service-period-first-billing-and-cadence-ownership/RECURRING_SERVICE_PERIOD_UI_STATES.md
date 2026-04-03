# Recurring Service-Period UI States

`F252` defines the first shared UI-affordance contract for future persisted service periods so dashboard and operational views do not invent lifecycle labels independently.

## State Affordance Contract

The shared presentation helper now lives in:

- `packages/types/src/interfaces/recurringTiming.interfaces.ts` as `IRecurringServicePeriodDisplayState`
- `shared/billingClients/recurringServicePeriodDisplayState.ts` as `getRecurringServicePeriodDisplayState(...)`

The helper returns:

- `lifecycleState`
- `label`
- `tone`
- `detail`
- optional `reasonLabel`

That gives later dashboard rows, badges, and drilldowns one stable display contract even before a concrete screen lands.

## Required Distinctions

The v1 UI state contract explicitly differentiates:

- `generated` -> `Generated`
- `edited` -> `Edited`
- `skipped` -> `Skipped`
- `locked` -> `Locked`
- `billed` -> `Billed`
- `superseded` -> `Superseded`

`archived` is also defined for completeness, but ordinary future-ledger views are not expected to show it by default.

## Tone And Detail Guidance

The first tone mapping is intentionally simple:

- `generated` uses `neutral`
- `edited` uses `accent`
- `skipped` and `locked` use `warning`
- `billed` uses `success`
- `superseded` and `archived` use `muted`

The detail copy explains what the state means operationally:

- generated rows still follow current cadence rules
- edited rows are active overrides
- skipped rows are intentionally excluded from due selection
- locked rows are frozen for ordinary edits
- billed rows point at billed history and can mention invoice linkage
- superseded rows remain audit history after a newer revision replaces them

`reasonLabel` is additive and comes from provenance. For example:

- `defer` -> `Deferred to a later invoice window`
- `skip` -> `Skipped by billing staff`
- `boundary_adjustment` -> `Boundary adjusted`

## Deliberate Boundary

This checkpoint still does not define:

- role-based visibility or action permissions for those states
- audit-log policy for when state badges must expose actor identity
- concrete dashboard layouts or filtering UX for upcoming periods
- history-heavy archive views that surface `archived` rows by default

Those remain sequenced behind `F253-F259`.
