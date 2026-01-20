'use server'

import type { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';

import { createTenantKnex } from '@alga-psa/db';
import type { BillingCycleType } from '@alga-psa/types';
import type { ISO8601String } from '@alga-psa/types';
import {
  ensureUtcMidnightIsoDate,
  normalizeAnchorSettingsForCycle,
  validateAnchorSettingsForCycle,
  type BillingCycleAnchorSettingsInput,
  type NormalizedBillingCycleAnchorSettings
} from '../lib/billing/billingCycleAnchors';
import { ensureClientBillingSettingsRow } from './billingCycleAnchorActions';
import { getCurrentUserAsync, hasPermissionAsync, getSessionAsync, getAnalyticsAsync } from '../lib/authHelpers';

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

export type ClientBillingScheduleConfig = {
  billingCycle: BillingCycleType;
  anchor: NormalizedBillingCycleAnchorSettings;
};

export async function getClientBillingScheduleSummaries(
  clientIds: string[]
): Promise<Record<string, ClientBillingScheduleConfig>> {
  const session = await getSessionAsync();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  if (clientIds.length === 0) {
    return {};
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  const rows = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('clients as c')
      .leftJoin('client_billing_settings as s', function () {
        this.on('s.client_id', '=', 'c.client_id').andOn('s.tenant', '=', 'c.tenant');
      })
      .where('c.tenant', tenant)
      .whereIn('c.client_id', clientIds)
      .select(
        'c.client_id',
        'c.billing_cycle',
        's.billing_cycle_anchor_day_of_month',
        's.billing_cycle_anchor_month_of_year',
        's.billing_cycle_anchor_day_of_week',
        's.billing_cycle_anchor_reference_date'
      );
  });

  const summaries: Record<string, ClientBillingScheduleConfig> = {};
  for (const row of rows) {
    const billingCycle = (row.billing_cycle ?? 'monthly') as BillingCycleType;
    summaries[row.client_id] = {
      billingCycle,
      anchor: normalizeAnchorSettingsForCycle(billingCycle, {
        dayOfMonth: row.billing_cycle_anchor_day_of_month ?? null,
        monthOfYear: row.billing_cycle_anchor_month_of_year ?? null,
        dayOfWeek: row.billing_cycle_anchor_day_of_week ?? null,
        referenceDate: row.billing_cycle_anchor_reference_date
          ? normalizeDbIsoUtcMidnight(row.billing_cycle_anchor_reference_date)
          : null
      })
    };
  }

  return summaries;
}

export type UpdateClientBillingScheduleInput = {
  clientId: string;
  billingCycle: BillingCycleType;
  anchor: BillingCycleAnchorSettingsInput;
};

export async function updateClientBillingSchedule(
  input: UpdateClientBillingScheduleInput
): Promise<{ success: true }> {
  const session = await getSessionAsync();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const client = await trx('clients')
      .where({ tenant, client_id: input.clientId })
      .first()
      .select('client_id', 'billing_cycle');
    if (!client) {
      throw new Error('Client not found');
    }

    validateAnchorSettingsForCycle(input.billingCycle, input.anchor);
    const normalized = normalizeAnchorSettingsForCycle(input.billingCycle, input.anchor);

    // Update billing cycle type (if changed).
    if ((client.billing_cycle ?? 'monthly') !== input.billingCycle) {
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

    // Schedule changes should not retroactively affect already-invoiced periods.
    // To ensure newly generated cycles reflect the updated schedule, deactivate any
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
