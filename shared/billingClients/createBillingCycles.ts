import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { ensureClientDefaultBillingProfile } from './billingProfiles';
import { listSeparatelyBillingProfiles } from './billingProfileSettings';
import { Temporal } from '@js-temporal/polyfill';
import type { IClientContractLineCycle, IClient, ISO8601String, BillingCycleType } from '@alga-psa/types';
import { parseISO } from 'date-fns';
import {
  ensureUtcMidnightIsoDate,
  getAnchorDefaultsForCycle,
  getBillingPeriodForDate,
  getNextBillingBoundaryAfter,
  normalizeAnchorSettingsForCycle,
  type NormalizedBillingCycleAnchorSettings
} from './billingCycleAnchors';

export type BillingCycleCreationResult = {
  success: boolean;
  error?: 'duplicate' | 'invalid_date' | 'db_error';
  message?: string;
  suggestedDate?: ISO8601String;
};

function getNextCycleDate(
  currentDate: ISO8601String,
  billingCycle: BillingCycleType,
  anchor: NormalizedBillingCycleAnchorSettings
): { effectiveDate: ISO8601String; periodStart: ISO8601String; periodEnd: ISO8601String } {
  const effectiveDate = ensureUtcMidnightIsoDate(currentDate);
  const periodStart = effectiveDate;
  const periodEnd = getNextBillingBoundaryAfter(effectiveDate, billingCycle, anchor);
  return { effectiveDate, periodStart, periodEnd };
}

function getStartOfCurrentCycle(
  date: ISO8601String,
  billingCycle: BillingCycleType,
  anchor: NormalizedBillingCycleAnchorSettings
): { effectiveDate: ISO8601String; periodStart: ISO8601String; periodEnd: ISO8601String } {
  const referenceDate = ensureUtcMidnightIsoDate(date);
  const period = getBillingPeriodForDate(referenceDate, billingCycle, anchor);
  return {
    effectiveDate: period.periodStartDate,
    periodStart: period.periodStartDate,
    periodEnd: period.periodEndDate
  };
}

async function createBillingCycle(
  knex: Knex | Knex.Transaction,
  cycle: Partial<IClientContractLineCycle> & {
    effective_date: ISO8601String;
    period_start_date: ISO8601String;
    period_end_date: ISO8601String;
    /**
     * The profile this cycle bills; required since S8. Every overlap and
     * duplicate check is scoped to it — two profiles of one client are supposed
     * to have cycles covering the same month.
     */
    billing_profile_id: string;
  }
): Promise<BillingCycleCreationResult> {
  const effectiveDate = ensureUtcMidnightIsoDate(cycle.effective_date);
  const periodStart = ensureUtcMidnightIsoDate(cycle.period_start_date);
  const periodEnd = ensureUtcMidnightIsoDate(cycle.period_end_date);

  if (
    Temporal.PlainDate.compare(
      Temporal.PlainDate.from(periodEnd.slice(0, 10)),
      Temporal.PlainDate.from(periodStart.slice(0, 10))
    ) <= 0
  ) {
    return {
      success: false,
      error: 'invalid_date',
      message: 'Billing period end must be after the start date.'
    };
  }

  const db = tenantDb(knex, cycle.tenant as string);
  const overlap = await db.table('client_billing_cycles')
    .where({
      client_id: cycle.client_id,
      billing_profile_id: cycle.billing_profile_id,
      is_active: true
    })
    .whereNotNull('period_end_date')
    .andWhere('period_start_date', '<', periodEnd)
    .andWhere('period_end_date', '>', periodStart)
    .first()
    .select('period_end_date', 'period_start_date');

  if (overlap) {
    return {
      success: false,
      error: 'duplicate',
      message: 'A billing period overlapping this date range already exists.'
    };
  }

  const existingCycle = await db.table('client_billing_cycles')
    .where({
      client_id: cycle.client_id,
      billing_profile_id: cycle.billing_profile_id,
      is_active: true,
      effective_date: effectiveDate
    })
    .first()
    .select('period_start_date', 'period_end_date');

  if (existingCycle) {
    const nextStart = existingCycle.period_end_date ? normalizeDbIsoUtcMidnight(existingCycle.period_end_date) : null;
    return {
      success: false,
      error: 'duplicate',
      message: 'A billing period for this start date already exists.',
      suggestedDate: nextStart ?? undefined
    };
  }

  const fullCycle: Partial<IClientContractLineCycle> = {
    ...cycle,
    effective_date: effectiveDate,
    period_start_date: periodStart,
    period_end_date: periodEnd
  };

  try {
    await db.table('client_billing_cycles').insert(fullCycle);
    return { success: true };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'constraint' in error &&
      (error as any).constraint === 'client_billing_cycles_client_id_effective_date_unique'
    ) {
      const nextDate = new Date(cycle.effective_date);
      nextDate.setDate(nextDate.getDate() + 1);
      return {
        success: false,
        error: 'duplicate',
        message: 'A billing period for this date already exists. Please select a different date.',
        suggestedDate: (nextDate.toISOString().split('T')[0] + 'T00:00:00Z') as ISO8601String
      };
    }
    throw error;
  }
}

function isDateObject(val: unknown): val is Date {
  return Object.prototype.toString.call(val) === '[object Date]';
}

function normalizeDbIsoUtcMidnight(value: unknown): ISO8601String {
  if (typeof value === 'string') {
    return ensureUtcMidnightIsoDate(value);
  }
  if (isDateObject(value)) {
    return ensureUtcMidnightIsoDate(value.toISOString());
  }
  return ensureUtcMidnightIsoDate(String(value));
}

// LEVERAGE: pattern billing-cycle-creation-copy — this function is a near-copy
// of packages/billing/src/lib/billing/createBillingCycles.ts (the two differ
// only in transaction handling and cadence replenishment). The per-profile
// change below therefore had to be written twice. A shared cycle-cadence layer
// underneath both would own it once.
export async function createClientContractLineCycles(
  knex: Knex,
  client: IClient,
  options: { manual?: boolean; effectiveDate?: string } = {}
): Promise<BillingCycleCreationResult> {
  if (!client.tenant) {
    return {
      success: false,
      error: 'db_error',
      message: 'Client tenant is required to create billing cycles.'
    };
  }

  const tenant = client.tenant;
  const defaultProfileId = await ensureClientDefaultBillingProfile(knex, tenant, client.client_id);
  const separatelyBilling = await listSeparatelyBillingProfiles(knex, tenant, client.client_id);

  // One pass per profile that produces its own invoice, plus always the
  // default. A client nobody has segmented gets exactly the cycles it has
  // today, because the default profile's pass is the only one.
  const passes = new Map<string, { billingProfileId: string; billingCycle: BillingCycleType }>();
  passes.set(defaultProfileId, {
    billingProfileId: defaultProfileId,
    billingCycle: client.billing_cycle as BillingCycleType,
  });
  for (const profile of separatelyBilling) {
    passes.set(profile.billing_profile_id, {
      billingProfileId: profile.billing_profile_id,
      billingCycle: (profile.billing_cycle ?? client.billing_cycle) as BillingCycleType,
    });
  }

  for (const pass of passes.values()) {
    const result = await createCyclesForBillingProfile(knex, client, pass, options);
    if (!result.success) {
      return result;
    }
  }
  return { success: true };
}

async function createCyclesForBillingProfile(
  knex: Knex,
  client: IClient,
  pass: { billingProfileId: string; billingCycle: BillingCycleType },
  options: { manual?: boolean; effectiveDate?: string }
): Promise<BillingCycleCreationResult> {
  const billingCycle = pass.billingCycle;
  const billingProfileId = pass.billingProfileId;
  const now = ensureUtcMidnightIsoDate(new Date().toISOString().split('T')[0] + 'T00:00:00Z');

  const anchorSettings = await loadClientAnchorSettings(knex, client, billingCycle);

  const db = tenantDb(knex, client.tenant!);
  const lastCycle = (await db.table('client_billing_cycles')
    .where({
      client_id: client.client_id,
      billing_profile_id: billingProfileId,
      is_active: true
    })
    .orderBy('period_start_date', 'desc')
    .first()
    .select('period_start_date', 'period_end_date')) as IClientContractLineCycle | undefined;

  const referenceDate = options.effectiveDate ? ensureUtcMidnightIsoDate(options.effectiveDate) : now;

  if (!lastCycle) {
    const initial = getStartOfCurrentCycle(referenceDate, billingCycle, anchorSettings);
    const initialResult = await createBillingCycle(knex, {
      client_id: client.client_id,
      billing_profile_id: billingProfileId,
      billing_cycle: billingCycle,
      effective_date: initial.effectiveDate,
      period_start_date: initial.periodStart,
      period_end_date: initial.periodEnd,
      tenant: client.tenant
    });

    if (!initialResult.success) {
      return initialResult;
    }

    if (options.manual) {
      return { success: true };
    }

    let start = initial.periodEnd;
    let iterations = 0;
    const MAX_ITERATIONS = 200;
    while (parseISO(start) <= parseISO(now) && iterations < MAX_ITERATIONS) {
      const end = getNextBillingBoundaryAfter(start, billingCycle, anchorSettings);
      const result = await createBillingCycle(knex, {
        client_id: client.client_id,
        billing_profile_id: billingProfileId,
        billing_cycle: billingCycle,
        effective_date: start,
        period_start_date: start,
        period_end_date: end,
        tenant: client.tenant
      });

      if (!result.success) {
        return result;
      }

      iterations++;
      start = end;
    }

    return { success: true };
  }

  if (!lastCycle.period_end_date) {
    return {
      success: false,
      error: 'db_error',
      message: 'Client has an active billing cycle without a period end date.'
    };
  }

  let start = normalizeDbIsoUtcMidnight(lastCycle.period_end_date);

  if (options.manual) {
    const end = getNextBillingBoundaryAfter(start, billingCycle, anchorSettings);
    return await createBillingCycle(knex, {
      client_id: client.client_id,
      billing_profile_id: billingProfileId,
      billing_cycle: billingCycle,
      effective_date: start,
      period_start_date: start,
      period_end_date: end,
      tenant: client.tenant
    });
  }

  let iterations = 0;
  const MAX_ITERATIONS = 200;
  while (parseISO(start) <= parseISO(now) && iterations < MAX_ITERATIONS) {
    const end = getNextBillingBoundaryAfter(start, billingCycle, anchorSettings);
    const result = await createBillingCycle(knex, {
      client_id: client.client_id,
      billing_profile_id: billingProfileId,
      billing_cycle: billingCycle,
      effective_date: start,
      period_start_date: start,
      period_end_date: end,
      tenant: client.tenant
    });

    if (!result.success) {
      return result;
    }

    iterations++;
    start = end;
  }

  return { success: true };
}

async function loadClientAnchorSettings(
  knex: Knex,
  client: IClient,
  billingCycle: BillingCycleType
): Promise<NormalizedBillingCycleAnchorSettings> {
  if (!client.tenant) {
    throw new Error('Client tenant is required to load billing anchor settings.');
  }

  const defaults = getAnchorDefaultsForCycle(billingCycle);
  const settings = await tenantDb(knex, client.tenant).table('client_billing_settings')
    .where({ client_id: client.client_id })
    .first()
    .select(
      'billing_cycle_anchor_day_of_month',
      'billing_cycle_anchor_month_of_year',
      'billing_cycle_anchor_day_of_week',
      'billing_cycle_anchor_reference_date'
    );

  return normalizeAnchorSettingsForCycle(billingCycle, {
    dayOfMonth: settings?.billing_cycle_anchor_day_of_month ?? defaults.dayOfMonth,
    monthOfYear: settings?.billing_cycle_anchor_month_of_year ?? defaults.monthOfYear,
    dayOfWeek: settings?.billing_cycle_anchor_day_of_week ?? defaults.dayOfWeek,
    referenceDate: settings?.billing_cycle_anchor_reference_date
      ? normalizeDbIsoUtcMidnight(settings.billing_cycle_anchor_reference_date)
      : defaults.referenceDate
  });
}

export { getNextCycleDate, getStartOfCurrentCycle };
