# Recurring Invoicing Hard Cutover Runbook

## Purpose

Use this runbook after the hard cutover when recurring invoicing is service-period driven only.

It is the operator and developer reference for:

- understanding the final recurring mental model
- diagnosing missing due recurring work without falling back to billing-cycle compatibility rows
- repairing materialization or linkage gaps through canonical recurring service-period data
- validating that history and reversal still line up with canonical recurring linkage

## Final Recurring Mental Model

Recurring invoicing now has one operational model:

1. cadence ownership and source rules generate persisted `recurring_service_periods`
2. due recurring work is the set of due `recurring_service_periods`
3. preview, generate, retry, history, reverse, and delete actions all act on canonical execution-window or service-period identity
4. `client_billing_cycles` remain cadence infrastructure, not recurring due-work rows

Compatibility due-work rows are removed from steady-state recurring execution. If a recurring obligation should be invoiceable and no canonical service-period row exists, treat that as a repairable materialization failure.

## Hard-Cutover Operator Sequence

1. Confirm the affected obligation has persisted `recurring_service_periods` for the expected invoice window.
2. If the row is missing, treat that as materialization repair work instead of looking for a compatibility `client_billing_cycles` row.
3. Validate the due row identity from canonical fields such as `record_id`, `schedule_key`, `period_key`, `invoice_window_start`, and `invoice_window_end`.
4. Run preview or generate flows only from canonical selector input.
5. When reversing or deleting a billed recurring invoice, validate the linked recurring service-period rows reopen or remain correctly linked through canonical invoice linkage.

## Missing Due-Work Diagnosis

### 1. Inspect persisted recurring service periods

```sql
select
  record_id,
  schedule_key,
  period_key,
  cadence_owner,
  lifecycle_state,
  service_period_start,
  service_period_end,
  invoice_window_start,
  invoice_window_end,
  invoice_id,
  invoice_charge_id,
  invoice_charge_detail_id
from recurring_service_periods
where tenant = :tenant
  and client_id = :client_id
order by invoice_window_end desc, service_period_start desc;
```

### 2. Interpret the result

- matching canonical row exists and is due: recurring UI and API should use that row directly
- matching canonical row exists but is billed or locked: validate whether the invoice history or reversal state already explains the absence from due work
- matching canonical row does not exist: missing recurring service-period materialization is a repair state, not a fallback-ready invoice row

### 3. Check source-rule inputs

If the row is missing, confirm:

- cadence owner is correct for the obligation
- client cadence rules still exist when `cadence_owner = client`
- future recurring service periods were regenerated after source-rule changes

## Reverse/Delete Repair Notes

Use canonical recurring linkage when repairing recurring invoice state:

1. capture `record_id`, `schedule_key`, `period_key`, `invoice_id`, and the canonical execution-window identity
2. perform the reverse or delete action
3. confirm `recurring_service_periods.invoice_id`, `invoice_charge_id`, and `invoice_charge_detail_id` reflect the repaired state
4. confirm lifecycle state is reopened or preserved according to the canonical linkage repair flow
5. rerun due-work validation to confirm the same execution window reappears only when it should be invoiceable

Do not treat a `billing_cycle_id` value as the primary repair handle for recurring invoices.

## Validation Checklist

- recurring due-work investigation starts from `recurring_service_periods`
- no operator step expects a compatibility due-work row from `client_billing_cycles`
- client cadence is explained as source-rule infrastructure only
- history and reversal checks are driven by canonical recurring linkage
- `billing_cycle_id` is treated as optional historical context only
