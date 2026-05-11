'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';

export type ReportRangeDays = 7 | 30 | 90;

export interface ReportBucket {
  label: string;
  count: number;
}

export interface TicketWorkloadReport {
  rangeDays: ReportRangeDays;
  summary: {
    created: number;
    closed: number;
    open: number;
    awaitingCustomer: number;
    awaitingInternal: number;
  };
  byStatus: ReportBucket[];
  byPriority: ReportBucket[];
  byAssignee: ReportBucket[];
}

export interface TicketAgingReport {
  rangeDays: ReportRangeDays;
  summary: {
    open: number;
    under2Days: number;
    days2To7: number;
    days8To30: number;
    over30Days: number;
  };
  byAge: ReportBucket[];
  byResponseState: ReportBucket[];
  oldestOpenTickets: Array<{
    ticketId: string;
    ticketNumber: string;
    title: string;
    clientName: string;
    enteredAt: string;
    ageDays: number;
  }>;
}

function normalizeRangeDays(value?: number): ReportRangeDays {
  return value === 7 || value === 90 ? value : 30;
}

function toCount(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : '';
}

export const getTicketWorkloadReport = withAuth(
  async (_user, { tenant }, rangeDaysInput?: number): Promise<TicketWorkloadReport> => {
    const rangeDays = normalizeRangeDays(rangeDaysInput);
    const { knex } = await createTenantKnex();

    const [
      createdRow,
      closedRow,
      openRow,
      awaitingCustomerRow,
      awaitingInternalRow,
      statusRows,
      priorityRows,
      assigneeRows,
    ] = await Promise.all([
      knex('tickets')
        .where({ tenant })
        .where('entered_at', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`))
        .count<{ count: string }[]>('* as count')
        .first(),
      knex('tickets')
        .where({ tenant })
        .whereNotNull('closed_at')
        .where('closed_at', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`))
        .count<{ count: string }[]>('* as count')
        .first(),
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
        .select('s.name as label')
        .count<{ label: string | null; count: string }[]>('* as count')
        .groupBy('s.name')
        .orderBy('count', 'desc')
        .limit(8),
      knex('tickets as t')
        .join('statuses as s', function joinStatus() {
          this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
        })
        .leftJoin('priorities as p', function joinPriority() {
          this.on('t.priority_id', '=', 'p.priority_id').andOn('t.tenant', '=', 'p.tenant');
        })
        .where('t.tenant', tenant)
        .where('s.is_closed', false)
        .select(knex.raw("COALESCE(p.priority_name, 'No priority') as label"))
        .count<{ label: string | null; count: string }[]>('* as count')
        .groupBy('p.priority_name')
        .orderBy('count', 'desc')
        .limit(8),
      knex('tickets as t')
        .join('statuses as s', function joinStatus() {
          this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
        })
        .leftJoin('users as u', function joinAssignee() {
          this.on('t.assigned_to', '=', 'u.user_id').andOn('t.tenant', '=', 'u.tenant');
        })
        .where('t.tenant', tenant)
        .where('s.is_closed', false)
        .select(knex.raw("COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), 'Unassigned') as label"))
        .count<{ label: string | null; count: string }[]>('* as count')
        .groupBy('u.first_name', 'u.last_name')
        .orderBy('count', 'desc')
        .limit(8),
    ]);

    const mapBuckets = (rows: Array<{ label: string | null; count: string }>): ReportBucket[] =>
      rows.map((row) => ({
        label: row.label || 'Unknown',
        count: toCount(row.count),
      }));

    return {
      rangeDays,
      summary: {
        created: toCount(createdRow?.count),
        closed: toCount(closedRow?.count),
        open: toCount(openRow?.count),
        awaitingCustomer: toCount(awaitingCustomerRow?.count),
        awaitingInternal: toCount(awaitingInternalRow?.count),
      },
      byStatus: mapBuckets(statusRows),
      byPriority: mapBuckets(priorityRows),
      byAssignee: mapBuckets(assigneeRows),
    };
  },
);

export const getTicketAgingReport = withAuth(
  async (_user, { tenant }, rangeDaysInput?: number): Promise<TicketAgingReport> => {
    const rangeDays = normalizeRangeDays(rangeDaysInput);
    const { knex } = await createTenantKnex();

    const [agingRows, responseRows, oldestRows] = await Promise.all([
      knex('tickets as t')
        .join('statuses as s', function joinStatus() {
          this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
        })
        .where('t.tenant', tenant)
        .where('s.is_closed', false)
        .select(
          knex.raw("SUM(CASE WHEN t.entered_at >= NOW() - INTERVAL '2 days' THEN 1 ELSE 0 END)::int as under_2_days"),
          knex.raw("SUM(CASE WHEN t.entered_at < NOW() - INTERVAL '2 days' AND t.entered_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int as days_2_to_7"),
          knex.raw("SUM(CASE WHEN t.entered_at < NOW() - INTERVAL '7 days' AND t.entered_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int as days_8_to_30"),
          knex.raw("SUM(CASE WHEN t.entered_at < NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int as over_30_days"),
          knex.raw('COUNT(*)::int as open_count'),
        )
        .first(),
      knex('tickets as t')
        .join('statuses as s', function joinStatus() {
          this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
        })
        .where('t.tenant', tenant)
        .where('s.is_closed', false)
        .select(
          knex.raw(
            "CASE t.response_state WHEN 'awaiting_client' THEN 'Awaiting customer' WHEN 'awaiting_internal' THEN 'Awaiting internal' ELSE 'No response state' END as label",
          ),
        )
        .count<{ label: string; count: string }[]>('* as count')
        .groupBy('t.response_state')
        .orderBy('count', 'desc'),
      knex('tickets as t')
        .join('statuses as s', function joinStatus() {
          this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
        })
        .leftJoin('clients as c', function joinClient() {
          this.on('t.client_id', '=', 'c.client_id').andOn('t.tenant', '=', 'c.tenant');
        })
        .where('t.tenant', tenant)
        .where('s.is_closed', false)
        .where('t.entered_at', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`))
        .select(
          't.ticket_id',
          't.ticket_number',
          't.title',
          't.entered_at',
          knex.raw("COALESCE(c.client_name, 'No client') as client_name"),
          knex.raw("GREATEST(FLOOR(EXTRACT(EPOCH FROM (NOW() - t.entered_at)) / 86400), 0)::int as age_days"),
        )
        .orderBy('t.entered_at', 'asc')
        .limit(10),
    ]);

    const aging = agingRows as {
      open_count?: number;
      under_2_days?: number;
      days_2_to_7?: number;
      days_8_to_30?: number;
      over_30_days?: number;
    } | undefined;

    const byAge = [
      { label: 'Under 2 days', count: toCount(aging?.under_2_days) },
      { label: '2 to 7 days', count: toCount(aging?.days_2_to_7) },
      { label: '8 to 30 days', count: toCount(aging?.days_8_to_30) },
      { label: 'Over 30 days', count: toCount(aging?.over_30_days) },
    ];

    return {
      rangeDays,
      summary: {
        open: toCount(aging?.open_count),
        under2Days: toCount(aging?.under_2_days),
        days2To7: toCount(aging?.days_2_to_7),
        days8To30: toCount(aging?.days_8_to_30),
        over30Days: toCount(aging?.over_30_days),
      },
      byAge,
      byResponseState: responseRows.map((row) => ({
        label: row.label,
        count: toCount(row.count),
      })),
      oldestOpenTickets: oldestRows.map((row) => ({
        ticketId: row.ticket_id,
        ticketNumber: row.ticket_number,
        title: row.title,
        clientName: row.client_name,
        enteredAt: toIsoString(row.entered_at),
        ageDays: toCount(row.age_days),
      })),
    };
  },
);
