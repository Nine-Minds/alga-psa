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
import {
  CLIENT_CADENCE_SCHEDULE_CONTEXT,
  type ClientCadenceScheduleContext,
} from './clientCadenceScheduleContext';
import { ensureClientBillingSettingsRow } from './billingSettings';

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

  return {
    billingCycle,
    anchor: normalized,
    cadenceContext: CLIENT_CADENCE_SCHEDULE_CONTEXT,
  };
}

export type UpdateClientBillingScheduleInput = {
  clientId: string;
  billingCycle: BillingCycleType;
  anchor: BillingCycleAnchorSettingsInput;
  billingHistoryStartDate?: ISO8601String | null;
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

  if (input.billingHistoryStartDate) {
    await regenerateHistoricalClientBillingCyclesFromBootstrap(trx, {
      tenant,
      clientId: input.clientId,
      billingCycle: input.billingCycle,
      anchor: normalized,
      billingHistoryStartDate: input.billingHistoryStartDate,
    });
    return;
  }

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

function normalizeIsoDateOnly(value: ISO8601String): ISO8601String {
  return `${value.slice(0, 10)}T00:00:00Z` as ISO8601String;
}

function getTodayUtcMidnightIso(): ISO8601String {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00Z` as ISO8601String;
}

function resolveNormalizedBootstrapBoundary(input: {
  billingHistoryStartDate: ISO8601String;
  billingCycle: BillingCycleType;
  anchor: NormalizedBillingCycleAnchorSettings;
}): ISO8601String {
  const requested = ensureUtcMidnightIsoDate(input.billingHistoryStartDate);
  const containingPeriod = getBillingPeriodForDate(requested, input.billingCycle, input.anchor);
  return normalizeIsoDateOnly(containingPeriod.periodStartDate);
}

export type BillingHistoryBootstrapPreview = {
  requestedHistoryStartDate: ISO8601String;
  normalizedHistoryStartBoundary: ISO8601String;
  earliestInvoicedCycleStartBoundary: ISO8601String | null;
  status: 'eligible' | 'blocked_invoiced_history';
  blockedReason: string | null;
  affectedUninvoicedCycleCount: number;
};

export async function previewBillingHistoryBootstrap(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  input: {
    clientId: string;
    billingCycle: BillingCycleType;
    anchor: BillingCycleAnchorSettingsInput;
    billingHistoryStartDate: ISO8601String;
  },
): Promise<BillingHistoryBootstrapPreview> {
  validateAnchorSettingsForCycle(input.billingCycle, input.anchor);
  const normalizedAnchor = normalizeAnchorSettingsForCycle(input.billingCycle, input.anchor);
  const normalizedBoundary = resolveNormalizedBootstrapBoundary({
    billingHistoryStartDate: input.billingHistoryStartDate,
    billingCycle: input.billingCycle,
    anchor: normalizedAnchor,
  });

  const earliestInvoiced = await knexOrTrx('client_billing_cycles as cbc')
    .join('invoices as i', function () {
      this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id').andOn('i.tenant', '=', 'cbc.tenant');
    })
    .where('cbc.tenant', tenant)
    .andWhere('cbc.client_id', input.clientId)
    .orderBy('cbc.period_start_date', 'asc')
    .first()
    .select('cbc.period_start_date');

  const earliestInvoicedBoundary = earliestInvoiced?.period_start_date
    ? normalizeDbIsoUtcMidnight(earliestInvoiced.period_start_date)
    : null;

  const affectedUninvoicedRows = await knexOrTrx('client_billing_cycles')
    .where({ tenant, client_id: input.clientId })
    .andWhere('period_start_date', '>=', normalizedBoundary)
    .whereNotExists(function () {
      this.select(1)
        .from('invoices')
        .whereRaw('invoices.tenant = client_billing_cycles.tenant')
        .andWhereRaw('invoices.billing_cycle_id = client_billing_cycles.billing_cycle_id');
    })
    .count<{ count: number | string }>('billing_cycle_id as count')
    .first();

  if (earliestInvoicedBoundary && normalizedBoundary < earliestInvoicedBoundary) {
    return {
      requestedHistoryStartDate: ensureUtcMidnightIsoDate(input.billingHistoryStartDate),
      normalizedHistoryStartBoundary: normalizedBoundary,
      earliestInvoicedCycleStartBoundary: earliestInvoicedBoundary,
      status: 'blocked_invoiced_history',
      blockedReason:
        `Cannot move billing history earlier than invoiced history boundary (${earliestInvoicedBoundary.slice(0, 10)}).`,
      affectedUninvoicedCycleCount: Number(affectedUninvoicedRows?.count ?? 0),
    };
  }

  return {
    requestedHistoryStartDate: ensureUtcMidnightIsoDate(input.billingHistoryStartDate),
    normalizedHistoryStartBoundary: normalizedBoundary,
    earliestInvoicedCycleStartBoundary: earliestInvoicedBoundary,
    status: 'eligible',
    blockedReason: null,
    affectedUninvoicedCycleCount: Number(affectedUninvoicedRows?.count ?? 0),
  };
}

async function regenerateHistoricalClientBillingCyclesFromBootstrap(
  trx: Knex.Transaction,
  input: {
    tenant: string;
    clientId: string;
    billingCycle: BillingCycleType;
    anchor: NormalizedBillingCycleAnchorSettings;
    billingHistoryStartDate: ISO8601String;
  },
): Promise<void> {
  const preview = await previewBillingHistoryBootstrap(trx, input.tenant, {
    clientId: input.clientId,
    billingCycle: input.billingCycle,
    anchor: input.anchor,
    billingHistoryStartDate: input.billingHistoryStartDate,
  });

  if (preview.status === 'blocked_invoiced_history') {
    throw new Error(preview.blockedReason ?? 'Billing history bootstrap is blocked by invoiced history.');
  }

  await trx('client_billing_cycles')
    .where({ tenant: input.tenant, client_id: input.clientId })
    .andWhere('period_start_date', '>=', preview.normalizedHistoryStartBoundary)
    .whereNotExists(function () {
      this.select(1)
        .from('invoices')
        .whereRaw('invoices.tenant = client_billing_cycles.tenant')
        .andWhereRaw('invoices.billing_cycle_id = client_billing_cycles.billing_cycle_id');
    })
    .del();

  const today = getTodayUtcMidnightIso();
  let cursor = preview.normalizedHistoryStartBoundary;

  while (cursor <= today) {
    const nextBoundary = normalizeIsoDateOnly(
      getNextBillingBoundaryAfter(cursor, input.billingCycle, input.anchor),
    );

    const existingInvoicedCycle = await trx('client_billing_cycles as cbc')
      .join('invoices as i', function () {
        this.on('i.billing_cycle_id', '=', 'cbc.billing_cycle_id').andOn('i.tenant', '=', 'cbc.tenant');
      })
      .where('cbc.tenant', input.tenant)
      .andWhere('cbc.client_id', input.clientId)
      .andWhere('cbc.period_start_date', cursor)
      .first('cbc.billing_cycle_id');

    if (!existingInvoicedCycle) {
      const existingCycle = await trx('client_billing_cycles')
        .where({
          tenant: input.tenant,
          client_id: input.clientId,
          period_start_date: cursor,
        })
        .first('billing_cycle_id');

      if (!existingCycle) {
        await trx('client_billing_cycles').insert({
          tenant: input.tenant,
          client_id: input.clientId,
          billing_cycle: input.billingCycle,
          effective_date: cursor,
          period_start_date: cursor,
          period_end_date: nextBoundary,
          is_active: true,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });
      }
    }

    cursor = nextBoundary;
  }
}

export type BillingCyclePeriodPreview = {
  periodStartDate: ISO8601String;
  periodEndDate: ISO8601String;
};

export type BillingCyclePeriodPreviewResult = {
  cadenceContext: ClientCadenceScheduleContext;
  periods: BillingCyclePeriodPreview[];
};

export function previewBillingPeriodsForSchedule(
  billingCycle: BillingCycleType,
  anchor: BillingCycleAnchorSettingsInput,
  options: { count?: number; referenceDate?: ISO8601String } = {}
): BillingCyclePeriodPreviewResult {
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

  return {
    cadenceContext: CLIENT_CADENCE_SCHEDULE_CONTEXT,
    periods,
  };
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
  if (!effectiveDate) {
    return createClientContractLineCycles(knexOrTrx as any, client as IClient, { manual: true });
  }

  const schedule = await getClientBillingCycleAnchor(knexOrTrx, tenant, clientId);
  const normalizedEffectiveBoundary = resolveNormalizedBootstrapBoundary({
    billingHistoryStartDate: ensureUtcMidnightIsoDate(effectiveDate),
    billingCycle: schedule.billingCycle,
    anchor: schedule.anchor,
  });

  return createClientContractLineCycles(knexOrTrx as any, client as IClient, {
    manual: true,
    effectiveDate: normalizedEffectiveBoundary,
  });
}

function isKnexTransaction(knexOrTrx: Knex | Knex.Transaction): knexOrTrx is Knex.Transaction {
  return typeof (knexOrTrx as any).commit === 'function' && typeof (knexOrTrx as any).rollback === 'function';
}
