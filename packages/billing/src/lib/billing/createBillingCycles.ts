import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { Temporal } from '@js-temporal/polyfill';
import type { IClientContractLineCycle, IClient, ISO8601String, BillingCycleType } from '@alga-psa/types';
import { parseISO } from 'date-fns';
import { replenishClientCadenceServicePeriods } from '@alga-psa/shared/billingClients/clientCadenceScheduleRegeneration';
import { ensureClientDefaultBillingProfile } from '@alga-psa/shared/billingClients/billingProfiles';
import { listSeparatelyBillingProfiles } from '@alga-psa/shared/billingClients/billingProfileSettings';
import {
  ensureUtcMidnightIsoDate,
  getAnchorDefaultsForCycle,
  getBillingPeriodForDate,
  getNextBillingBoundaryAfter,
  normalizeAnchorSettingsForCycle,
  type NormalizedBillingCycleAnchorSettings
} from './billingCycleAnchors';

type ClientBillingAnchorSettingsRow = {
  tenant: string;
  client_id: string;
  billing_cycle_anchor_day_of_month: number | null;
  billing_cycle_anchor_month_of_year: number | null;
  billing_cycle_anchor_day_of_week: number | null;
  billing_cycle_anchor_reference_date: unknown | null;
};

/**
 * Result type for billing cycle creation.
 */
export type BillingCycleCreationResult = {
  success: boolean;
  error?: 'duplicate' | 'invalid_date' | 'db_error';
  message?: string;
  suggestedDate?: ISO8601String;
};

class BillingCycleCreationAbort extends Error {
  constructor(readonly result: BillingCycleCreationResult) {
    super(result.message);
    this.name = 'BillingCycleCreationAbort';
  }
}

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
  knex: Knex,
  cycle: Partial<IClientContractLineCycle> & {
    effective_date: ISO8601String;
    period_start_date: ISO8601String;
    period_end_date: ISO8601String;
    /**
     * The profile this cycle bills. Required since S8: a cycle without one
     * could not say whose invoice it produces, and every overlap and duplicate
     * check below is scoped to it — two profiles of one client are *supposed*
     * to have cycles covering the same month.
     */
    billing_profile_id: string;
  }
): Promise<BillingCycleCreationResult> {
  const tenant = cycle.tenant;
  if (!tenant) {
    return {
      success: false,
      error: 'db_error',
      message: 'Client tenant is required to create a billing cycle.'
    };
  }

  const db = tenantDb(knex, tenant);
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

  // Overlap check under [start, end) semantics. Touching boundaries are allowed.
  const overlap = await db.table('client_billing_cycles')
    .where({
      client_id: cycle.client_id,
      billing_profile_id: cycle.billing_profile_id,
      tenant,
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

  // Check for exact start-date duplicates (more user-friendly than relying on insert failure).
  const existingCycle = await db.table('client_billing_cycles')
    .where({
      client_id: cycle.client_id,
      billing_profile_id: cycle.billing_profile_id,
      effective_date: effectiveDate,
      tenant,
      is_active: true
    })
    .first()
    .select('period_end_date');

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
    console.log(`Created billing cycle for client ${cycle.client_id} profile ${cycle.billing_profile_id} from ${fullCycle.period_start_date} to ${fullCycle.period_end_date}`);
    return { success: true };
  } catch (error: unknown) {
    if (error instanceof Error && 'constraint' in error && error.constraint === 'client_billing_cycles_client_id_effective_date_unique') {
      // Handle race condition - another cycle was created between our check and insert
      const nextDate = new Date(cycle.effective_date);
      nextDate.setDate(nextDate.getDate() + 1);
      throw new BillingCycleCreationAbort({
        success: false,
        error: 'duplicate',
        message: 'A billing period for this date already exists. Please select a different date.',
        suggestedDate: nextDate.toISOString().split('T')[0] + 'T00:00:00Z'
      });
    }
    console.error(`Error creating billing cycle:`, error);
    throw error;
  }
}

/**
 * Type guard to check if a value is a Date object.
 */
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

/**
 * Billing cycles for one client (F093, F097).
 *
 * Runs the existing single-client cycle pass **once per billing profile that
 * bills separately**, plus always for the client's default profile. A client
 * nobody has segmented therefore gets exactly the cycles it has today: the
 * default profile's pass produces them, and there is no second profile to
 * produce more.
 *
 * Per-profile billing frequency comes free from this shape (F097) — a profile
 * with its own `billing_cycle` runs its pass on that cadence, which is what
 * franchise-shape customers want when they stagger billing dates per site.
 */
export async function createClientContractLineCycles(
  knex: Knex,
  client: IClient,
  options: { manual?: boolean; effectiveDate?: string } = {}
): Promise<BillingCycleCreationResult> {
  const tenant = client.tenant;
  if (!tenant) {
    return {
      success: false,
      error: 'db_error',
      message: 'Client tenant is required to create billing cycles.'
    };
  }

  const defaultProfileId = await ensureClientDefaultBillingProfile(knex, tenant, client.client_id);
  const separatelyBilling = await listSeparatelyBillingProfiles(knex, tenant, client.client_id);

  // The default profile always gets a pass; separately-billing profiles get
  // their own. The default may itself be marked separately-billing, so the map
  // deduplicates rather than concatenating.
  const passes = new Map<string, { billingProfileId: string; billingCycle: BillingCycleType }>();
  passes.set(defaultProfileId, {
    billingProfileId: defaultProfileId,
    billingCycle: client.billing_cycle as BillingCycleType,
  });
  for (const profile of separatelyBilling) {
    passes.set(profile.billing_profile_id, {
      billingProfileId: profile.billing_profile_id,
      // NULL means inherit the client's cadence, like every other profile field.
      billingCycle: (profile.billing_cycle ?? client.billing_cycle) as BillingCycleType,
    });
  }

  for (const pass of passes.values()) {
    const result = await createCyclesForBillingProfile(knex, client, tenant, pass, options);
    // One profile failing must not silently leave the others unbilled, so the
    // first failure is reported rather than swallowed.
    if (!result.success) {
      return result;
    }
  }
  return { success: true };
}

async function createCyclesForBillingProfile(
  knex: Knex,
  client: IClient,
  tenant: string,
  pass: { billingProfileId: string; billingCycle: BillingCycleType },
  options: { manual?: boolean; effectiveDate?: string }
): Promise<BillingCycleCreationResult> {
  const billingCycle = pass.billingCycle;
  const billingProfileId = pass.billingProfileId;
  const now = ensureUtcMidnightIsoDate(new Date().toISOString().split('T')[0] + 'T00:00:00Z');

  return withTransaction<BillingCycleCreationResult>(knex, async (trx) => {
    const anchorSettings = await loadClientAnchorSettings(trx, client, billingCycle);
    const db = tenantDb(trx, tenant);

    const finishSuccessfulPass = async (): Promise<BillingCycleCreationResult> => {
      await replenishClientCadenceServicePeriods(trx, {
        tenant,
        clientId: client.client_id,
        billingCycle,
        anchor: anchorSettings
      });
      return { success: true };
    };

    const lastCycle = await db.table('client_billing_cycles')
      .where({
        client_id: client.client_id,
        billing_profile_id: billingProfileId,
        tenant,
        is_active: true
      })
      .orderBy('period_start_date', 'desc')
      .first()
      .select('period_start_date', 'period_end_date') as IClientContractLineCycle | undefined;

    const referenceDate = options.effectiveDate ? ensureUtcMidnightIsoDate(options.effectiveDate) : now;

    if (!lastCycle) {
      const initial = getStartOfCurrentCycle(referenceDate, billingCycle, anchorSettings);
      const initialResult = await createBillingCycle(trx, {
        client_id: client.client_id,
        billing_profile_id: billingProfileId,
        billing_cycle: billingCycle,
        effective_date: initial.effectiveDate,
        period_start_date: initial.periodStart,
        period_end_date: initial.periodEnd,
        tenant
      });

      if (!initialResult.success) {
        return initialResult;
      }

      if (options.manual) {
        return finishSuccessfulPass();
      }

      // Backfill additional cycles until we cover "now" (i.e., lastEnd > now).
      let start = initial.periodEnd;
      let iterations = 0;
      const MAX_ITERATIONS = 200;
      while (parseISO(start) <= parseISO(now) && iterations < MAX_ITERATIONS) {
        const end = getNextBillingBoundaryAfter(start, billingCycle, anchorSettings);
        const result = await createBillingCycle(trx, {
          client_id: client.client_id,
          billing_profile_id: billingProfileId,
          billing_cycle: billingCycle,
          effective_date: start,
          period_start_date: start,
          period_end_date: end,
          tenant
        });

        if (!result.success) {
          return result;
        }

        iterations++;
        start = end;
      }

      return finishSuccessfulPass();
    }

    if (!lastCycle.period_end_date) {
      return {
        success: false,
        error: 'db_error',
        message: 'Client has an active billing cycle without a period end date.'
      };
    }

    // Next cycle starts at the last cycle's exclusive end boundary.
    let start = normalizeDbIsoUtcMidnight(lastCycle.period_end_date);

    if (options.manual) {
      // Manual mode creates exactly one cycle (including a transition period if start isn't aligned).
      const end = getNextBillingBoundaryAfter(start, billingCycle, anchorSettings);
      const result = await createBillingCycle(trx, {
        client_id: client.client_id,
        billing_profile_id: billingProfileId,
        billing_cycle: billingCycle,
        effective_date: start,
        period_start_date: start,
        period_end_date: end,
        tenant
      });
      return result.success ? finishSuccessfulPass() : result;
    }

    // Automatic mode backfills until we cover "now".
    let iterations = 0;
    const MAX_ITERATIONS = 200;
    while (parseISO(start) <= parseISO(now) && iterations < MAX_ITERATIONS) {
      const end = getNextBillingBoundaryAfter(start, billingCycle, anchorSettings);
      const result = await createBillingCycle(trx, {
        client_id: client.client_id,
        billing_profile_id: billingProfileId,
        billing_cycle: billingCycle,
        effective_date: start,
        period_start_date: start,
        period_end_date: end,
        tenant
      });

      if (!result.success) {
        return result;
      }

      iterations++;
      start = end;
    }

    return finishSuccessfulPass();
  }).catch((error: unknown) => {
    if (error instanceof BillingCycleCreationAbort) {
      return error.result;
    }
    throw error;
  });
}

async function loadClientAnchorSettings(
  knex: Knex,
  client: IClient,
  billingCycle: BillingCycleType
): Promise<NormalizedBillingCycleAnchorSettings> {
  const defaults = getAnchorDefaultsForCycle(billingCycle);
  const tenant = client.tenant;
  if (!tenant) {
    throw new Error('Client tenant is required to load billing anchor settings');
  }

  const settings = await tenantDb(knex, tenant).table<ClientBillingAnchorSettingsRow>('client_billing_settings')
    .where('client_id', client.client_id)
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
