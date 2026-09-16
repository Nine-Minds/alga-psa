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

The executable source of truth is
`packages/billing/src/actions/contractCadenceCoverageAudit.ts`
(`runContractCadenceCoverageAudit`), validated by
`contractCadenceCoverageAudit.test.ts`. Run it in a read-only transaction; it
performs no writes. It returns per-line coverage and interior gaps.

Coverage query (abridged; see the module for the exact SQL). It:

- applies the same eligibility rules as the replenisher (active assignment,
  contract and line; not system-managed; `cadence_owner = 'contract'`;
  supported frequency; advance/arrears timing; assignment live at `:as_of`);
- clips the target, threshold and "today" comparisons to the assignment end via
  `least(..., coalesce(assignment_end, ...))`, so a short assignment that ends
  before the horizon is not reported as permanently short;
- computes `coverage_floor_start = greatest(assignment_start, billed_floor_end)`
  and flags a **leading gap** when the first active row starts after that floor
  (the case a `lag()`-only interior scan misses when there is no billed
  history).

```sql
with params as (
  select cast(:as_of as date) as as_of,
         cast(:target as date) as target_end,
         cast(:threshold as date) as threshold_end,
         cast(:tenant as uuid) as tenant_filter
),
eligible as (
  select cl.tenant, cl.contract_line_id, cl.contract_line_name,
         cl.billing_frequency, cl.billing_timing,
         cc.start_date as assignment_start, cc.end_date as assignment_end
  from contract_lines cl
  join contracts ct on ct.tenant = cl.tenant and ct.contract_id = cl.contract_id
  join client_contracts cc on cc.tenant = cl.tenant and cc.contract_id = cl.contract_id
  cross join params p
  where cl.cadence_owner = 'contract'
    and cl.is_active and ct.is_active and cc.is_active
    and coalesce(ct.is_system_managed_default, false) = false
    and cl.billing_timing in ('advance', 'arrears')
    and lower(cl.billing_frequency) in (
      'monthly', 'quarterly', 'semi-annually', 'semiannually', 'annually', 'annual'
    )
    and cc.start_date is not null
    and cc.start_date <= p.as_of
    and (cc.end_date is null or cc.end_date > p.as_of)
    and (p.tenant_filter is null or cl.tenant = p.tenant_filter)
),
active as (
  select tenant, obligation_id,
         min(service_period_start) as first_start,
         max(service_period_end) as furthest_end,
         count(*) as active_periods
  from recurring_service_periods
  where obligation_type = 'contract_line' and cadence_owner = 'contract'
    and lifecycle_state not in ('superseded', 'archived')
  group by tenant, obligation_id
),
billed_floor as (
  select tenant, obligation_id, max(service_period_end) as billed_floor_end
  from recurring_service_periods
  where obligation_type = 'contract_line' and cadence_owner = 'contract'
    and (lifecycle_state = 'billed' or invoice_charge_detail_id is not null)
  group by tenant, obligation_id
)
select
  e.tenant, e.contract_line_id, e.contract_line_name,
  e.assignment_start, e.assignment_end, e.billing_frequency, e.billing_timing,
  a.first_start, a.furthest_end, a.active_periods, b.billed_floor_end,
  greatest(e.assignment_start, coalesce(b.billed_floor_end, e.assignment_start)) as coverage_floor_start,
  least(p.target_end, coalesce(e.assignment_end, p.target_end)) as effective_target_end,
  least(p.threshold_end, coalesce(e.assignment_end, p.threshold_end)) as effective_threshold_end,
  (a.furthest_end is null
     or a.furthest_end < least(p.as_of, coalesce(e.assignment_end, p.as_of))) as exhausted,
  (a.furthest_end is null
     or a.furthest_end < least(p.threshold_end, coalesce(e.assignment_end, p.threshold_end))) as below_threshold,
  (a.furthest_end is not null
     and a.furthest_end >= least(p.target_end, coalesce(e.assignment_end, p.target_end))) as meets_target,
  (a.first_start is null
     or a.first_start > greatest(e.assignment_start, coalesce(b.billed_floor_end, e.assignment_start))) as leading_gap
from eligible e
cross join params p
left join active a on a.tenant = e.tenant and a.obligation_id = e.contract_line_id
left join billed_floor b on b.tenant = e.tenant and b.obligation_id = e.contract_line_id
order by exhausted desc, below_threshold desc, meets_target, a.furthest_end nulls first;
```

Interior gaps use the same `eligible` CTE and a `lag()` over
`(tenant, schedule_key)`; `is_intentional` marks a gap whose start is at or
before the billed floor (see the module for the full query). A line absent from
`coverage` is ineligible; a line with `furthest_end is null` is silently
exhausted.

Cross-tenant impact is unmeasured. Both queries project `tenant` (and coverage
projects `contract_line_id`), so results can be grouped as counts per tenant
(`count(*) filter (where exhausted)`, `... below_threshold`, `... not
meets_target`, `... leading_gap`) before any tenant is named.

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

- `contractCadenceServicePeriodReplenishment.test.ts` (26 tests) reproduces the
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
  written twice. A second test holds an invoicing transaction open while the
  sweep reads the old generated state. Once invoicing commits, the guarded
  supersession rejects that stale update, rolls back the line, and preserves
  the invoice linkage on retry.
- `materializeContractCadenceServicePeriods.domain.test.ts` covers the
  `coverageAnchorDate` decoupling and the period-cap reporting.
- `contractCadenceReplenishmentScheduling.test.ts` proves the pg-boss schedule is
  routed through the job runner, uses one stable schedule id across repeat
  initialization, returns without scheduling when Enterprise owns scheduling,
  and fails loudly when the runner is unavailable or lacks global schedules.
- `contractCadenceReplenishmentScheduling.db.test.ts` (real pg-boss) proves the
  daily schedule is persisted in `pgboss.schedule`, successive firings reach the
  worker, it survives a runner restart, and repeat initialization converges on
  one schedule.
- `maintenanceJobFanout.unit.test.ts` proves the job runs once as a system job,
  aggregates tenant- and line-level failures instead of reporting unconditional
  success, and propagates a total failure.
- `maintenanceJobSubscriber.unit.test.ts` proves a reported partial failure does
  not trigger event-bus redelivery while a thrown total failure does.
- `maintenance-fanout-activities.test.ts` proves the Temporal activity reports
  publication success independently of later replenishment execution.
- `setupSchedules.contract-cadence-replenishment.test.ts` proves the Temporal
  maintenance fan-out schedule is created with the daily cron and overlap policy
  and is updated rather than duplicated on repeat setup.
- `contractCadenceCoverageAudit.test.ts` validates the read-only audit against
  absent, leading-gap, interior-gap, intentional-exclusion, bounded-assignment,
  and ineligible-line fixtures.
- `regenerateRecurringServicePeriods` checks every proposed insert or replacement
  against protected slots and overlapping ranges, including overrides expanded
  backward into an earlier period. It suppresses unsafe candidates and reports
  the protected record and candidate slot in the regeneration conflicts.
  Capped continuation uses the same protection rule so an intentional exclusion
  cannot stall catch-up. The shared and server suites cover these rules.
- Empty generation batches retain their coverage limit. A completed catch-up
  leaves later valid rows untouched, while an assignment ending at its final
  billed period still retires mutable post-end rows. Continuation does not turn
  coverage beyond a shortened assignment into protected billed history.
- `billingInvoiceTiming.integration.test.ts` selects the fixed February 2025
  window explicitly in its reconciliation tests. Rolling replenishment adds
  enough newer windows to move that fixture beyond the first listing page.
  T156–T158 passed at the pre-task commit `ec5ce14fcc`; their unfiltered listing
  failed on the draft branch, so they were not pre-existing failures.

Not performed: any production query in the audit section, any UI check of Ready
to Bill, any measurement of cross-tenant impact, deployed-image equivalence, or
historical scheduler success. Deployment and production repair are outside this
work order.
