# Service-Period-First Billing Runbook

## Purpose

Use this runbook during staged rollout of service-period-first recurring billing. It is for two audiences:

- operators validating parity or investigating live invoice behavior
- developers reproducing mixed-cadence or canonical-service-period issues locally

This runbook assumes the current rollout posture from the plan artifacts:

- client cadence is the only supported live write path until contract cadence is explicitly enabled
- comparison mode is additive and must not change persisted invoice outputs
- canonical recurring detail periods are authoritative for migrated recurring fixed, product, and license charges

## Parity Checks

### Source validation

Run these checks before rollout changes or after a cleanup branch lands:

```bash
npx vitest run src/test/unit/billing/billingEngine.cleanupSource.test.ts --coverage.enabled false
npx vitest run src/test/unit/docs/servicePeriodFirstBillingPlan.contract.test.ts --coverage.enabled false
```

What this proves:

- migrated recurring execution no longer depends on `resolveServicePeriod`
- duplicated recurring proration helpers are gone from live fixed, product, and license timing paths
- plan appendix and source inventory still match the repo

### DB-backed sanity validation

Use the Docker Postgres listener on `127.0.0.1:57433` when reproducing locally:

```bash
DB_PORT=57433 npx vitest run src/test/integration/billingInvoiceTiming.integration.test.ts -t "T171|T172|T173|T174" --coverage.enabled false
```

What this proves:

- monthly and quarterly fixed recurring invoices still generate on canonical service periods
- recurring product and recurring license invoices persist canonical `invoice_charge_details`
- the live `generateInvoice(...)` path still works after the cutover for all migrated recurring families

### Comparison mode

Use comparison mode when you want drift signals without changing persisted outputs:

```bash
RECURRING_BILLING_COMPARISON_MODE=legacy-vs-canonical npx vitest run src/test/unit/billing/invoiceGeneration.recurringSelection.test.ts --coverage.enabled false
```

Operational expectation:

- canonical billing remains the returned and persisted result
- legacy billing runs only as a comparison snapshot
- drift logging is a rollout signal, not a second invoice-generation path

## Mixed-Cadence Troubleshooting

### Quick diagnosis

When a user asks why mixed cadence lines grouped or split the way they did, check these in order:

1. confirm `contract_lines.cadence_owner`
2. confirm `billing_timing`
3. identify the invoice window used by the run
4. identify the canonical due service period for the line
5. for contract cadence, identify the contract-owned due invoice window

If two lines land on the same `[start, end)` invoice window, cadence owner alone does not force a split.

If their due windows differ, they must not be grouped into one invoice candidate.

### Useful local inspection queries

```sql
select contract_line_id, cadence_owner, billing_frequency, billing_timing
from contract_lines
where tenant = :tenant
order by contract_line_id;

select billing_cycle_id, client_id, period_start_date, period_end_date, billing_cycle
from client_billing_cycles
where tenant = :tenant and client_id = :client_id
order by period_start_date;

select item_id, service_id, config_id, service_period_start, service_period_end, billing_timing
from invoice_charge_details
where tenant = :tenant and item_id in (
  select item_id from invoice_charges where invoice_id = :invoice_id and tenant = :tenant
)
order by service_period_start, service_id;
```

### Symptoms and likely causes

- recurring line missing from invoice:
  due service period did not map to the active invoice window, or coverage intersected to zero
- contract-cadence line billed on client-cycle date:
  check whether the line was written before contract cadence enablement or whether `cadence_owner` was normalized back to `client`
- recurring product or license detail row missing:
  check that the emitted charge carried `config_id`, `servicePeriodStart`, and `servicePeriodEnd`
- duplicate recurring invoice blocked:
  verify billed-through and duplicate checks against canonical recurring service periods, not invoice headers alone

## Cadence-Owner Dispute Investigation

Use this when support, billing, or finance asks why a recurring line followed the client schedule versus the contract anniversary.

### Investigation order

1. identify the disputed `contract_line_id`
2. confirm the stored `cadence_owner`, `billing_frequency`, and `billing_timing`
3. confirm whether the line was authored before contract cadence enablement or normalized during rollout
4. compare the active client billing window to the contract-owned due invoice window
5. inspect the resulting `invoice_charge_details` row that was persisted for the disputed invoice line

### Operator questions to answer explicitly

- was the line stored as `client` cadence or `contract` cadence when the invoice was generated?
- if it was `contract`, did the contract-owned due invoice window exactly match the active run window?
- if it was `client`, was the line normalized back to `client` cadence because mixed cadence remained staged?

### Useful cadence-owner query

```sql
select
  cl.contract_line_id,
  cl.cadence_owner,
  cl.billing_frequency,
  cl.billing_timing,
  cl.start_date,
  cl.end_date,
  ic.invoice_id,
  icd.service_period_start,
  icd.service_period_end
from contract_lines cl
left join invoice_charges ic
  on ic.client_contract_line_id = cl.contract_line_id
 and ic.tenant = cl.tenant
left join invoice_charge_details icd
  on icd.item_id = ic.item_id
 and icd.tenant = ic.tenant
where cl.tenant = :tenant
  and cl.contract_line_id = :contract_line_id
order by icd.service_period_start nulls last, ic.invoice_id;
```

## Service-Period Mismatch Investigation

Use this when invoice header dates, portal views, exports, or support summaries appear to disagree with canonical recurring detail periods.

### Investigation order

1. inspect `invoices.billing_period_start` and `invoices.billing_period_end`
2. inspect the canonical recurring `invoice_charge_details.service_period_start` and `service_period_end`
3. confirm whether the invoice is historical/manual or detail-backed recurring
4. confirm whether the reader is supposed to use header grouping dates or canonical recurring detail dates
5. compare the consumer output against the documented flattening or fallback rule

### Expected interpretation

- invoice headers remain the invoice-window grouping dates
- canonical recurring detail rows remain the authoritative recurring coverage dates for migrated recurring lines
- historical or manual rows may still fall back to header or financial dates where canonical detail periods do not exist

### Useful mismatch query

```sql
select
  i.invoice_id,
  i.billing_period_start,
  i.billing_period_end,
  ic.item_id,
  ic.description,
  ic.client_contract_line_id,
  icd.service_period_start,
  icd.service_period_end,
  icd.billing_timing
from invoices i
join invoice_charges ic
  on ic.invoice_id = i.invoice_id
 and ic.tenant = i.tenant
left join invoice_charge_details icd
  on icd.item_id = ic.item_id
 and icd.tenant = ic.tenant
where i.tenant = :tenant
  and i.invoice_id = :invoice_id
order by ic.item_id, icd.service_period_start nulls first;
```

If the header window is correct but the detail period is wrong, investigate recurring timing selection and persistence.

If the detail period is correct but the consumer output is wrong, investigate reader hydration, flattening, or export adapter logic.

## Rollback Posture

Rollback means stopping rollout exposure, not undoing schema or canonical detail persistence blindly.

### Safe rollback steps

1. disable `RECURRING_BILLING_COMPARISON_MODE` if it is enabled outside test runs
2. keep contract cadence blocked on live write paths
3. keep client cadence as the only supported authoring mode
4. rerun source and DB-backed sanity checks
5. investigate drift or persistence mismatches before re-enabling rollout steps

### What not to do

- do not delete canonical `invoice_charge_details` rows from already-generated invoices
- do not revert `cadence_owner` defaults on existing rows
- do not force `billing_cycle_alignment` back into live execution to paper over canonical timing drift

### Escalate when

- DB-backed sanity checks fail on fixed recurring as well as product/license
- mixed-cadence lines appear to require a scheduler identity that the current `billingCycleId` run path cannot represent
- invoice readers disagree about header periods versus canonical detail periods for the same recurring line
