import type { Knex } from 'knex';
import type { BillingCycleType, ISO8601String, IClient } from '@alga-psa/types';
import {
  ensureUtcMidnightIsoDate,
  getAnchorDefaultsForCycle,
  getBillingPeriodForDate,
  getNextBillingBoundaryAfter,
  normalizeAnchorSettingsForCycle,
  validateAnchorSettingsForCycle,
  type BillingCycleAnchorSettingsInput,
  type NormalizedBillingCycleAnchorSettings
} from './billingCycleAnchors';
import { createClientContractLineCycles, type BillingCycleCreationResult } from './createBillingCycles';

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

export async function getClientBillingCycleAnchor(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<ClientBillingCycleAnchorConfig> {
  const client = await knexOrTrx('clients').where({ tenant, client_id: clientId }).first().select('billing_cycle');
  if (!client) {
    throw new Error('Client not found');
  }

  const settings = await knexOrTrx('client_billing_settings')
    .where({ tenant, client_id: clientId })
    .first()
    .select(
      'billing_cycle_anchor_day_of_month',
      'billing_cycle_anchor_month_of_year',
      'billing_cycle_anchor_day_of_week',
      'billing_cycle_anchor_reference_date'
    );

  const billingCycle = ((client as any).billing_cycle ?? 'monthly') as BillingCycleType;
  const normalized = normalizeAnchorSettingsForCycle(billingCycle, {
    dayOfMonth: settings?.billing_cycle_anchor_day_of_month ?? null,
    monthOfYear: settings?.billing_cycle_anchor_month_of_year ?? null,
    dayOfWeek: settings?.billing_cycle_anchor_day_of_week ?? null,
    referenceDate: settings?.billing_cycle_anchor_reference_date
      ? normalizeDbIsoUtcMidnight(settings.billing_cycle_anchor_reference_date)
      : null
  });

  return { billingCycle, anchor: normalized };
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

export type UpdateClientBillingScheduleInput = {
  clientId: string;
  billingCycle: BillingCycleType;
  anchor: BillingCycleAnchorSettingsInput;
};

export async function updateClientBillingSchedule(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  input: UpdateClientBillingScheduleInput
): Promise<void> {
  validateAnchorSettingsForCycle(input.billingCycle, input.anchor);
  const normalized = normalizeAnchorSettingsForCycle(input.billingCycle, input.anchor);

  if (isKnexTransaction(knexOrTrx)) {
    await updateInTransaction(knexOrTrx, tenant, input, normalized);
    return;
  }

  await (knexOrTrx as Knex).transaction(async (trx) => {
    await updateInTransaction(trx, tenant, input, normalized);
  });
}

async function updateInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  input: UpdateClientBillingScheduleInput,
  normalized: NormalizedBillingCycleAnchorSettings
): Promise<void> {
  const client = await trx('clients').where({ tenant, client_id: input.clientId }).first().select('client_id', 'billing_cycle');
  if (!client) {
    throw new Error('Client not found');
  }

  if (((client as any).billing_cycle ?? 'monthly') !== input.billingCycle) {
    await trx('clients')
      .where({ tenant, client_id: input.clientId })
      .update({ billing_cycle: input.billingCycle, updated_at: trx.fn.now() });
  }

  await ensureClientBillingSettingsRow(trx, { tenant, clientId: input.clientId });

  await trx('client_billing_settings')
    .where({ tenant, client_id: input.clientId })
    .update({
      billing_cycle_anchor_day_of_month: normalized.dayOfMonth,
      billing_cycle_anchor_month_of_year: normalized.monthOfYear,
      billing_cycle_anchor_day_of_week: normalized.dayOfWeek,
      billing_cycle_anchor_reference_date: normalized.referenceDate,
      updated_at: trx.fn.now()
    });

  const lastInvoiced = await trx('client_billing_cycles as cbc')
    .join('invoices as i', function () {
      this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id').andOn('i.tenant', '=', 'cbc.tenant');
    })
    .where('cbc.tenant', tenant)
    .andWhere('cbc.client_id', input.clientId)
    .orderBy('cbc.period_end_date', 'desc')
    .first()
    .select('cbc.period_end_date');

  const cutoverStart: ISO8601String | null = lastInvoiced?.period_end_date ? normalizeDbIsoUtcMidnight(lastInvoiced.period_end_date) : null;

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
}

export type BillingCyclePeriodPreview = {
  periodStartDate: ISO8601String;
  periodEndDate: ISO8601String;
};

export function previewBillingPeriodsForSchedule(
  billingCycle: BillingCycleType,
  anchor: BillingCycleAnchorSettingsInput,
  options: { count?: number; referenceDate?: ISO8601String } = {}
): BillingCyclePeriodPreview[] {
  validateAnchorSettingsForCycle(billingCycle, anchor);
  const normalized = normalizeAnchorSettingsForCycle(billingCycle, anchor);

  const count = Math.max(1, Math.min(options.count ?? 3, 12));
  const referenceDate = ensureUtcMidnightIsoDate(
    options.referenceDate ?? (new Date().toISOString().split('T')[0] + 'T00:00:00Z')
  );

  const firstPeriod = getBillingPeriodForDate(referenceDate, billingCycle, normalized);
  const periods: BillingCyclePeriodPreview[] = [{ periodStartDate: firstPeriod.periodStartDate, periodEndDate: firstPeriod.periodEndDate }];

  for (let i = 1; i < count; i++) {
    const previous = periods[periods.length - 1];
    const nextEnd = getNextBillingBoundaryAfter(previous.periodStartDate, billingCycle, normalized);
    const nextNext = getNextBillingBoundaryAfter(nextEnd, billingCycle, normalized);
    periods.push({ periodStartDate: nextEnd, periodEndDate: nextNext });
  }

  return periods;
}

export async function createNextBillingCycle(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  effectiveDate?: string
): Promise<BillingCycleCreationResult> {
  const client = await knexOrTrx<IClient>('clients').where({ client_id: clientId, tenant }).first();
  if (!client) {
    throw new Error('Client not found');
  }
  return createClientContractLineCycles(knexOrTrx as any, client as IClient, { manual: true, effectiveDate });
}

function isKnexTransaction(knexOrTrx: Knex | Knex.Transaction): knexOrTrx is Knex.Transaction {
  return typeof (knexOrTrx as any).commit === 'function' && typeof (knexOrTrx as any).rollback === 'function';
}

