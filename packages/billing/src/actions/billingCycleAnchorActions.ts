'use server'

import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from 'server/src/lib/db';
import { getSession } from 'server/src/lib/auth/getSession';
import type { BillingCycleType } from 'server/src/interfaces/billing.interfaces';
import type { ISO8601String } from 'server/src/types/types.d';
import {
  ensureUtcMidnightIsoDate,
  getAnchorDefaultsForCycle,
  getBillingPeriodForDate,
  getNextBillingBoundaryAfter,
  normalizeAnchorSettingsForCycle,
  validateAnchorSettingsForCycle,
  type BillingCycleAnchorSettingsInput,
  type NormalizedBillingCycleAnchorSettings
} from 'server/src/lib/billing/billingCycleAnchors';

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
};

export async function getClientBillingCycleAnchor(clientId: string): Promise<ClientBillingCycleAnchorConfig> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();
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

    return { billingCycle, anchor: normalized } satisfies ClientBillingCycleAnchorConfig;
  });

  return result;
}

export type UpdateClientBillingCycleAnchorInput = {
  clientId: string;
  billingCycle: BillingCycleType;
  anchor: BillingCycleAnchorSettingsInput;
};

export async function updateClientBillingCycleAnchor(
  input: UpdateClientBillingCycleAnchorInput
): Promise<{ success: true }> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();
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

    // Anchor changes should not retroactively affect already-invoiced periods.
    // To make sure newly generated cycles reflect the updated anchor, deactivate any
    // future, non-invoiced cycles at/after the cutover start.
    const lastInvoiced = await trx('client_billing_cycles as cbc')
      .join('invoices as i', function () {
        this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id').andOn('i.tenant', '=', 'cbc.tenant');
      })
      .where('cbc.tenant', tenant)
      .andWhere('cbc.client_id', input.clientId)
      .orderBy('cbc.period_end_date', 'desc')
      .first()
      .select('cbc.period_end_date');

    const cutoverStart: ISO8601String | null = lastInvoiced?.period_end_date
      ? normalizeDbIsoUtcMidnight(lastInvoiced.period_end_date)
      : null;

    const nonInvoicedCycleQuery = trx('client_billing_cycles')
      .where({ tenant, client_id: input.clientId, is_active: true })
      .whereNotExists(function () {
        this.select(1)
          .from('invoices')
          .whereRaw('invoices.tenant = client_billing_cycles.tenant')
          .andWhereRaw('invoices.billing_cycle_id = client_billing_cycles.billing_cycle_id');
      });

    if (cutoverStart) {
      await nonInvoicedCycleQuery.andWhere('period_start_date', '>=', cutoverStart).update({
        is_active: false,
        updated_at: trx.fn.now()
      });
    } else {
      await nonInvoicedCycleQuery.update({
        is_active: false,
        updated_at: trx.fn.now()
      });
    }
  });

  return { success: true };
}

export type BillingCyclePeriodPreview = {
  periodStartDate: ISO8601String;
  periodEndDate: ISO8601String;
};

export async function previewBillingPeriodsForSchedule(
  billingCycle: BillingCycleType,
  anchor: BillingCycleAnchorSettingsInput,
  options: { count?: number; referenceDate?: ISO8601String } = {}
): Promise<BillingCyclePeriodPreview[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

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

  return periods;
}

export async function previewClientBillingPeriods(
  clientId: string,
  options: { count?: number; referenceDate?: ISO8601String } = {}
): Promise<BillingCyclePeriodPreview[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();
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

  return periods;
}

async function ensureClientBillingSettingsRow(
  trx: Knex.Transaction,
  params: { tenant: string; clientId: string }
): Promise<void> {
  const existing = await trx('client_billing_settings')
    .where({ tenant: params.tenant, client_id: params.clientId })
    .first()
    .select('client_id');
  if (existing) return;

  const defaults = await trx('default_billing_settings')
    .where({ tenant: params.tenant })
    .first()
    .select(
      'zero_dollar_invoice_handling',
      'suppress_zero_dollar_invoices',
      'credit_expiration_days',
      'credit_expiration_notification_days',
      'enable_credit_expiration'
    );

  await trx('client_billing_settings').insert({
    tenant: params.tenant,
    client_id: params.clientId,
    zero_dollar_invoice_handling: defaults?.zero_dollar_invoice_handling ?? 'normal',
    suppress_zero_dollar_invoices: defaults?.suppress_zero_dollar_invoices ?? false,
    credit_expiration_days: defaults?.credit_expiration_days ?? 365,
    credit_expiration_notification_days: defaults?.credit_expiration_notification_days ?? [30, 7, 1],
    enable_credit_expiration: defaults?.enable_credit_expiration ?? true,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });
}

export { ensureClientBillingSettingsRow };
