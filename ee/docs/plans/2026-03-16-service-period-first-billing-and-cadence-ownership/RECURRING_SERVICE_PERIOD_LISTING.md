# Recurring Service-Period Listing

`F250` defines the first listing query contract for future persisted service periods that is independent from due selection and invoice generation.

## Listing Query

The shared query contract now lives in:

- `packages/types/src/interfaces/recurringTiming.interfaces.ts` as `IRecurringServicePeriodListingQuery`
- `shared/billingClients/recurringServicePeriodListing.ts` as the first in-memory listing helper

The query carries:

- `tenant`
- `asOf`
- optional `scheduleKeys[]`
- optional `cadenceOwner`
- optional `duePosition`
- lifecycle-state scope
- optional charge-family narrowing

## Default Listing Scope

The default future-listing lifecycle states are:

- `generated`
- `edited`
- `skipped`
- `locked`

The default listing helper intentionally excludes:

- billed history
- superseded rows
- archived rows

and filters to rows whose `servicePeriod.end > asOf`.

That keeps listing separate from due selection:

- billing staff can inspect future intent even when a row is skipped or not currently due
- invoice generation remains a later selector path with its own execution-window rules

## Deliberate Boundary

This checkpoint still does not define:

- API controllers or dashboard screens that call the listing query
- edit workflows on top of the listing results
- audit/history views that include billed, superseded, or archived rows by default

Those remain sequenced behind `F251-F257`.
