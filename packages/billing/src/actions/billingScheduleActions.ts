'use server'

import type { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import type { BillingCycleType } from '@alga-psa/types';
import type { ISO8601String } from '@alga-psa/types';
import {
  ensureUtcMidnightIsoDate,
  normalizeAnchorSettingsForCycle,
  type BillingCycleAnchorSettingsInput,
  type NormalizedBillingCycleAnchorSettings
} from '../lib/billing/billingCycleAnchors';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  applyClientCadenceChange,
  previewClientCadenceScheduleChange,
  type ClientCadenceChangePreview,
} from '@alga-psa/shared/billingClients';

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
  if (!await hasPermission(user as any, 'billing', 'read')) {
    throw new Error('Permission denied: billing read required');
  }
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
  if (!await hasPermission(user as any, 'billing', 'update')) {
    throw new Error('Permission denied: billing update required');
  }
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await applyClientCadenceChange(trx, tenant, input);
  });

  return { success: true };
});

export type PreviewClientCadenceChangeInput = {
  clientId: string;
  billingCycle: BillingCycleType;
  anchor?: BillingCycleAnchorSettingsInput;
};

/**
 * Dry-run a cadence change so the UI can show the impact before applying it.
 * Reads only — no scalar, anchor, cycle-window, or ledger rows are written.
 * When no anchor is supplied (a plain cycle switch) the client's current anchor
 * is read and adapted to the new cycle, matching what `updateBillingCycle` does.
 */
export const previewClientCadenceChange = withAuth(async (
  user,
  { tenant },
  input: PreviewClientCadenceChangeInput
): Promise<ClientCadenceChangePreview> => {
  if (!await hasPermission(user as any, 'billing', 'read')) {
    throw new Error('Permission denied: billing read required');
  }
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    let anchorInput = input.anchor;
    if (!anchorInput) {
      const settings = await trx('client_billing_settings')
        .where({ tenant, client_id: input.clientId })
        .first()
        .select(
          'billing_cycle_anchor_day_of_month',
          'billing_cycle_anchor_month_of_year',
          'billing_cycle_anchor_day_of_week',
          'billing_cycle_anchor_reference_date'
        );
      anchorInput = {
        dayOfMonth: settings?.billing_cycle_anchor_day_of_month ?? null,
        monthOfYear: settings?.billing_cycle_anchor_month_of_year ?? null,
        dayOfWeek: settings?.billing_cycle_anchor_day_of_week ?? null,
        referenceDate: settings?.billing_cycle_anchor_reference_date
          ? normalizeDbIsoUtcMidnight(settings.billing_cycle_anchor_reference_date)
          : null,
      };
    }

    const normalized = normalizeAnchorSettingsForCycle(input.billingCycle, anchorInput);

    return previewClientCadenceScheduleChange(trx, {
      tenant,
      clientId: input.clientId,
      billingCycle: input.billingCycle,
      anchor: normalized,
    });
  });
});
