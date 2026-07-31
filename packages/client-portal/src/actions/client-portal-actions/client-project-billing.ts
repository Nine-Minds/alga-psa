'use server';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- The client portal billing summary composes the billing feature's authoritative schedule math. */

import { withAuth, type AuthContext } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { computeEntryAmounts } from '@alga-psa/billing/services';
import type {
  IProjectBillingScheduleEntry,
  IUserWithRoles,
} from '@alga-psa/types';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ClientBillingActionError } from './client-billing';
import {
  getClientIdFromPortalUser,
  hasClientBillingReadPermission,
} from './clientBillingPermissions';

export interface ClientProjectBillingSummary {
  enabled: boolean;
  currency: string | null;
  total_price: number | null;
  invoiced_to_date: number;
  entries: {
    description: string;
    computed_amount: number;
    status: 'upcoming' | 'invoiced';
    invoiced_at: string | null;
  }[];
}

function showBillingEnabled(value: unknown): boolean {
  let config = value;
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch {
      return false;
    }
  }
  return Boolean(
    config
    && typeof config === 'object'
    && (config as Record<string, unknown>).show_billing === true,
  );
}

function serializableDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function disabledSummary(): ClientProjectBillingSummary {
  return {
    enabled: false,
    currency: null,
    total_price: null,
    invoiced_to_date: 0,
    entries: [],
  };
}

export const getClientProjectBillingSummary = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  projectId: string,
): Promise<ClientProjectBillingSummary | null | ClientBillingActionError> => {
  if (user.user_type !== 'client' || !user.contact_id) return permissionError('Unauthorized');

  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const clientId = await getClientIdFromPortalUser(knex, user, tenant);
  if (!clientId) return permissionError('Unauthorized');
  if (!await hasClientBillingReadPermission(knex, user, tenant)) {
    return permissionError('Unauthorized to access project billing data');
  }

  // Client ownership is part of the project lookup so another client's UUID
  // never reveals whether a billing configuration exists.
  const project = await db.table('projects')
    .where({ project_id: projectId, client_id: clientId })
    .select('project_id', 'client_portal_config')
    .first<{ project_id: string; client_portal_config: unknown }>();
  if (!project) return null;
  if (!showBillingEnabled(project.client_portal_config)) return disabledSummary();

  const config = await db.table('project_billing_configs')
    .where({ project_id: projectId })
    .select('config_id', 'billing_model', 'total_price', 'currency')
    .first<{
      config_id: string;
      billing_model: 'fixed_price' | 'time_and_materials';
      total_price: string | number | null;
      currency: string | null;
    }>();
  if (!config) return disabledSummary();

  const entryQuery = db.table('project_billing_schedule_entries as entry')
    .where('entry.config_id', config.config_id)
    .select(
      'entry.*',
      'invoice.finalized_at as invoice_finalized_at',
      'invoice.invoice_date as invoice_date',
    )
    .orderBy('entry.display_order', 'asc')
    .orderBy('entry.created_at', 'asc')
    .orderBy('entry.schedule_entry_id', 'asc');
  db.tenantJoin(entryQuery, 'invoices as invoice', 'entry.invoice_id', 'invoice.invoice_id', {
    type: 'left',
  });
  const rows = await entryQuery as Array<Record<string, unknown>>;
  const entries = rows.map((row): IProjectBillingScheduleEntry => ({
    ...row,
    amount: row.amount == null ? null : Number(row.amount),
    percentage: row.percentage == null ? null : Number(row.percentage),
    display_order: Number(row.display_order ?? 0),
  } as IProjectBillingScheduleEntry));
  const totalPrice = config.total_price == null ? null : Number(config.total_price);
  const amounts = computeEntryAmounts({ total_price: totalPrice }, entries);
  const visibleEntries = entries.flatMap((entry, index) => {
    if (entry.status === 'canceled') return [];
    const raw = rows[index];
    return [{
      description: entry.description,
      computed_amount: amounts[index],
      status: entry.status === 'invoiced' ? 'invoiced' as const : 'upcoming' as const,
      invoiced_at: entry.status === 'invoiced'
        ? serializableDate(raw.invoice_finalized_at ?? raw.invoice_date ?? entry.updated_at)
        : null,
    }];
  });

  let invoicedToDate = entries.reduce(
    (sum, entry, index) => entry.status === 'invoiced' ? sum + amounts[index] : sum,
    0,
  );
  if (config.billing_model === 'time_and_materials') {
    const capUsage = await db.table('project_billing_cap_usage')
      .where({ config_id: config.config_id })
      .select('billed_amount')
      .first<{ billed_amount: string | number }>();
    invoicedToDate = Number(capUsage?.billed_amount ?? 0);
  }

  return {
    enabled: true,
    currency: config.currency,
    total_price: totalPrice,
    invoiced_to_date: invoicedToDate,
    entries: visibleEntries,
  };
});
