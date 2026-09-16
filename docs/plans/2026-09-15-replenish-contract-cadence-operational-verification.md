# Contract-cadence coverage: audit and post-deploy verification

Companion to [the replenishment plan](2026-09-15-replenish-contract-cadence-service-periods-plan.md).
Every query here is read-only and parameterized (`:as_of`, `:target`,
`:threshold`). Nothing in this document has been run against production; the
sections are separated into **proposed** procedures and the **performed** checks
recorded below. Production identifiers live on the board card, not here.

## What "missing" means

A contract-cadence line has valid coverage up to `min(today, assignment end)`
when its active ledger (lifecycle not `superseded`/`archived`) has a service
period covering every consecutive cadence boundary from the historical floor
forward, **and** its furthest service-period end reaches the 180-day target. The
historical floor is `max(assignment start, last billed/invoice-linked
service-period end)`; gaps before that floor are history and are not expected to
be recreated.

Audit by assignment/schedule identity, not by a maximum end date: a single
furthest end cannot prove continuity, and the same contract line can have a
different assignment window per client.

Four shapes need distinguishing:

- **Absent coverage** — no active future row at all (silent exhaustion).
- **Exhausted coverage** — furthest active end is before the run date.
- **Below-threshold coverage** — furthest active end is before `today + 45d`
  but not yet past today.
- **Interior gap** — an unbilled hole after the floor and before the furthest
  row, which is exactly the case a maximum end date hides.

Preserved exclusions (a period at or before the floor, a `skipped`/`deferred`
row, a locked row, a manual boundary override, a period past the assignment end)
must stay untouched and are reported as intentional rather than recovered.

## Scheduler authority and logs

One authoritative schedule executes this operation per deployment:

- **Enterprise (Essentials/Solo/Pro):** the durable Temporal maintenance fan-out
  schedule `maintenance-fanout:replenishContractCadenceServicePeriods`, daily at
  `0 4 * * *`, `overlap=SKIP`, `catchupWindow=1m`. The schedule publishes a
  `MAINTENANCE_JOB_REQUESTED` event; the server-side subscriber holds a
  cluster-wide Redis lock and runs the sweep once across tenants.
- **Other supported deployments (no Temporal):** the legacy pg-boss recurring
  job `replenishContractCadenceServicePeriods` (daily, singleton per install).
  It is deliberately **not** registered in Enterprise, so the sweep cannot run
  twice per day.

Each tenant runs in its own transaction behind a
`pg_advisory_xact_lock(hashtextextended(tenant || ':contract-cadence-replenishment'))`.
Each eligible line runs in its own savepoint, so a failed line rolls back only
that line and the tenant transaction still commits its other repairs. A tenant
transaction that fails is logged and the next run retries; other tenants are
unaffected.

The sweep logs one structured line per tenant with: `tenant`, `asOf` (run date),
`linesExamined`, `linesReplenished`, `periodsGenerated`, `periodsRealigned`,
`periodsSuperseded`, `linesExhaustedBeforeRun`, `linesAtPeriodCap`,
`remainingCoverageGaps`, `failedObligations`, and a bounded `failures` list. Only
periods from savepoints that committed are counted as generated; a rolled-back
line appears under `failures` and contributes no generated count.

## Proposed read-only audit

Run against the Citus coordinator in a read-only transaction. `:as_of` is the
audit date, `:target` is `today + 180 days`, `:threshold` is `today + 45 days`.

```sql
begin read only;

-- 1. Per contract-cadence schedule: furthest active coverage, obligation
--    window, and whether the schedule is exhausted, below threshold, or short
--    of the rolling target. The schedule identity (schedule_key) is projected so
--    a result can be grouped before any tenant is named.
with active as (
  select
    rsp.tenant,
    rsp.schedule_key,
    rsp.obligation_id,
    min(rsp.service_period_start) as first_start,
    max(rsp.service_period_end)   as furthest_end,
    count(*)                      as active_periods
  from recurring_service_periods rsp
  where rsp.obligation_type = 'contract_line'
    and rsp.cadence_owner = 'contract'
    and rsp.lifecycle_state not in ('superseded', 'archived')
  group by rsp.tenant, rsp.schedule_key, rsp.obligation_id
)
select
  a.tenant,
  a.schedule_key,
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
  (a.furthest_end is null or a.furthest_end < (:as_of)::date)                 as exhausted,
  (a.furthest_end is null or a.furthest_end < (:threshold)::date)             as below_threshold,
  (a.furthest_end >= (:target)::date)                                         as meets_target
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
order by exhausted desc, below_threshold desc, meets_target, a.furthest_end;

-- 2. Interior gaps (accidental holes after the billed floor). A row appears
--    when the previous active period's end is before the next period's start.
--    `is_intentional` flags gaps whose start is at or before the historical
--    billed floor (do not auto-recover).
with active as (
  select
    rsp.tenant,
    rsp.schedule_key,
    rsp.obligation_id,
    rsp.service_period_start,
    rsp.service_period_end,
    lag(rsp.service_period_end) over (
      partition by rsp.tenant, rsp.schedule_key
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
    rsp.schedule_key,
    max(rsp.service_period_end) as billed_floor_end
  from recurring_service_periods rsp
  where rsp.obligation_type = 'contract_line'
    and rsp.cadence_owner = 'contract'
    and (rsp.lifecycle_state = 'billed' or rsp.invoice_charge_detail_id is not null)
  group by rsp.tenant, rsp.schedule_key
)
select
  a.tenant,
  a.schedule_key,
  a.obligation_id,
  a.previous_end,
  a.service_period_start as gap_end,
  (a.service_period_start - a.previous_end) as gap_days,
  coalesce(f.billed_floor_end, date '0001-01-01') as billed_floor_end,
  (a.service_period_start <= coalesce(f.billed_floor_end, date '0001-01-01')) as is_intentional
from active a
left join floor f
  on f.tenant = a.tenant and f.schedule_key = a.schedule_key
where a.previous_end is not null
  and a.service_period_start > a.previous_end
order by is_intentional, a.tenant, a.schedule_key, a.service_period_start;

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

Cross-tenant impact is unmeasured. Query 1 projects `tenant` and `schedule_key`
so results can be grouped as counts per tenant (`count(*) filter (where
exhausted)`, `... below_threshold`, `... not meets_target`) before any tenant is
named.

## Pre-deployment aggregate impact assessment

Run query 1 across all tenants before deploying and record only counts per
tenant: eligible schedules, exhausted, below-threshold, and short-of-target.
This establishes the blast radius of the first successful sweep (the defect is
structural, so every tenant with contract-cadence lines authored more than ~180
days ago is a candidate). Also confirm from Loki that the nightly
`createClientContractLineCycles` schedule is actually firing and whether it
reports per-client errors. Deployed-image equivalence and historical scheduler
success are not established by the audit alone.

## Post-deployment verification

1. Run query 1 filtered to the reported client and confirm the schedule's
   furthest active service-period end reaches `today + 180 days`, and that
   `exhausted`, `below_threshold`, and `meets_target` are all resolved.
2. Confirm exactly one active service period covers `2026-08-08` to
   `2026-09-08` for the reported line, with invoice window `2026-09-08` to
   `2026-10-08` (the **following** anniversary month for an arrears line).
3. Confirm the billed periods through `2026-07-08` to `2026-08-08` still carry
   their invoice linkage to the reported invoice, and that the invoice whose
   header window is `2026-08-08` to `2026-09-08` still maps to **July–August
   service**. A following-month invoice header does not mean the following
   month's service was billed; the recovered row is the missing August–September
   service.
4. Confirm the locked `2026-02-08` to `2026-03-08` row is still `locked` with no
   linkage, and the superseded client-cadence rows (including `2026-08-01` to
   `2026-09-01`) are still `superseded`.
5. Run the sweep a second time and confirm zero generated periods, zero
   superseded rows, and an unchanged row count.
6. Open Ready to Bill for the client and confirm the recovered service period is
   listed as due in the `2026-09-08` window. Do not generate or send the invoice.
7. Run query 2 across all tenants and record whether any non-intentional gaps
   remain after the first successful sweep.

## Performed checks

Only the isolated local test database was exercised; no production record was
read or changed.

- `contractCadenceServicePeriodReplenishment.test.ts` (14 tests) reproduces the
  production ledger shape in an isolated test database and asserts the recovered
  period, the following-month invoice-window mapping, preserved billed/locked/
  skipped/deferred/superseded history, repeat-run idempotency, a later-horizon
  run with no invoices, multiple missed periods for a never-invoiced assignment,
  an interior gap behind an existing later row, a capped catch-up that makes
  forward progress across runs, advance/arrears and month-end and
  quarterly/semi-annual/annual anchors, eligibility, per-line failure isolation
  with retry, per-tenant sweep isolation, and tenant isolation.
- `contractCadenceServicePeriodReplenishment.concurrency.test.ts` commits the
  fixture on a pool connection and runs two overlapping sweeps on separate
  connections, asserting the advisory lock serialises them and no period is
  written twice.
- `materializeContractCadenceServicePeriods.domain.test.ts` covers the
  `coverageAnchorDate` decoupling and the period-cap reporting.
- `contractCadenceReplenishmentScheduling.test.ts` proves the pg-boss schedule
  is registered once, executes the sweep, is idempotent on repeat
  initialization, and is skipped when Enterprise owns scheduling.
- `maintenanceJobFanout.unit.test.ts` proves the job runs once as a system
  maintenance job and does not re-enumerate tenants.
- `setupSchedules.contract-cadence-replenishment.test.ts` proves the Temporal
  maintenance fan-out schedule is created with the daily cron and overlap policy
  and is updated rather than duplicated on repeat setup.
- `regenerateRecurringServicePeriods` gap-aware pairing is covered by the shared
  and server unit suites.

Not performed: any production query in the audit section, any UI check of Ready
to Bill, any measurement of cross-tenant impact, deployed-image equivalence, or
historical scheduler success. Deployment and production repair are outside this
work order.
