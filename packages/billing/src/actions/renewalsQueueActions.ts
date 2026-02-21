'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { RenewalWorkItemStatus } from '@alga-psa/types';
import { normalizeClientContract } from '@alga-psa/shared/billingClients/clientContracts';

const DEFAULT_RENEWALS_HORIZON_DAYS = 90;
const RENEWAL_WORK_ITEM_STATUSES: RenewalWorkItemStatus[] = [
  'pending',
  'renewing',
  'non_renewing',
  'snoozed',
  'completed',
];

const isRenewalWorkItemStatus = (value: unknown): value is RenewalWorkItemStatus =>
  typeof value === 'string' && RENEWAL_WORK_ITEM_STATUSES.includes(value as RenewalWorkItemStatus);

export type RenewalQueueRow = {
  client_contract_id: string;
  contract_id: string;
  contract_name?: string | null;
  client_id: string;
  client_name?: string | null;
  assigned_to?: string | null;
  status?: RenewalWorkItemStatus;
  contract_type: 'fixed-term' | 'evergreen';
  effective_renewal_mode?: 'none' | 'manual' | 'auto';
  decision_due_date?: string;
  days_until_due?: number;
  renewal_cycle_key?: string;
};

export const listRenewalQueueRows = withAuth(async (
  _user,
  { tenant },
  horizonDays: number = DEFAULT_RENEWALS_HORIZON_DAYS
): Promise<RenewalQueueRow[]> => {
  const { knex } = await createTenantKnex();
  const resolvedHorizonDays =
    Number.isInteger(horizonDays) && horizonDays > 0
      ? Math.trunc(horizonDays)
      : DEFAULT_RENEWALS_HORIZON_DAYS;

  const schema = knex.schema as any;
  const [hasDefaultRenewalModeColumn, hasDefaultNoticePeriodColumn] = await Promise.all([
    schema?.hasColumn?.('default_billing_settings', 'default_renewal_mode') ?? false,
    schema?.hasColumn?.('default_billing_settings', 'default_notice_period_days') ?? false,
  ]);

  const defaultSelections: string[] = [];
  if (hasDefaultRenewalModeColumn) {
    defaultSelections.push('dbs.default_renewal_mode as tenant_default_renewal_mode');
  }
  if (hasDefaultNoticePeriodColumn) {
    defaultSelections.push('dbs.default_notice_period_days as tenant_default_notice_period_days');
  }

  let query = knex('client_contracts as cc')
    .leftJoin('contracts as c', function joinContracts() {
      this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
    })
    .leftJoin('clients as cl', function joinClients() {
      this.on('cc.client_id', '=', 'cl.client_id').andOn('cc.tenant', '=', 'cl.tenant');
    })
    .where({ 'cc.tenant': tenant, 'cc.is_active': true })
    .select([
      'cc.*',
      'c.contract_name',
      'c.status as contract_status',
      'cl.client_name',
      ...defaultSelections,
    ]);

  if (defaultSelections.length > 0) {
    query = query.leftJoin('default_billing_settings as dbs', function joinDefaultBillingSettings() {
      this.on('cc.tenant', '=', 'dbs.tenant');
    });
  }

  const rows = await query;

  return rows
    .map(normalizeClientContract)
    .filter(
      (row) =>
        Boolean(row.decision_due_date) &&
        typeof row.days_until_due === 'number' &&
        row.days_until_due >= 0 &&
        row.days_until_due <= resolvedHorizonDays
    )
    .map((row) => ({
      client_contract_id: row.client_contract_id,
      contract_id: row.contract_id,
      contract_name: (row as any).contract_name ?? null,
      client_id: row.client_id,
      client_name: (row as any).client_name ?? null,
      assigned_to: (row as any).assigned_to ?? null,
      status: isRenewalWorkItemStatus((row as any).status) ? (row as any).status : 'pending',
      contract_type: row.end_date ? ('fixed-term' as const) : ('evergreen' as const),
      effective_renewal_mode: row.effective_renewal_mode,
      decision_due_date: row.decision_due_date ?? undefined,
      days_until_due: row.days_until_due,
      renewal_cycle_key: row.renewal_cycle_key,
    }))
    .sort((a, b) => (a.decision_due_date ?? '').localeCompare(b.decision_due_date ?? ''));
});
