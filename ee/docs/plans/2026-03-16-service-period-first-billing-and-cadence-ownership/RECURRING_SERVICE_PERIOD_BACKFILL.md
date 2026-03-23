# Recurring Service-Period Backfill

`F244` defines the parity-safe initialization rule for tenants that already have recurring invoice history before the persisted service-period ledger exists.

This checkpoint is still additive:

- it initializes future persisted rows for existing recurring obligations
- it does not rewrite historical invoices or synthesize historical persisted rows just to mirror already-billed coverage
- it does define how billed-history boundaries fence off future backfill so the later runtime cutover can start from a clean future ledger

## Historical Boundary

Backfill now resolves one explicit historical cutoff:

- `legacyBilledThroughEnd`
- or, if persisted billed rows already exist, the latest `servicePeriod.end` among `billed` / linked records

`shared/billingClients/backfillRecurringServicePeriods.ts` treats that date as the billed-history boundary.

The rules are:

- candidate periods ending on or before the boundary are skipped
- candidate periods starting on or after the boundary remain eligible for insertion
- a candidate that overlaps the boundary is rejected instead of being silently clipped or split

That overlap rejection is deliberate. Backfill must not invent partial historical rewrites just to make a future ledger fit.

## Initialization Policy

Future candidates are normalized onto explicit backfill provenance:

- `provenance.kind = generated`
- `provenance.reasonCode = backfill_materialization`
- `sourceRuleVersion` and `sourceRunKey` reflect the backfill run, not the earlier materializer placeholder

This keeps initialized rows distinguishable from first-day greenfield materialization while still saying they are untouched generated schedule rows.

## Existing Future Rows

Backfill must also be safe when a tenant already has some persisted future rows from an earlier partial rollout or retry.

The v1 rule is:

- billed historical rows are retained unchanged
- equivalent future rows are retained unchanged
- untouched generated future rows that disagree with the current candidate schedule are regenerated with `reasonCode = backfill_realignment`
- user-edited, repair, locked, and billed rows still follow the existing preservation rules from `RECURRING_SERVICE_PERIOD_REGENERATION.md`

This means backfill can reconcile future schedule drift without mutating billed history or trampling explicit overrides.

## Deliberate Boundary

This checkpoint still does not define:

- invoice-time due selection from persisted rows
- historical persisted-row backfill for already-billed invoices
- UI or API listing/editing surfaces for future persisted periods
- bulk repair tooling for overlap conflicts discovered during backfill

Those remain sequenced behind `F245-F267`.
