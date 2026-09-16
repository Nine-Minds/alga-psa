import type { Knex } from 'knex';
import type { ISO8601String } from '@alga-psa/types';

/**
 * Read-only contract-cadence coverage audit.
 *
 * These are the executable source of truth for the queries documented in
 * `docs/plans/2026-09-15-replenish-contract-cadence-operational-verification.md`.
 * They apply the same eligibility rules as the replenisher and clip the target
 * to the assignment end, so a short assignment is not reported as permanently
 * short of a horizon it can never reach.
 */

export interface ContractCadenceCoverageAuditInput {
  /** Audit date (YYYY-MM-DD). */
  asOf: ISO8601String;
  targetHorizonDays?: number;
  thresholdDays?: number;
  tenant?: string;
}

export interface ContractCadenceCoverageRow {
  tenant: string;
  contract_line_id: string;
  contract_line_name: string;
  assignment_start: string;
  assignment_end: string | null;
  billing_frequency: string;
  billing_timing: string;
  first_start: string | null;
  furthest_end: string | null;
  active_periods: string | number;
  billed_floor_end: string | null;
  coverage_floor_start: string;
  effective_target_end: string;
  effective_threshold_end: string;
  exhausted: boolean;
  below_threshold: boolean;
  meets_target: boolean;
  leading_gap: boolean;
}

export interface ContractCadenceInteriorGapRow {
  tenant: string;
  schedule_key: string;
  obligation_id: string;
  previous_end: string;
  gap_start: string;
  gap_days: number | string;
  billed_floor_end: string;
  is_intentional: boolean;
}

export interface ContractCadenceCoverageAuditResult {
  asOf: ISO8601String;
  targetEnd: ISO8601String;
  thresholdEnd: ISO8601String;
  coverage: ContractCadenceCoverageRow[];
  interiorGaps: ContractCadenceInteriorGapRow[];
}

// Shared eligibility fragment. Keep in sync with
// loadEligibleContractCadenceObligationsForReplenishment: active assignment,
// contract and line, not system-managed, contract cadence, advalorem supported
// frequency, advance/arrears timing, and assignment live at the audit date.
const ELIGIBLE_LINES_CTE = `
  eligible as (
    select cl.tenant,
           cl.contract_line_id,
           cl.contract_line_name,
           cl.billing_frequency,
           cl.billing_timing,
           cc.start_date as assignment_start,
           cc.end_date as assignment_end
    from contract_lines cl
    join contracts ct
      on ct.tenant = cl.tenant and ct.contract_id = cl.contract_id
    join client_contracts cc
      on cc.tenant = cl.tenant and cc.contract_id = cl.contract_id
    cross join params p
    where cl.cadence_owner = 'contract'
      and cl.is_active
      and ct.is_active
      and cc.is_active
      and coalesce(ct.is_system_managed_default, false) = false
      and cl.billing_timing in ('advance', 'arrears')
      and lower(cl.billing_frequency) in (
        'monthly', 'quarterly', 'semi-annually', 'semiannually', 'annually', 'annual'
      )
      and cc.start_date is not null
      and cc.start_date <= p.as_of
      and (cc.end_date is null or cc.end_date > p.as_of)
      and (p.tenant_filter is null or cl.tenant = p.tenant_filter)
  )
`;

export const CONTRACT_CADENCE_COVERAGE_AUDIT_SQL = `
with params as (
  select cast(? as date) as as_of,
         cast(? as date) as target_end,
         cast(? as date) as threshold_end,
         cast(? as uuid) as tenant_filter
),
${ELIGIBLE_LINES_CTE},
active as (
  select tenant,
         obligation_id,
         min(service_period_start) as first_start,
         max(service_period_end) as furthest_end,
         count(*) as active_periods
  from recurring_service_periods
  where obligation_type = 'contract_line'
    and cadence_owner = 'contract'
    and lifecycle_state not in ('superseded', 'archived')
  group by tenant, obligation_id
),
billed_floor as (
  select tenant,
         obligation_id,
         max(service_period_end) as billed_floor_end
  from recurring_service_periods
  where obligation_type = 'contract_line'
    and cadence_owner = 'contract'
    and (lifecycle_state = 'billed' or invoice_charge_detail_id is not null)
  group by tenant, obligation_id
)
select
  e.tenant,
  e.contract_line_id,
  e.contract_line_name,
  e.assignment_start,
  e.assignment_end,
  e.billing_frequency,
  e.billing_timing,
  a.first_start,
  a.furthest_end,
  a.active_periods,
  b.billed_floor_end,
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
left join active a
  on a.tenant = e.tenant and a.obligation_id = e.contract_line_id
left join billed_floor b
  on b.tenant = e.tenant and b.obligation_id = e.contract_line_id
order by exhausted desc, below_threshold desc, meets_target, a.furthest_end nulls first
`;

export const CONTRACT_CADENCE_INTERIOR_GAPS_SQL = `
with params as (
  select cast(? as date) as as_of,
         cast(? as uuid) as tenant_filter
),
${ELIGIBLE_LINES_CTE},
active as (
  select tenant,
         schedule_key,
         obligation_id,
         service_period_start,
         service_period_end,
         lag(service_period_end) over (
           partition by tenant, schedule_key
           order by service_period_start
         ) as previous_end
  from recurring_service_periods
  where obligation_type = 'contract_line'
    and cadence_owner = 'contract'
    and lifecycle_state not in ('superseded', 'archived')
),
floor as (
  select tenant,
         obligation_id,
         max(service_period_end) as billed_floor_end
  from recurring_service_periods
  where obligation_type = 'contract_line'
    and cadence_owner = 'contract'
    and (lifecycle_state = 'billed' or invoice_charge_detail_id is not null)
  group by tenant, obligation_id
)
select
  a.tenant,
  a.schedule_key,
  a.obligation_id,
  a.previous_end,
  a.service_period_start as gap_start,
  (a.service_period_start - a.previous_end) as gap_days,
  coalesce(f.billed_floor_end, date '0001-01-01') as billed_floor_end,
  (a.service_period_start <= coalesce(f.billed_floor_end, date '0001-01-01')) as is_intentional
from active a
join eligible e
  on e.tenant = a.tenant and e.contract_line_id = a.obligation_id
left join floor f
  on f.tenant = a.tenant and f.obligation_id = a.obligation_id
where a.previous_end is not null
  and a.service_period_start > a.previous_end
order by is_intentional, a.tenant, a.schedule_key, a.service_period_start
`;

function addDays(date: ISO8601String, days: number): ISO8601String {
  const next = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10) as ISO8601String;
}

/**
 * Run both read-only audits. Callers should wrap this in a read-only
 * transaction; it performs no writes.
 */
export async function runContractCadenceCoverageAudit(
  trx: Knex,
  input: ContractCadenceCoverageAuditInput,
): Promise<ContractCadenceCoverageAuditResult> {
  const asOf = input.asOf.slice(0, 10) as ISO8601String;
  const targetEnd = addDays(asOf, input.targetHorizonDays ?? 180);
  const thresholdEnd = addDays(asOf, input.thresholdDays ?? 45);
  const tenant = input.tenant ?? null;

  const coverageResult = await trx.raw(CONTRACT_CADENCE_COVERAGE_AUDIT_SQL, [
    asOf,
    targetEnd,
    thresholdEnd,
    tenant,
  ]);
  const interiorGapResult = await trx.raw(CONTRACT_CADENCE_INTERIOR_GAPS_SQL, [asOf, tenant]);

  return {
    asOf,
    targetEnd,
    thresholdEnd,
    coverage: coverageResult.rows as ContractCadenceCoverageRow[],
    interiorGaps: interiorGapResult.rows as ContractCadenceInteriorGapRow[],
  };
}
