import type { Knex } from 'knex';
import type {
  DuePosition,
  IRecurringObligationRef,
  IRecurringServicePeriod,
  IRecurringServicePeriodRecord,
  ISO8601String,
} from '@alga-psa/types';
import {
  generateAnnualContractCadenceServicePeriods,
  generateMonthlyContractCadenceServicePeriods,
  generateQuarterlyContractCadenceServicePeriods,
  generateSemiAnnualContractCadenceServicePeriods,
  type ContractCadenceServicePeriodGenerationInput,
} from '@shared/billingClients/contractCadenceServicePeriods';
import {
  findRecurringServicePeriodCandidateProtection,
} from '@shared/billingClients/regenerateRecurringServicePeriods';
import {
  buildRecurringServicePeriodPeriodKey,
  buildRecurringServicePeriodScheduleKey,
} from '@shared/billingClients/recurringServicePeriodKeys';

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
  /** Recoverable leading hole between the coverage floor and the first active period. */
  leading_gap: boolean;
  /** True when that leading hole is fully protected and must not be recovered. */
  leading_gap_intentional: boolean;
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
  assignment_start: string;
  billing_frequency: string;
  billing_timing: string;
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
  (a.service_period_start <= coalesce(f.billed_floor_end, date '0001-01-01')) as is_intentional,
  e.assignment_start,
  e.billing_frequency,
  e.billing_timing
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

type SupportedCadenceFrequency = 'monthly' | 'quarterly' | 'semi-annually' | 'annually';

const CADENCE_GENERATORS: Record<
  SupportedCadenceFrequency,
  (input: ContractCadenceServicePeriodGenerationInput) => IRecurringServicePeriod[]
> = {
  monthly: generateMonthlyContractCadenceServicePeriods,
  quarterly: generateQuarterlyContractCadenceServicePeriods,
  'semi-annually': generateSemiAnnualContractCadenceServicePeriods,
  annually: generateAnnualContractCadenceServicePeriods,
};

function normalizeCadenceFrequency(value: string): SupportedCadenceFrequency | null {
  switch ((value ?? '').toLowerCase()) {
    case 'monthly':
      return 'monthly';
    case 'quarterly':
      return 'quarterly';
    case 'semi-annually':
    case 'semiannually':
      return 'semi-annually';
    case 'annually':
    case 'annual':
      return 'annually';
    default:
      return null;
  }
}

function toDateOnly(value: unknown): ISO8601String {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10) as ISO8601String;
  }
  return `${String(value).slice(0, 10)}` as ISO8601String;
}

// `findRecurringServicePeriodCandidateProtection` only reads the schedule slot
// and the service-period range, so the audit can hand it these lightweight
// shapes instead of hydrating a full persisted record.
type ProtectionRecordShape = {
  scheduleKey: string;
  periodKey: string;
  sourceObligation: { tenant: string; obligationType: string; obligationId: string };
  servicePeriod: { start: ISO8601String; end: ISO8601String };
};

const asProtectionRecord = (shape: ProtectionRecordShape): IRecurringServicePeriodRecord =>
  shape as unknown as IRecurringServicePeriodRecord;

interface ProtectedPeriodDbRow {
  tenant: string;
  obligation_id: string;
  schedule_key: string;
  period_key: string;
  service_period_start: unknown;
  service_period_end: unknown;
}

async function loadProtectedRecordsByObligation(
  trx: Knex,
  obligationIds: string[],
  tenantFilter: string | null,
): Promise<Map<string, IRecurringServicePeriodRecord[]>> {
  const protectedByObligation = new Map<string, IRecurringServicePeriodRecord[]>();
  if (obligationIds.length === 0) {
    return protectedByObligation;
  }

  const protectedQuery = trx('recurring_service_periods')
    .where({ obligation_type: 'contract_line', cadence_owner: 'contract' })
    .whereIn('obligation_id', obligationIds)
    .whereNotIn('lifecycle_state', ['superseded', 'archived'])
    .andWhere((builder) =>
      builder
        .whereIn('lifecycle_state', ['edited', 'locked', 'skipped', 'billed'])
        .orWhereIn('provenance_kind', ['user_edited', 'repair'])
        .orWhereNotNull('invoice_id')
        .orWhereNotNull('invoice_charge_detail_id'),
    )
    .select(
      'tenant',
      'obligation_id',
      'schedule_key',
      'period_key',
      'service_period_start',
      'service_period_end',
    );
  if (tenantFilter) {
    protectedQuery.andWhere('tenant', tenantFilter);
  }
  const protectedRows = (await protectedQuery) as ProtectedPeriodDbRow[];

  for (const row of protectedRows) {
    const key = `${row.tenant}\u0000${row.obligation_id}`;
    const list = protectedByObligation.get(key) ?? [];
    list.push(
      asProtectionRecord({
        scheduleKey: row.schedule_key,
        periodKey: row.period_key,
        sourceObligation: {
          tenant: String(row.tenant),
          obligationType: 'contract_line',
          obligationId: String(row.obligation_id),
        },
        servicePeriod: {
          start: toDateOnly(row.service_period_start),
          end: toDateOnly(row.service_period_end),
        },
      }),
    );
    protectedByObligation.set(key, list);
  }

  return protectedByObligation;
}

/**
 * A hole between `regionStart` and `regionEnd` is an intentional exclusion only
 * when the canonical candidate(s) covering it are all protected. This is the
 * same candidate/protection rule the regeneration and capped continuation use,
 * applied to both interior and leading gaps, so an unprotected candidate keeps
 * the hole recoverable and a partial protection cannot hide a real gap.
 */
function areAllGapCandidatesProtected(params: {
  tenant: string;
  obligationId: string;
  assignmentStart: string;
  billingFrequency: string;
  billingTiming: string;
  regionStart: ISO8601String;
  regionEnd: ISO8601String;
  protectedForObligation: IRecurringServicePeriodRecord[];
}): boolean {
  const frequency = normalizeCadenceFrequency(params.billingFrequency);
  if (!frequency) {
    return false;
  }
  const regionStart = toDateOnly(params.regionStart);
  const regionEnd = toDateOnly(params.regionEnd);
  if (regionEnd <= regionStart) {
    return false;
  }

  const duePosition: DuePosition = params.billingTiming === 'advance' ? 'advance' : 'arrears';
  const sourceObligation: IRecurringObligationRef = {
    tenant: params.tenant,
    obligationId: params.obligationId,
    obligationType: 'contract_line',
    chargeFamily: 'fixed',
  };
  const scheduleKey = buildRecurringServicePeriodScheduleKey({
    tenant: params.tenant,
    obligationType: 'contract_line',
    obligationId: params.obligationId,
    cadenceOwner: 'contract',
    duePosition,
  });

  const periods = CADENCE_GENERATORS[frequency]({
    rangeStart: regionStart,
    rangeEnd: regionEnd,
    sourceObligation,
    duePosition,
    anchorDate: toDateOnly(params.assignmentStart),
  });
  const gapPeriods = periods.filter(
    (period) => toDateOnly(period.start) < regionEnd && toDateOnly(period.end) > regionStart,
  );
  if (gapPeriods.length === 0) {
    return false;
  }

  return gapPeriods.every(
    (period) =>
      findRecurringServicePeriodCandidateProtection(
        asProtectionRecord({
          scheduleKey,
          periodKey: buildRecurringServicePeriodPeriodKey(period),
          sourceObligation: {
            tenant: params.tenant,
            obligationType: 'contract_line',
            obligationId: params.obligationId,
          },
          servicePeriod: {
            start: toDateOnly(period.start),
            end: toDateOnly(period.end),
          },
        }),
        params.protectedForObligation,
      ) != null,
  );
}

/**
 * Reclassify raw interior gaps against the canonical protection semantics.
 *
 * The SQL marks a gap intentional when it sits at or before the billed floor
 * (historical). That misses a gap created when a protected override suppresses
 * a candidate it only partially overlaps: the override Aug 8–Sep 15 keeps the
 * Aug 8–Sep 8 slot, so the Sep 8–Oct 8 candidate is suppressed, leaving a
 * Sep 15–Oct 8 hole that is not history.
 */
async function markProtectedInteriorGaps(
  trx: Knex,
  gaps: ContractCadenceInteriorGapRow[],
  tenantFilter: string | null,
): Promise<void> {
  const pending = gaps.filter((gap) => !gap.is_intentional);
  if (pending.length === 0) {
    return;
  }

  const obligationIds = Array.from(new Set(pending.map((gap) => String(gap.obligation_id))));
  const protectedByObligation = await loadProtectedRecordsByObligation(trx, obligationIds, tenantFilter);

  for (const gap of pending) {
    const tenant = String(gap.tenant);
    const obligationId = String(gap.obligation_id);
    const protectedForObligation = protectedByObligation.get(`${tenant}\u0000${obligationId}`) ?? [];
    const intentional = areAllGapCandidatesProtected({
      tenant,
      obligationId,
      assignmentStart: gap.assignment_start,
      billingFrequency: gap.billing_frequency,
      billingTiming: gap.billing_timing,
      regionStart: toDateOnly(gap.previous_end),
      regionEnd: toDateOnly(gap.gap_start),
      protectedForObligation,
    });
    if (intentional) {
      gap.is_intentional = true;
    }
  }
}

/**
 * A leading gap is the region between the historical coverage floor and the
 * first active service period. Apply the same protection semantics: an override
 * that shifts the first period forward (for example an edited Aug 15–Sep 8
 * period retaining the Aug 8–Sep 8 slot) protects the first candidate, so the
 * gap is an intentional exclusion, not a missing first period. Genuinely
 * missing first candidates stay recoverable.
 */
async function markProtectedLeadingGaps(
  trx: Knex,
  coverage: ContractCadenceCoverageRow[],
  tenantFilter: string | null,
): Promise<void> {
  const pending = coverage.filter((row) => row.leading_gap && row.first_start != null);
  if (pending.length === 0) {
    return;
  }

  const obligationIds = Array.from(new Set(pending.map((row) => String(row.contract_line_id))));
  const protectedByObligation = await loadProtectedRecordsByObligation(trx, obligationIds, tenantFilter);

  for (const row of pending) {
    const tenant = String(row.tenant);
    const obligationId = String(row.contract_line_id);
    const protectedForObligation = protectedByObligation.get(`${tenant}\u0000${obligationId}`) ?? [];
    const intentional = areAllGapCandidatesProtected({
      tenant,
      obligationId,
      assignmentStart: row.assignment_start,
      billingFrequency: row.billing_frequency,
      billingTiming: row.billing_timing,
      regionStart: toDateOnly(row.coverage_floor_start),
      regionEnd: toDateOnly(row.first_start),
      protectedForObligation,
    });
    if (intentional) {
      row.leading_gap = false;
      row.leading_gap_intentional = true;
    }
  }
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
  const coverage = coverageResult.rows as ContractCadenceCoverageRow[];
  for (const row of coverage) {
    row.leading_gap_intentional = false;
  }

  const interiorGapResult = await trx.raw(CONTRACT_CADENCE_INTERIOR_GAPS_SQL, [asOf, tenant]);
  const interiorGaps = interiorGapResult.rows as ContractCadenceInteriorGapRow[];

  await markProtectedInteriorGaps(trx, interiorGaps, tenant);
  await markProtectedLeadingGaps(trx, coverage, tenant);

  return {
    asOf,
    targetEnd,
    thresholdEnd,
    coverage,
    interiorGaps,
  };
}
