# Contract-cadence coverage: audit and post-deploy verification

Companion to [the replenishment plan](2026-09-15-replenish-contract-cadence-service-periods-plan.md).
Every query here is read-only. Nothing in this document has been run against
production; the sections are separated into **proposed** procedures and the
**performed** checks recorded below.

## What "missing" means

A contract-cadence line has a valid obligation up to `min(today, assignment end)`
when its active ledger (lifecycle not `superseded`/`archived`) has a service
period covering every consecutive cadence boundary from the historical floor
forward, and its furthest service-period end reaches the 180-day target. The
historical floor is `max(assignment start, last billed/invoice-linked
service-period end)`; gaps before that floor are history and are not expected to
be recreated.

Two shapes need distinguishing:

- **Accidental gap** — an unbilled hole after the floor and before the
  assignment end. The sweep recovers these on its next successful run.
- **Intentional exclusion** — a period at or before the floor, a `skipped` or
  `deferred` (lifecycle `edited`) row, a locked row, a manual boundary override,
  or a period past the assignment end. These must stay untouched.

## Proposed read-only audit

Run against the Citus coordinator as a read-only transaction. `:target` is the
horizon target date (`today + 180 days`) and `:as_of` is the audit date.

```sql
begin read only;

-- 1. Per contract-cadence obligation: furthest active coverage, obligation
--    window, and whether the line is short of the rolling target.
with active as (
  select
    rsp.tenant,
    rsp.obligation_id,
    min(rsp.service_period_start) as first_start,
    max(rsp.service_period_end)   as furthest_end,
    count(*)                      as active_periods
  from recurring_service_periods rsp
  where rsp.obligation_type = 'contract_line'
    and rsp.cadence_owner = 'contract'
    and rsp.lifecycle_state not in ('superseded', 'archived')
  group by rsp.tenant, rsp.obligation_id
)
select
  a.tenant,
  cl.contract_line_name,
  cc.start_date            as assignment_start,
  cc.end_date              as assignment_end,
  cc.is_active             as assignment_active,
  ct.is_active             as contract_active,
  cl.is_active             as line_active,
  cl.cadence_owner,
  cl.billing_frequency,
  cl.billing_timing,
  a.active_periods,
  a.first_start,
  a.furthest_end,
  (:target)::date          as target_horizon_end,
  (a.furthest_end >= (:target)::date) as meets_target
from active a
join contract_lines cl
  on cl.tenant = a.tenant and cl.contract_line_id = a.obligation_id
join contracts ct
  on ct.tenant = cl.tenant and ct.contract_id = cl.contract_id
join client_contracts cc
  on cc.tenant = cl.tenant and cc.contract_id = cl.contract_id
where cc.is_active
  and cl.is_active
  and ct.is_active
  and (cc.end_date is null or cc.end_date > (:as_of)::date)
order by meets_target, a.furthest_end;

-- 2. Interior gaps (accidental holes after the billed floor). A row appears
--    when the previous active period's end is before the next period's start.
--    `is_intentional` flags gaps whose start is at or before the historical
--    billed floor (do not auto-recover).
with active as (
  select
    rsp.tenant,
    rsp.obligation_id,
    rsp.service_period_start,
    rsp.service_period_end,
    lag(rsp.service_period_end) over (
      partition by rsp.tenant, rsp.obligation_id
      order by rsp.service_period_start
    ) as previous_end
  from recurring_service_periods rsp
  where rsp.obligation_type = 'contract_line'
    and rsp.cadence_owner = 'contract'
    and rsp.lifecycle_state not in ('superseded', 'archived')
),
floor as (
  select
    rsp.tenant,
    rsp.obligation_id,
    max(rsp.service_period_end) as billed_floor_end
  from recurring_service_periods rsp
  where rsp.obligation_type = 'contract_line'
    and rsp.cadence_owner = 'contract'
    and (rsp.lifecycle_state = 'billed' or rsp.invoice_charge_detail_id is not null)
  group by rsp.tenant, rsp.obligation_id
)
select
  a.tenant,
  a.obligation_id,
  a.previous_end,
  a.service_period_start as gap_end,
  (a.service_period_start - a.previous_end) as gap_days,
  coalesce(f.billed_floor_end, date '0001-01-01') as billed_floor_end,
  (a.service_period_start <= coalesce(f.billed_floor_end, date '0001-01-01')) as is_intentional
from active a
left join floor f
  on f.tenant = a.tenant and f.obligation_id = a.obligation_id
where a.previous_end is not null
  and a.service_period_start > a.previous_end
order by is_intentional, a.tenant, a.obligation_id, a.service_period_start;

-- 3. Schedules with no active future row at all (silent exhaustion).
with active as (
  select distinct rsp.tenant, rsp.obligation_id
  from recurring_service_periods rsp
  where rsp.obligation_type = 'contract_line'
    and rsp.cadence_owner = 'contract'
    and rsp.lifecycle_state not in ('superseded', 'archived')
    and rsp.service_period_end >= (:as_of)::date
)
select cl.tenant, cl.contract_line_id, cl.contract_line_name
from contract_lines cl
join contracts ct
  on ct.tenant = cl.tenant and ct.contract_id = cl.contract_id
join client_contracts cc
  on cc.tenant = cl.tenant and cc.contract_id = cl.contract_id
left join active a
  on a.tenant = cl.tenant and a.obligation_id = cl.contract_line_id
where cl.cadence_owner = 'contract'
  and cl.is_active and ct.is_active and cc.is_active
  and (cc.end_date is null or cc.end_date > (:as_of)::date)
  and a.obligation_id is null
order by cl.tenant, cl.contract_line_name;

rollback;
```

Cross-tenant impact is unmeasured. Query 1 is the per-tenant starting point; the
`tenant` column is projected so the result can be grouped before any tenant is
named.

## Proposed post-deploy verification (CloudLab)

1. Run query 1 filtered to the CloudLab tenant/client and confirm the line's
   furthest active service-period end reaches `today + 180 days`.
2. Confirm exactly one active service period covers `2026-08-08` to
   `2026-09-08` with invoice window `2026-09-08` to `2026-10-08`.
3. Confirm the billed periods through `2026-07-08` to `2026-08-08` still carry
   their invoice linkage to invoice `0001850`, and the locked
   `2026-02-08` to `2026-03-08` row is still `locked` with no linkage.
4. Confirm the superseded client-cadence rows (including `2026-08-01` to
   `2026-09-01`) are still `superseded`.
5. Run the replenishment sweep a second time and confirm zero generated periods,
   zero superseded rows, and no change to row count.
6. Open Ready to Bill for the client and confirm the recovered service period is
   listed as due in the `2026-09-08` window.
7. Run query 2 across all tenants and record whether any non-intentional gaps
   remain after the first successful sweep.

## Performed checks

Only the isolated local test database was exercised; no production record was
read or changed.

- `contractCadenceServicePeriodReplenishment.test.ts` (8 tests) reproduces the
  CloudLab state in an isolated test database and asserts the recovered period,
  invoice-window mapping, future horizon, preserved billed/locked/skipped/
  deferred/superseded history, repeat-run idempotency, a later-horizon run with
  no invoices, advance/month-end anchors, eligibility, per-line failure
  isolation with retry, and tenant isolation.
- `contractCadenceServicePeriodReplenishment.concurrency.test.ts` commits the
  fixture on a pool connection and runs two overlapping sweeps, asserting the
  advisory lock serialises them and no period is written twice.
- `materializeContractCadenceServicePeriods.domain.test.ts` covers the
  `coverageAnchorDate` decoupling and the period-cap reporting.
- `regenerateRecurringServicePeriods` gap-aware pairing is covered by the shared
  and server unit suites.

Not performed: any production query in the audit section, any UI check of Ready
to Bill, and any measurement of cross-tenant impact.
