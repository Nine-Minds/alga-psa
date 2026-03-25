'use server'

import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';

import type { BillingCycleType } from '@alga-psa/types';
import type { ISO8601String } from '@alga-psa/types';
import {
  ensureUtcMidnightIsoDate,
  getAnchorDefaultsForCycle,
  getBillingPeriodForDate,
  getNextBillingBoundaryAfter,
  normalizeAnchorSettingsForCycle,
  validateAnchorSettingsForCycle,
  type BillingCycleAnchorSettingsInput,
  type NormalizedBillingCycleAnchorSettings
} from '../lib/billing/billingCycleAnchors';
import { withAuth } from '@alga-psa/auth';
import {
  CLIENT_CADENCE_SCHEDULE_CONTEXT,
  type ClientCadenceScheduleContext
} from '@shared/billingClients/clientCadenceScheduleContext';
import { ensureClientBillingSettingsRow } from '@shared/billingClients/billingSettings';
import { regenerateClientCadenceServicePeriodsForScheduleChange } from './clientCadenceScheduleRegeneration';

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

export type ClientBillingCycleAnchorConfig = {
  billingCycle: BillingCycleType;
  anchor: NormalizedBillingCycleAnchorSettings;
  cadenceContext: ClientCadenceScheduleContext;
};

export const getClientBillingCycleAnchor = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<ClientBillingCycleAnchorConfig> => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const client = await trx('clients')
      .where({ tenant, client_id: clientId })
      .first()
      .select('billing_cycle');
    if (!client) {
      throw new Error('Client not found');
    }

    const settings = await trx('client_billing_settings')
      .where({ tenant, client_id: clientId })
      .first()
      .select(
        'billing_cycle_anchor_day_of_month',
        'billing_cycle_anchor_month_of_year',
        'billing_cycle_anchor_day_of_week',
        'billing_cycle_anchor_reference_date'
      );

    const billingCycle = (client.billing_cycle ?? 'monthly') as BillingCycleType;
    const normalized = normalizeAnchorSettingsForCycle(billingCycle, {
      dayOfMonth: settings?.billing_cycle_anchor_day_of_month ?? null,
      monthOfYear: settings?.billing_cycle_anchor_month_of_year ?? null,
      dayOfWeek: settings?.billing_cycle_anchor_day_of_week ?? null,
      referenceDate: settings?.billing_cycle_anchor_reference_date
        ? normalizeDbIsoUtcMidnight(settings.billing_cycle_anchor_reference_date)
        : null
    });

    return {
      billingCycle,
      anchor: normalized,
      cadenceContext: CLIENT_CADENCE_SCHEDULE_CONTEXT
    } satisfies ClientBillingCycleAnchorConfig;
  });

  return result;
});

export type UpdateClientBillingCycleAnchorInput = {
  clientId: string;
  billingCycle: BillingCycleType;
  anchor: BillingCycleAnchorSettingsInput;
};

export const updateClientBillingCycleAnchor = withAuth(async (
  user,
  { tenant },
  input: UpdateClientBillingCycleAnchorInput
): Promise<{ success: true }> => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Ensure client exists and cycle matches what the UI is editing.
    const client = await trx('clients')
      .where({ tenant, client_id: input.clientId })
      .first()
      .select('billing_cycle');
    if (!client) {
      throw new Error('Client not found');
    }

    const billingCycle = input.billingCycle;
    validateAnchorSettingsForCycle(billingCycle, input.anchor);
    const normalized = normalizeAnchorSettingsForCycle(billingCycle, input.anchor);

    await ensureClientBillingSettingsRow(trx, {
      tenant,
      clientId: input.clientId
    });

    await trx('client_billing_settings')
      .where({ tenant, client_id: input.clientId })
      .update({
        billing_cycle_anchor_day_of_month: normalized.dayOfMonth,
        billing_cycle_anchor_month_of_year: normalized.monthOfYear,
        billing_cycle_anchor_day_of_week: normalized.dayOfWeek,
        billing_cycle_anchor_reference_date: normalized.referenceDate,
        updated_at: trx.fn.now()
      });

    await regenerateClientCadenceServicePeriodsForScheduleChange(trx, {
      tenant,
      clientId: input.clientId,
      billingCycle,
      anchor: normalized,
    });
  });

  return { success: true };
});

export type BillingCyclePeriodPreview = {
  periodStartDate: ISO8601String;
  periodEndDate: ISO8601String;
};

export type BillingCyclePeriodPreviewResult = {
  cadenceContext: ClientCadenceScheduleContext;
  periods: BillingCyclePeriodPreview[];
};

export const previewBillingPeriodsForSchedule = withAuth(async (
  user,
  { tenant },
  billingCycle: BillingCycleType,
  anchor: BillingCycleAnchorSettingsInput,
  options: { count?: number; referenceDate?: ISO8601String } = {}
): Promise<BillingCyclePeriodPreviewResult> => {
  validateAnchorSettingsForCycle(billingCycle, anchor);
  const normalized = normalizeAnchorSettingsForCycle(billingCycle, anchor);

  const count = Math.max(1, Math.min(options.count ?? 3, 12));
  const referenceDate = ensureUtcMidnightIsoDate(
    options.referenceDate ?? (new Date().toISOString().split('T')[0] + 'T00:00:00Z')
  );

  const firstPeriod = getBillingPeriodForDate(referenceDate, billingCycle, normalized);
  const periods: BillingCyclePeriodPreview[] = [
    { periodStartDate: firstPeriod.periodStartDate, periodEndDate: firstPeriod.periodEndDate }
  ];

  for (let i = 1; i < count; i++) {
    const previous = periods[periods.length - 1];
    const nextEnd = getNextBillingBoundaryAfter(previous.periodStartDate, billingCycle, normalized);
    const nextNext = getNextBillingBoundaryAfter(nextEnd, billingCycle, normalized);
    periods.push({ periodStartDate: nextEnd, periodEndDate: nextNext });
  }

  return {
    cadenceContext: CLIENT_CADENCE_SCHEDULE_CONTEXT,
    periods
  };
});

export const previewClientBillingPeriods = withAuth(async (
  user,
  { tenant },
  clientId: string,
  options: { count?: number; referenceDate?: ISO8601String } = {}
): Promise<BillingCyclePeriodPreviewResult> => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  const count = Math.max(1, Math.min(options.count ?? 3, 12));
  const referenceDate = ensureUtcMidnightIsoDate(
    options.referenceDate ?? (new Date().toISOString().split('T')[0] + 'T00:00:00Z')
  );

  const config = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const client = await trx('clients')
      .where({ tenant, client_id: clientId })
      .first()
      .select('billing_cycle');
    if (!client) {
      throw new Error('Client not found');
    }

    const settings = await trx('client_billing_settings')
      .where({ tenant, client_id: clientId })
      .first()
      .select(
        'billing_cycle_anchor_day_of_month',
        'billing_cycle_anchor_month_of_year',
        'billing_cycle_anchor_day_of_week',
        'billing_cycle_anchor_reference_date'
      );

    const billingCycle = (client.billing_cycle ?? 'monthly') as BillingCycleType;
    const defaults = getAnchorDefaultsForCycle(billingCycle);
    const normalized = normalizeAnchorSettingsForCycle(billingCycle, {
      dayOfMonth: settings?.billing_cycle_anchor_day_of_month ?? defaults.dayOfMonth,
      monthOfYear: settings?.billing_cycle_anchor_month_of_year ?? defaults.monthOfYear,
      dayOfWeek: settings?.billing_cycle_anchor_day_of_week ?? defaults.dayOfWeek,
      referenceDate: settings?.billing_cycle_anchor_reference_date
        ? normalizeDbIsoUtcMidnight(settings.billing_cycle_anchor_reference_date)
        : defaults.referenceDate
    });

    return { billingCycle, anchor: normalized } as const;
  });

  const firstPeriod = getBillingPeriodForDate(referenceDate, config.billingCycle, config.anchor);
  const periods: BillingCyclePeriodPreview[] = [
    { periodStartDate: firstPeriod.periodStartDate, periodEndDate: firstPeriod.periodEndDate }
  ];

  for (let i = 1; i < count; i++) {
    const previous = periods[periods.length - 1];
    const nextEnd = getNextBillingBoundaryAfter(previous.periodStartDate, config.billingCycle, config.anchor);
    const nextNext = getNextBillingBoundaryAfter(nextEnd, config.billingCycle, config.anchor);
    periods.push({ periodStartDate: nextEnd, periodEndDate: nextNext });
  }

  return {
    cadenceContext: CLIENT_CADENCE_SCHEDULE_CONTEXT,
    periods
  };
});

export { ensureClientBillingSettingsRow };
