'use server'

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { headers } from 'next/headers.js';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';

export interface DashboardMetrics {
  openTickets: number;
  activeProjects: number;
  pendingInvoices: number;
  activeAssets: number;
}

export interface RecentActivity {
  type: 'ticket' | 'invoice' | 'asset';
  title: string;
  timestamp: string;
  description: string;
}

type RecentInvoiceActivityRow = {
  invoice_number: string;
  total: string | number | null;
  timestamp: string;
  service_period_start?: string | Date | null;
  service_period_end?: string | Date | null;
};

function normalizeDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return null;
}

function formatCurrencyFromCents(value: string | number | null | undefined): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format((Number(value ?? 0) || 0) / 100);
}

function formatRecentInvoiceDescription(invoice: RecentInvoiceActivityRow): string {
  const totalLabel = formatCurrencyFromCents(invoice.total);
  const servicePeriodStart = normalizeDateOnly(invoice.service_period_start);
  const servicePeriodEnd = normalizeDateOnly(invoice.service_period_end);

  // Recent invoice activity is one of the portal surfaces that is allowed to
  // explain canonical recurring coverage when detail rows exist. The metric
  // cards above stay invoice-state counts rather than service-period metrics.
  if (servicePeriodStart || servicePeriodEnd) {
    return `Service period: ${servicePeriodStart ?? 'Unknown start'} to ${servicePeriodEnd ?? 'Unknown end'} • Total amount: ${totalLabel}`;
  }

  return `Total amount: ${totalLabel}`;
}

export const getDashboardMetrics = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<DashboardMetrics> => {
  if (user.user_type !== 'client') {
    throw new Error('Unauthorized: Invalid user type for client portal');
  }

  if (!user.contact_id) {
    throw new Error('Unauthorized: Contact information not found');
  }

  const { knex } = await createTenantKnex();

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get client_id from contact
      const contact = await trx('contacts')
        .where({
          'contact_name_id': user.contact_id,
          'tenant': tenant
        })
        .select('client_id')
        .first();

      if (!contact) {
        throw new Error('Unauthorized: Client information not found');
      }

      const clientId = contact.client_id;

      const [[ticketCount], [projectCount], [invoiceCount], [assetCount]] = await Promise.all([
        // Get open tickets count
        trx('tickets')
          .where({
            'tickets.tenant': tenant,
            'tickets.client_id': clientId,
            'is_closed': false
          })
          .count('ticket_id as count'),

        // Get active projects count
        trx('projects')
          .where({
            'projects.tenant': tenant,
            'projects.client_id': clientId,
            'is_inactive': false
          })
          .count('project_id as count'),

        // Pending invoice counts remain financial-document / invoice-state
        // metrics. They should not silently pivot to recurring coverage dates.
        trx('invoices')
          .where({
            'invoices.tenant': tenant,
            'invoices.client_id': clientId
          })
          .whereNull('finalized_at')
          .count('* as count'),

        // Get active assets count
        trx('assets')
          .where({
            'assets.tenant': tenant,
            'assets.client_id': clientId
          })
          .andWhere('status', '!=', 'inactive')
          .count('* as count')
      ]);

      return {
        openTickets: Number(ticketCount.count || 0),
        activeProjects: Number(projectCount.count || 0),
        pendingInvoices: Number(invoiceCount.count || 0),
        activeAssets: Number(assetCount.count || 0),
      };
    });

    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unauthorized')) {
      throw error;
    }
    console.error('Error fetching dashboard metrics:', error);
    throw new Error('Failed to fetch dashboard metrics');
  }
});

export const getRecentActivity = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<RecentActivity[]> => {
  if (user.user_type !== 'client') {
    throw new Error('Unauthorized: Invalid user type for client portal');
  }

  if (!user.contact_id) {
    throw new Error('Unauthorized: Contact information not found');
  }

  const { knex } = await createTenantKnex();

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get client_id from contact
      const contact = await trx('contacts')
        .where({
          'contact_name_id': user.contact_id,
          'tenant': tenant
        })
        .select('client_id')
        .first();

      if (!contact) {
        throw new Error('Unauthorized: Client information not found');
      }

      const clientId = contact.client_id;

      // Get recent tickets with their initial descriptions
      const tickets = await trx('tickets')
        .select([
          'tickets.title',
          'tickets.updated_at as timestamp',
          'comments.note as description'
        ])
        .leftJoin('comments', function() {
          this.on('tickets.ticket_id', '=', 'comments.ticket_id')
              .andOn('tickets.tenant', '=', 'comments.tenant');
        })
        .where({
          'tickets.tenant': tenant,
          'tickets.client_id': clientId
        })
        .orderBy('tickets.updated_at', 'desc')
        .limit(3);

      // Get recent invoices
      const invoices = await trx('invoices as inv')
        .select([
          'inv.invoice_number',
          'inv.total_amount as total',
          'inv.updated_at as timestamp',
          trx.raw('MIN(iid.service_period_start) as service_period_start'),
          trx.raw('MAX(iid.service_period_end) as service_period_end'),
        ])
        .leftJoin('invoice_charges as ic', function() {
          this.on('inv.invoice_id', '=', 'ic.invoice_id')
              .andOn('inv.tenant', '=', 'ic.tenant');
        })
        .leftJoin('invoice_charge_details as iid', function() {
          this.on('ic.item_id', '=', 'iid.item_id')
              .andOn('ic.tenant', '=', 'iid.tenant');
        })
        .where({
          'inv.tenant': tenant,
          'inv.client_id': clientId
        })
        .groupBy('inv.invoice_id', 'inv.invoice_number', 'inv.total_amount', 'inv.updated_at')
        .orderBy('inv.updated_at', 'desc')
        .limit(3);

      // Get recent asset maintenance activities
      const assetActivities = await trx('asset_maintenance_history')
        .select([
          'asset_maintenance_history.description',
          'asset_maintenance_history.performed_at as timestamp',
          'assets.name as asset_name'
        ])
        .join('assets', function() {
          this.on('assets.asset_id', '=', 'asset_maintenance_history.asset_id')
              .andOn('assets.tenant', '=', 'asset_maintenance_history.tenant');
        })
        .where({
          'asset_maintenance_history.tenant': tenant,
          'assets.client_id': clientId
        })
        .orderBy('asset_maintenance_history.performed_at', 'desc')
        .limit(3);

      return { tickets, invoices, assetActivities };
    });

    // Combine and sort activities
    const activities: RecentActivity[] = [
      ...result.tickets.map((t: { title: string; timestamp: string; description: string }): RecentActivity => ({
        type: 'ticket',
        title: `New ticket: ${t.title}`,
        timestamp: t.timestamp,
        description: t.description || 'No description available'
      })),
      ...result.invoices.map((i: RecentInvoiceActivityRow): RecentActivity => ({
        type: 'invoice',
        title: `Invoice ${i.invoice_number} generated`,
        timestamp: i.timestamp,
        description: formatRecentInvoiceDescription(i)
      })),
      ...result.assetActivities.map((a: { asset_name: string; timestamp: string; description: string }): RecentActivity => ({
        type: 'asset',
        title: `Asset maintenance: ${a.asset_name}`,
        timestamp: a.timestamp,
        description: a.description
      }))
    ].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ).slice(0, 5);

    return activities;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unauthorized')) {
      throw error;
    }
    console.error('Error fetching recent activity:', error);
    throw new Error('Failed to fetch recent activity');
  }
});
