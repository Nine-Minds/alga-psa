'use server';

import { hasPermission, withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';

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

export interface EmailChannelHealthReport {
  rangeDays: ReportRangeDays;
  summary: {
    totalChannels: number;
    activeChannels: number;
    healthyChannels: number;
    problemChannels: number;
    processedEmails: number;
    ticketsCreated: number;
    failedEmails: number;
    avgProcessingMinutes: number | null;
    avgTicketCreationMinutes: number | null;
  };
  byStatus: ReportBucket[];
  channels: Array<{
    providerId: string;
    providerName: string;
    mailbox: string;
    providerType: string;
    isActive: boolean;
    status: string;
    processedEmails: number;
    ticketsCreated: number;
    failedEmails: number;
    avgTicketCreationMinutes: number | null;
    lastSyncAt: string;
  }>;
}

export interface TimeUtilizationReport {
  rangeDays: ReportRangeDays;
  summary: {
    totalHours: number;
    billableHours: number;
    nonBillableHours: number;
    billablePercent: number;
    entries: number;
  };
  byUser: Array<{
    userId: string;
    name: string;
    totalHours: number;
    billableHours: number;
    entries: number;
  }>;
  byService: ReportBucket[];
  byWorkType: ReportBucket[];
}

export interface TeamPerformanceReport {
  rangeDays: ReportRangeDays;
  summary: {
    createdTickets: number;
    closedTickets: number;
    openAssignedTickets: number;
    activeAssignees: number;
    avgResolutionHours: number | null;
  };
  byAssignee: Array<{
    userId: string;
    name: string;
    createdTickets: number;
    closedTickets: number;
    openTickets: number;
    avgResolutionHours: number | null;
  }>;
  openByAssignee: ReportBucket[];
  closedByAssignee: ReportBucket[];
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

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesToHours(value: unknown): number {
  return Math.round(((Number(value ?? 0) || 0) / 60) * 10) / 10;
}

async function assertCanReadReports(
  user: IUserWithRoles,
  knex: Knex,
): Promise<void> {
  if (!(await hasPermission(user, 'reports', 'read', knex))) {
    throw new Error('Permission denied: Cannot read reports');
  }
}

export const getTicketWorkloadReport = withAuth(
  async (user, { tenant }, rangeDaysInput?: number): Promise<TicketWorkloadReport> => {
    const rangeDays = normalizeRangeDays(rangeDaysInput);
    const { knex } = await createTenantKnex();
    await assertCanReadReports(user, knex);

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

export const getTimeUtilizationReport = withAuth(
  async (user, { tenant }, rangeDaysInput?: number): Promise<TimeUtilizationReport> => {
    const rangeDays = normalizeRangeDays(rangeDaysInput);
    const { knex } = await createTenantKnex();
    await assertCanReadReports(user, knex);

    const [summaryRow, userRows, serviceRows, workTypeRows] = await Promise.all([
      knex('time_entries')
        .where({ tenant })
        .where('start_time', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`))
        .select(
          knex.raw('COUNT(*)::int as entries'),
          knex.raw('COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 60), 0) as total_minutes'),
          knex.raw('COALESCE(SUM(billable_duration), 0) as billable_minutes'),
        )
        .first(),
      knex('time_entries as te')
        .leftJoin('users as u', function joinUser() {
          this.on('te.user_id', '=', 'u.user_id').andOn('te.tenant', '=', 'u.tenant');
        })
        .where('te.tenant', tenant)
        .where('te.start_time', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`))
        .select(
          'te.user_id',
          knex.raw("COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), 'Unknown user') as name"),
          knex.raw('COUNT(*)::int as entries'),
          knex.raw('COALESCE(SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60), 0) as total_minutes'),
          knex.raw('COALESCE(SUM(te.billable_duration), 0) as billable_minutes'),
        )
        .groupBy('te.user_id', 'u.first_name', 'u.last_name')
        .orderBy('total_minutes', 'desc')
        .limit(10),
      knex('time_entries as te')
        .leftJoin('service_catalog as sc', function joinService() {
          this.on('te.service_id', '=', 'sc.service_id').andOn('te.tenant', '=', 'sc.tenant');
        })
        .where('te.tenant', tenant)
        .where('te.start_time', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`))
        .select(knex.raw("COALESCE(sc.service_name, 'No service') as label"))
        .sum<{ label: string | null; count: string }[]>({ count: 'te.billable_duration' })
        .groupBy('sc.service_name')
        .orderBy('count', 'desc')
        .limit(8),
      knex('time_entries')
        .where({ tenant })
        .where('start_time', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`))
        .select(knex.raw("COALESCE(NULLIF(work_item_type, ''), 'No work type') as label"))
        .count<{ label: string | null; count: string }[]>('* as count')
        .groupBy('work_item_type')
        .orderBy('count', 'desc')
        .limit(8),
    ]);

    const totalHours = minutesToHours((summaryRow as any)?.total_minutes);
    const billableHours = minutesToHours((summaryRow as any)?.billable_minutes);
    const nonBillableHours = Math.max(0, Math.round((totalHours - billableHours) * 10) / 10);

    return {
      rangeDays,
      summary: {
        totalHours,
        billableHours,
        nonBillableHours,
        billablePercent: totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0,
        entries: toCount((summaryRow as any)?.entries),
      },
      byUser: userRows.map((row) => ({
        userId: row.user_id,
        name: row.name || 'Unknown user',
        totalHours: minutesToHours(row.total_minutes),
        billableHours: minutesToHours(row.billable_minutes),
        entries: toCount(row.entries),
      })),
      byService: serviceRows.map((row) => ({
        label: row.label || 'No service',
        count: minutesToHours(row.count),
      })),
      byWorkType: workTypeRows.map((row) => ({
        label: row.label || 'No work type',
        count: toCount(row.count),
      })),
    };
  },
);

export const getTeamPerformanceReport = withAuth(
  async (user, { tenant }, rangeDaysInput?: number): Promise<TeamPerformanceReport> => {
    const rangeDays = normalizeRangeDays(rangeDaysInput);
    const { knex } = await createTenantKnex();
    await assertCanReadReports(user, knex);
    const userNameExpression = knex.raw("COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), 'Unassigned') as name");

    const [createdRows, closedRows, openRows, summaryRow] = await Promise.all([
      knex('tickets as t')
        .leftJoin('users as u', function joinUser() {
          this.on('t.assigned_to', '=', 'u.user_id').andOn('t.tenant', '=', 'u.tenant');
        })
        .where('t.tenant', tenant)
        .where('t.entered_at', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`))
        .select(
          knex.raw("COALESCE(t.assigned_to::text, 'unassigned') as user_id"),
          userNameExpression,
        )
        .count<{ user_id: string; name: string; count: string }[]>('* as count')
        .groupBy('t.assigned_to', 'u.first_name', 'u.last_name')
        .orderBy('count', 'desc')
        .limit(10),
      knex('tickets as t')
        .leftJoin('users as u', function joinUser() {
          this.on('t.assigned_to', '=', 'u.user_id').andOn('t.tenant', '=', 'u.tenant');
        })
        .where('t.tenant', tenant)
        .whereNotNull('t.closed_at')
        .where('t.closed_at', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`))
        .select(
          knex.raw("COALESCE(t.assigned_to::text, 'unassigned') as user_id"),
          userNameExpression,
          knex.raw('AVG(EXTRACT(EPOCH FROM (t.closed_at - t.entered_at)) / 3600) as avg_resolution_hours'),
        )
        .count<{ user_id: string; name: string; count: string; avg_resolution_hours: string | null }[]>('* as count')
        .groupBy('t.assigned_to', 'u.first_name', 'u.last_name')
        .orderBy('count', 'desc')
        .limit(10),
      knex('tickets as t')
        .join('statuses as s', function joinStatus() {
          this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
        })
        .leftJoin('users as u', function joinUser() {
          this.on('t.assigned_to', '=', 'u.user_id').andOn('t.tenant', '=', 'u.tenant');
        })
        .where('t.tenant', tenant)
        .where('s.is_closed', false)
        .select(
          knex.raw("COALESCE(t.assigned_to::text, 'unassigned') as user_id"),
          userNameExpression,
        )
        .count<{ user_id: string; name: string; count: string }[]>('* as count')
        .groupBy('t.assigned_to', 'u.first_name', 'u.last_name')
        .orderBy('count', 'desc')
        .limit(10),
      knex('tickets as t')
        .leftJoin('statuses as s', function joinStatus() {
          this.on('t.status_id', '=', 's.status_id').andOn('t.tenant', '=', 's.tenant');
        })
        .where('t.tenant', tenant)
        .select(
          knex.raw(`SUM(CASE WHEN t.entered_at >= NOW() - INTERVAL '${rangeDays} days' THEN 1 ELSE 0 END)::int as created_tickets`),
          knex.raw(`SUM(CASE WHEN t.closed_at IS NOT NULL AND t.closed_at >= NOW() - INTERVAL '${rangeDays} days' THEN 1 ELSE 0 END)::int as closed_tickets`),
          knex.raw('SUM(CASE WHEN s.is_closed = false AND t.assigned_to IS NOT NULL THEN 1 ELSE 0 END)::int as open_assigned_tickets'),
          knex.raw(`COUNT(DISTINCT CASE WHEN t.entered_at >= NOW() - INTERVAL '${rangeDays} days' OR (t.closed_at IS NOT NULL AND t.closed_at >= NOW() - INTERVAL '${rangeDays} days') OR s.is_closed = false THEN t.assigned_to END)::int as active_assignees`),
          knex.raw(`AVG(CASE WHEN t.closed_at IS NOT NULL AND t.closed_at >= NOW() - INTERVAL '${rangeDays} days' THEN EXTRACT(EPOCH FROM (t.closed_at - t.entered_at)) / 3600 END) as avg_resolution_hours`),
        )
        .first(),
    ]);

    const rowsByUser = new Map<string, TeamPerformanceReport['byAssignee'][number]>();
    const ensureUser = (userId: string, name: string): TeamPerformanceReport['byAssignee'][number] => {
      const existing = rowsByUser.get(userId);
      if (existing) return existing;
      const row = {
        userId,
        name,
        createdTickets: 0,
        closedTickets: 0,
        openTickets: 0,
        avgResolutionHours: null,
      };
      rowsByUser.set(userId, row);
      return row;
    };

    for (const row of createdRows) {
      ensureUser(row.user_id, row.name).createdTickets = toCount(row.count);
    }
    for (const row of closedRows) {
      const user = ensureUser(row.user_id, row.name);
      user.closedTickets = toCount(row.count);
      user.avgResolutionHours = toNullableNumber(row.avg_resolution_hours);
    }
    for (const row of openRows) {
      ensureUser(row.user_id, row.name).openTickets = toCount(row.count);
    }

    const byAssignee = Array.from(rowsByUser.values())
      .sort((left, right) => (right.closedTickets + right.createdTickets + right.openTickets) - (left.closedTickets + left.createdTickets + left.openTickets))
      .slice(0, 10);

    return {
      rangeDays,
      summary: {
        createdTickets: toCount((summaryRow as any)?.created_tickets),
        closedTickets: toCount((summaryRow as any)?.closed_tickets),
        openAssignedTickets: toCount((summaryRow as any)?.open_assigned_tickets),
        activeAssignees: toCount((summaryRow as any)?.active_assignees),
        avgResolutionHours: toNullableNumber((summaryRow as any)?.avg_resolution_hours),
      },
      byAssignee,
      openByAssignee: openRows.map((row) => ({
        label: row.name,
        count: toCount(row.count),
      })),
      closedByAssignee: closedRows.map((row) => ({
        label: row.name,
        count: toCount(row.count),
      })),
    };
  },
);

export const getEmailChannelHealthReport = withAuth(
  async (user, { tenant }, rangeDaysInput?: number): Promise<EmailChannelHealthReport> => {
    const rangeDays = normalizeRangeDays(rangeDaysInput);
    const { knex } = await createTenantKnex();
    await assertCanReadReports(user, knex);

    const [providerRows, summaryRow, statusRows, channelRows] = await Promise.all([
      knex('email_providers')
        .where({ tenant })
        .select('id', 'is_active', 'status'),
      knex('email_processed_messages as epm')
        .leftJoin('tickets as t', function joinTicket() {
          this.on('epm.ticket_id', '=', 't.ticket_id').andOn('epm.tenant', '=', 't.tenant');
        })
        .where('epm.tenant', tenant)
        .where('epm.processed_at', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`))
        .select(
          knex.raw('COUNT(*)::int as processed_emails'),
          knex.raw('COUNT(epm.ticket_id)::int as tickets_created'),
          knex.raw("SUM(CASE WHEN epm.processing_status = 'failed' THEN 1 ELSE 0 END)::int as failed_emails"),
          knex.raw(
            'AVG(CASE WHEN epm.received_at IS NOT NULL AND epm.processed_at IS NOT NULL THEN GREATEST(EXTRACT(EPOCH FROM (epm.processed_at - epm.received_at)) / 60, 0) END) as avg_processing_minutes',
          ),
          knex.raw(
            'AVG(CASE WHEN epm.received_at IS NOT NULL AND t.entered_at IS NOT NULL THEN GREATEST(EXTRACT(EPOCH FROM (t.entered_at - epm.received_at)) / 60, 0) END) as avg_ticket_creation_minutes',
          ),
        )
        .first(),
      knex('email_processed_messages')
        .where({ tenant })
        .where('processed_at', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`))
        .select('processing_status as label')
        .count<{ label: string | null; count: string }[]>('* as count')
        .groupBy('processing_status')
        .orderBy('count', 'desc'),
      knex('email_providers as ep')
        .leftJoin('email_processed_messages as epm', function joinProcessedMessages() {
          this.on('ep.id', '=', 'epm.provider_id')
            .andOn('ep.tenant', '=', 'epm.tenant')
            .andOn('epm.processed_at', '>=', knex.raw(`NOW() - INTERVAL '${rangeDays} days'`));
        })
        .leftJoin('tickets as t', function joinTicket() {
          this.on('epm.ticket_id', '=', 't.ticket_id').andOn('epm.tenant', '=', 't.tenant');
        })
        .where('ep.tenant', tenant)
        .select(
          'ep.id',
          'ep.provider_name',
          'ep.mailbox',
          'ep.provider_type',
          'ep.is_active',
          'ep.status',
          'ep.last_sync_at',
          knex.raw('COUNT(epm.message_id)::int as processed_emails'),
          knex.raw('COUNT(epm.ticket_id)::int as tickets_created'),
          knex.raw("SUM(CASE WHEN epm.processing_status = 'failed' THEN 1 ELSE 0 END)::int as failed_emails"),
          knex.raw(
            'AVG(CASE WHEN epm.received_at IS NOT NULL AND t.entered_at IS NOT NULL THEN GREATEST(EXTRACT(EPOCH FROM (t.entered_at - epm.received_at)) / 60, 0) END) as avg_ticket_creation_minutes',
          ),
        )
        .groupBy(
          'ep.id',
          'ep.tenant',
          'ep.provider_name',
          'ep.mailbox',
          'ep.provider_type',
          'ep.is_active',
          'ep.status',
          'ep.last_sync_at',
        )
        .orderBy('processed_emails', 'desc')
        .orderBy('ep.provider_name', 'asc'),
    ]);

    const totalChannels = providerRows.length;
    const activeChannels = providerRows.filter((row) => row.is_active).length;
    const healthyChannels = providerRows.filter((row) => row.is_active && row.status === 'connected').length;
    const problemChannels = providerRows.filter((row) => row.is_active && row.status !== 'connected').length;

    return {
      rangeDays,
      summary: {
        totalChannels,
        activeChannels,
        healthyChannels,
        problemChannels,
        processedEmails: toCount((summaryRow as any)?.processed_emails),
        ticketsCreated: toCount((summaryRow as any)?.tickets_created),
        failedEmails: toCount((summaryRow as any)?.failed_emails),
        avgProcessingMinutes: toNullableNumber((summaryRow as any)?.avg_processing_minutes),
        avgTicketCreationMinutes: toNullableNumber((summaryRow as any)?.avg_ticket_creation_minutes),
      },
      byStatus: statusRows.map((row) => ({
        label: row.label || 'unknown',
        count: toCount(row.count),
      })),
      channels: channelRows.map((row) => ({
        providerId: row.id,
        providerName: row.provider_name || row.mailbox || 'Unnamed channel',
        mailbox: row.mailbox || '',
        providerType: row.provider_type || 'unknown',
        isActive: Boolean(row.is_active),
        status: row.status || 'unknown',
        processedEmails: toCount(row.processed_emails),
        ticketsCreated: toCount(row.tickets_created),
        failedEmails: toCount(row.failed_emails),
        avgTicketCreationMinutes: toNullableNumber(row.avg_ticket_creation_minutes),
        lastSyncAt: toIsoString(row.last_sync_at),
      })),
    };
  },
);

export const getTicketAgingReport = withAuth(
  async (user, { tenant }, rangeDaysInput?: number): Promise<TicketAgingReport> => {
    const rangeDays = normalizeRangeDays(rangeDaysInput);
    const { knex } = await createTenantKnex();
    await assertCanReadReports(user, knex);

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
