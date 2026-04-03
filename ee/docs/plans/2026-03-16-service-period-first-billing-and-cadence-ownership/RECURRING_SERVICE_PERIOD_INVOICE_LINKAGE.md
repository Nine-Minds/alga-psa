# Recurring Service-Period Invoice Linkage

`F241` defines the first explicit linkage contract between a persisted recurring service-period record and the canonical invoice detail row that billed it.

This checkpoint stays additive:

- it does not yet switch due selection or runtime billing onto persisted rows
- it does not yet define backfill or compare-mode policy for historical billed coverage
- it does define the record shape, storage fields, and lifecycle effect once a billed detail row is known

## Linkage Shape

Persisted records now carry optional `invoiceLinkage` metadata:

- `invoiceId`
- `invoiceChargeId`
- `invoiceChargeDetailId`
- `linkedAt`

Those fields point at the already-authoritative invoice persistence surface:

- `invoice_charges.item_id` remains the parent charge identity
- `invoice_charge_details.item_detail_id` remains the canonical recurring detail identity
- the persisted service-period row stores both ids so billed history can be traced without reconstructing joins from schedule math alone

## Lifecycle Effect

Invoice linkage is the moment a future service-period record becomes billed history.

- a successfully linked record transitions to `lifecycleState = billed`
- unlinked future rows stay in generated / edited / skipped / locked states
- already linked rows may only be changed later through the narrow corrective boundary `invoice_linkage_repair`

`shared/billingClients/recurringServicePeriodInvoiceLinkage.ts` is the v1 helper that applies this transition explicitly and rejects conflicting relinks outside that repair flow.

## Physical Storage

`server/migrations/20260318143000_add_invoice_linkage_to_recurring_service_periods.cjs` adds additive linkage columns on `recurring_service_periods`:

- `invoice_id`
- `invoice_charge_id`
- `invoice_charge_detail_id`
- `invoice_linked_at`

The first integrity rules are:

- linkage columns are all-null or all-present together
- `invoice_charge_detail_id` is unique per tenant across the ledger
- linked rows must already be in `billed` state

## Deliberate Boundary

This checkpoint still does not define:

- the due-selection query contract that reads persisted rows at invoice time
- parity comparison between derived timing and persisted schedules
- billed-history backfill for already-generated historical invoices
- richer repair, replay, or administrative reconciliation flows

Those remain sequenced behind `F242-F244`.
