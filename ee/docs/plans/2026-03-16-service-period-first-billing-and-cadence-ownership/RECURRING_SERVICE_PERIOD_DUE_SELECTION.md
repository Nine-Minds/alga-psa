# Recurring Service-Period Due Selection

`F242` defines the query contract that later invoice-generation passes will use to read due persisted service-period rows instead of re-deriving recurring schedules in memory.

This is the contract checkpoint, not the runtime cutover checkpoint:

- `F242` defines the selector inputs, eligibility filters, and sort order
- `F256` is still the later pass that makes live invoice generation consume persisted rows end to end

## Query Inputs

The v1 persisted due-selection query is defined by:

- `tenant`
- `executionWindow`
- `cadenceOwner`
- exact `[windowStart, windowEnd)` invoice-window bounds
- a resolved `scheduleKeys[]` scope
- optional charge-family narrowing
- eligible lifecycle states

The important boundary is `scheduleKeys[]`:

- persisted service-period rows do not carry raw `clientId`
- caller-side runtime selection must first resolve which recurring schedules belong to the current client / execution window
- persisted due selection then reads only those schedule keys rather than scanning the whole tenant ledger

## Eligibility Rules

`shared/billingClients/recurringServicePeriodDueSelection.ts` makes the first v1 eligibility rules explicit:

- invoice-window matching is exact on `[start, end)` bounds
- only `generated`, `edited`, and `locked` rows are eligible by default
- `skipped`, `billed`, `superseded`, and `archived` rows are excluded
- rows with existing `invoiceLinkage` are excluded because they are already billed history
- cadence owner must match the execution window being evaluated

## Ordering

Eligible rows are returned in deterministic order:

1. `servicePeriod.start`
2. `servicePeriod.end`
3. `sourceObligation.obligationId`
4. `revision`

That ordering keeps later invoice grouping deterministic before the runtime cutover replaces ad hoc derivation.

## Deliberate Boundary

This checkpoint still does not:

- switch `BillingEngine.selectDueRecurringServicePeriodsForBillingWindow(...)` to the persisted ledger
- define parity comparison between derived schedules and persisted schedules
- define historical backfill for already-billed recurring coverage

Those remain sequenced behind `F243`, `F244`, and `F256`.
