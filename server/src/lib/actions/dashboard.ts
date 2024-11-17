'use server'

import { createTenantKnex } from '@/lib/db';
import { headers } from 'next/headers';

export interface DashboardMetrics {
  openTickets: number;
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
  const { knex } = await createTenantKnex();

  try {
    // Get open tickets count
    const [ticketCount] = await knex('tickets')
      .where('is_closed', false)
      .count('ticket_id as count');

    // Get pending invoices count
    const [invoiceCount] = await knex('invoices')
      .whereNull('finalized_at')
      .count('* as count');

    // Get active assets count
    const [assetCount] = await knex('assets')
      .where('status', '!=', 'inactive')
      .count('* as count');

    return {
      openTickets: Number(ticketCount.count || 0),
      pendingInvoices: Number(invoiceCount.count || 0),
      activeAssets: Number(assetCount.count || 0),
    };
  } catch (error) {
    console.error('Error fetching dashboard metrics:', error);
    throw new Error('Failed to fetch dashboard metrics');
  }
}

export async function getRecentActivity(): Promise<RecentActivity[]> {
  const { knex } = await createTenantKnex();

  try {
    // Get recent tickets with their initial descriptions
    const tickets = await knex('tickets')
      .select([
        'tickets.title',
        'tickets.updated_at as timestamp',
        'comments.note as description'
      ])
      .leftJoin('comments', function() {
        this.on('tickets.ticket_id', '=', 'comments.ticket_id')
            .andOn('tickets.tenant', '=', 'comments.tenant')
            .andOn('comments.is_initial_description', '=', knex.raw('true'));
      })
      .orderBy('tickets.updated_at', 'desc')
      .limit(3);

    // Get recent invoices
    const invoices = await knex('invoices')
      .select([
        'invoice_number',
        'total_amount as total',
        'updated_at as timestamp'
      ])
      .orderBy('updated_at', 'desc')
      .limit(3);

    // Get recent asset maintenance activities
    const assetActivities = await knex('asset_maintenance_history')
      .select([
        'asset_maintenance_history.description',
        'asset_maintenance_history.performed_at as timestamp',
        'assets.name as asset_name'
      ])
      .join('assets', function() {
        this.on('assets.tenant', '=', 'asset_maintenance_history.tenant')
            .andOn('assets.asset_id', '=', 'asset_maintenance_history.asset_id');
      })
      .orderBy('asset_maintenance_history.performed_at', 'desc')
      .limit(3);

    // Combine and sort activities
    const activities: RecentActivity[] = [
      ...tickets.map((t: { title: string; timestamp: string; description: string }): RecentActivity => ({
        type: 'ticket',
        title: `New ticket: ${t.title}`,
        timestamp: t.timestamp,
        description: t.description || 'No description available'
      })),
      ...invoices.map((i: { invoice_number: string; timestamp: string; total: number }): RecentActivity => ({
        type: 'invoice',
        title: `Invoice ${i.invoice_number} generated`,
        timestamp: i.timestamp,
        description: `Total amount: $${i.total}`
      })),
      ...assetActivities.map((a: { asset_name: string; timestamp: string; description: string }): RecentActivity => ({
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
