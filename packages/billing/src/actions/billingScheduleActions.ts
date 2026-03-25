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
import { regenerateClientCadenceServicePeriodsForScheduleChange } from './clientCadenceScheduleRegeneration';
import { withAuth } from '@alga-psa/auth';
import { updateClientBillingSchedule as updateClientBillingScheduleShared } from '@alga-psa/shared/billingClients';

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

export const getClientBillingScheduleSummaries = withAuth(async (
  user,
  { tenant },
  clientIds: string[]
): Promise<Record<string, ClientBillingScheduleConfig>> => {
  if (clientIds.length === 0) {
    return {};
  }

  const { knex } = await createTenantKnex();

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
});

export type UpdateClientBillingScheduleInput = {
  clientId: string;
  billingCycle: BillingCycleType;
  anchor: BillingCycleAnchorSettingsInput;
  billingHistoryStartDate?: ISO8601String | null;
};

export const updateClientBillingSchedule = withAuth(async (
  user,
  { tenant },
  input: UpdateClientBillingScheduleInput
): Promise<{ success: true }> => {
  const { knex } = await createTenantKnex();

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

    if (input.billingHistoryStartDate) {
      await updateClientBillingScheduleShared(trx, tenant, input);
    } else {
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
    }

    await regenerateClientCadenceServicePeriodsForScheduleChange(trx, {
      tenant,
      clientId: input.clientId,
      billingCycle: input.billingCycle,
      anchor: normalized,
    });
  });

  return { success: true };
});
