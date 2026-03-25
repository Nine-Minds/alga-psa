# Recurring Service-Period Coexistence

`F260` defines how tenants coexist with historical invoices that were created before persisted service periods existed while future schedules and post-cutover invoices use the new ledger.

## Historical Versus Future Boundary

The coexistence rule is explicit:

- historical invoices may have no persisted recurring service-period records
- future recurring schedules may still materialize persisted periods for the same tenant
- the system does not backfill historical invoices into synthetic persisted future-period rows just to make the ledger look uniform

This keeps migration additive instead of rewriting billed history.

## Reader Behavior During Coexistence

Readers must continue to distinguish:

- canonical recurring detail periods when they exist
- historical invoice-header or flat-row fallback timing when canonical detail periods do not exist
- future persisted schedule rows that have not yet produced an invoice

That lets support and finance inspect future billing intent without pretending older invoices were produced from the same persistence model.

## Migration And Regeneration Rule

During coexistence:

- backfill/materialization starts from the future billed-history boundary, not from the tenant’s entire invoice history
- regeneration affects only eligible future periods
- historical invoice reads stay on the earlier dual-shape compatibility contract

The future ledger and the historical invoice reader therefore move together without requiring retroactive invoice mutation.

## Deliberate Boundary

This checkpoint still does not define:

- historical invoice backfill into persisted service-period records
- one-shot schema-version collapse that removes dual-shape invoice support
- archival policy for long-lived tenants with both historical flat invoices and large future ledgers

Those remain sequenced behind `F267-F270`.
