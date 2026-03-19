# Recurring Invoicing Hard Cutover Architecture Notes

## Final Invariant

Recurring invoice execution identity is canonical service-period or execution-window identity only.

In steady state:

1. cadence ownership and source rules generate persisted `recurring_service_periods`
2. ready recurring work is read only from persisted `recurring_service_periods`
3. preview, generate, run, history, reverse, and delete flows identify recurring work by canonical execution-window or service-period identity
4. `billing_cycle_id` is never required to discover recurring work, prevent duplicates, explain recurring history, or repair recurring invoice linkage

## Canonical Runtime Model

The hard cutover keeps a single recurring model in application code:

- `recurring_service_periods` is the recurring ledger and the only ready-work substrate
- recurring due rows, run targets, and retry identity are derived from canonical schedule or service-period identity
- missing materialization is an explicit repairable failure, not a compatibility invoice row
- history and reversal operate on invoice-linked recurring service-period records, not billing-cycle handles

## Retained Role Of `client_billing_cycles`

`client_billing_cycles` remain valid product data, but only in these roles:

- client cadence administration and anchor management
- source-rule input when `cadence_owner = client`
- optional historical or read-side context when an older invoice still carries bridge metadata

`client_billing_cycles` do not remain valid in these roles:

- recurring due-work substrate
- recurring execution identity
- duplicate-prevention key for recurring invoices
- primary object for recurring history, reverse, delete, preview, or generate operations

## Required Schema Posture

The hard cutover treats recurring-service-period storage as required schema, not rollout-era optional schema.

- recurring invoice paths must assume `recurring_service_periods` and related linkage structures exist
- missing service-period rows are diagnosed as data repair work
- code must not catch missing table or missing column errors to rebuild recurring work from `client_billing_cycles`

## `invoices.billing_cycle_id` Deprecation Posture

The current deprecation posture is:

- `invoices.billing_cycle_id` may remain physically present for now
- it is passive historical or client-context metadata only
- no live recurring path may use it to decide what recurring work exists, whether it is duplicate, how it is previewed or generated, or how recurring linkage is repaired
- later physical removal can happen after historical read-side cleanup is complete, but live recurring code must already behave as though the bridge is gone

## Anti-Regression Rules

Future recurring changes should preserve these boundaries:

- shared recurring execution contracts do not require `billingCycleId`
- recurring UI copy talks about service periods or execution windows, not invoiced billing cycles
- exports and invoice reads derive recurring semantics from canonical recurring detail and service-period data
- tests should prove client-cadence and contract-cadence recurring work remain operable without a billing-cycle bridge
