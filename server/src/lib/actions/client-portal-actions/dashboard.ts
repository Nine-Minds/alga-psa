'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { headers } from 'next/headers';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';

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

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('Unauthorized: User not found');
  }

  if (user.user_type !== 'client') {
    throw new Error('Unauthorized: Invalid user type for client portal');
  }

  if (!user.contact_id) {
    throw new Error('Unauthorized: Contact information not found');
  }

  const { knex, tenant } = await createTenantKnex();

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

        // Get pending invoices count
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
    console.error('Error fetching dashboard metrics:', error);
    throw new Error('Failed to fetch dashboard metrics');
  }
}

export async function getRecentActivity(): Promise<RecentActivity[]> {
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('Unauthorized: User not found');
  }

  if (user.user_type !== 'client') {
    throw new Error('Unauthorized: Invalid user type for client portal');
  }

  if (!user.contact_id) {
    throw new Error('Unauthorized: Contact information not found');
  }

  const { knex, tenant } = await createTenantKnex();

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
      const invoices = await trx('invoices')
        .select([
          'invoice_number',
          'total_amount as total',
          'updated_at as timestamp'
        ])
        .where({
          'invoices.tenant': tenant,
          'invoices.client_id': clientId
        })
        .orderBy('updated_at', 'desc')
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
      ...result.invoices.map((i: { invoice_number: string; timestamp: string; total: number }): RecentActivity => ({
        type: 'invoice',
        title: `Invoice ${i.invoice_number} generated`,
        timestamp: i.timestamp,
        description: `Total amount: $${i.total}`
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
    console.error('Error fetching recent activity:', error);
    throw new Error('Failed to fetch recent activity');
  }
}
