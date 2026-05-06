'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';

export interface AlgadeskDashboardSummary {
  openTickets: number;
  awaitingCustomer: number;
  awaitingInternal: number;
  aging: {
    under2Days: number;
    days2To7: number;
    over7Days: number;
  };
  recentTickets: Array<{
    ticketId: string;
    ticketNumber: string;
    title: string;
    updatedAt: string;
  }>;
  emailHealth: {
    totalChannels: number;
    activeChannels: number;
    healthyChannels: number;
  };
}

export const getAlgadeskDashboardSummary = withAuth(async (_user, { tenant }): Promise<AlgadeskDashboardSummary> => {
  const { knex } = await createTenantKnex();

  const [openRow, awaitingCustomerRow, awaitingInternalRow, agingRows, recentRows, emailRows] = await Promise.all([
    knex('tickets as t')
      .join('statuses as s', function joinStatus() {
        this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
      })
      .where('t.tenant', tenant)
      .where('s.is_closed', false)
      .count<{ count: string }[]>('* as count')
      .first(),
    knex('tickets as t')
      .join('statuses as s', function joinStatus() {
        this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
      })
      .where('t.tenant', tenant)
      .where('s.is_closed', false)
      .where('t.response_state', 'awaiting_client')
      .count<{ count: string }[]>('* as count')
      .first(),
    knex('tickets as t')
      .join('statuses as s', function joinStatus() {
        this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
      })
      .where('t.tenant', tenant)
      .where('s.is_closed', false)
      .where('t.response_state', 'awaiting_internal')
      .count<{ count: string }[]>('* as count')
      .first(),
    knex('tickets as t')
      .join('statuses as s', function joinStatus() {
        this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
      })
      .where('t.tenant', tenant)
      .where('s.is_closed', false)
      .select(
        knex.raw("SUM(CASE WHEN t.entered_at >= NOW() - INTERVAL '2 days' THEN 1 ELSE 0 END)::int as under_2_days"),
        knex.raw("SUM(CASE WHEN t.entered_at < NOW() - INTERVAL '2 days' AND t.entered_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int as days_2_to_7"),
        knex.raw("SUM(CASE WHEN t.entered_at < NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int as over_7_days"),
      )
      .first(),
    knex('tickets')
      .where({ tenant })
      .select('ticket_id', 'ticket_number', 'title', 'updated_at')
      .orderBy('updated_at', 'desc')
      .limit(5),
    knex('email_providers')
      .where({ tenant })
      .select('is_active', 'status'),
  ]);

  const totalChannels = emailRows.length;
  const activeChannels = emailRows.filter((row) => row.is_active).length;
  const healthyChannels = emailRows.filter((row) => row.is_active && row.status === 'connected').length;

  return {
    openTickets: Number(openRow?.count ?? 0),
    awaitingCustomer: Number(awaitingCustomerRow?.count ?? 0),
    awaitingInternal: Number(awaitingInternalRow?.count ?? 0),
    aging: {
      under2Days: Number((agingRows as any)?.under_2_days ?? 0),
      days2To7: Number((agingRows as any)?.days_2_to_7 ?? 0),
      over7Days: Number((agingRows as any)?.over_7_days ?? 0),
    },
    recentTickets: recentRows.map((row) => ({
      ticketId: row.ticket_id,
      ticketNumber: row.ticket_number,
      title: row.title,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    })),
    emailHealth: {
      totalChannels,
      activeChannels,
      healthyChannels,
    },
  };
});
