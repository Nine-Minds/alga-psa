'use server'

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal dashboard actions intentionally compose ticket visibility helpers to keep dashboard counts and recent activity aligned with canonical client portal ticket visibility rules. */

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  applyVisibilityBoardFilter,
} from '@alga-psa/tickets/lib';
import { getClientContactVisibilityContext } from '@alga-psa/tickets/lib/clientPortalVisibility.server';

export interface DashboardMetrics {
  openTickets: number;
  activeProjects: number;
  pendingInvoices: number;
  activeAssets: number;
  /**
   * Total service request submissions for this client. The execution_status
   * column flips from 'pending' → 'succeeded' almost immediately on the default
   * provider, so a "pending only" count would almost always read 0; total is
   * the more useful at-a-glance number.
   */
  serviceRequests: number;
}

export type RecentActivityType =
  | 'ticket'
  | 'invoice'
  | 'asset'
  | 'quote'
  | 'project'
  | 'service_request'
  | 'appointment';

export interface RecentActivity {
  type: RecentActivityType;
  /**
   * Untranslated noun for the activity (ticket title, invoice number, asset
   * name, project name, etc.). The client builds the localized title via
   * i18next using `dashboard.activity.titles.<type>` with `{ name }`
   * interpolation — keeping the action locale-agnostic.
   */
  name: string;
  /** @deprecated Pre-localized title kept for backwards compatibility; new clients should use `name`. */
  title: string;
  timestamp: string;
  description: string;
  /**
   * Optional sub-type for activities that share a top-level type but render
   * differently (e.g. `quote.accepted` vs `quote.sent`). The client maps this
   * to a translation key under `dashboard.activity.titles.<type>.<status>`.
   */
  status?: string;
}

type RecentInvoiceActivityRow = {
  invoice_number: string;
  total: string | number | null;
  timestamp: string;
  service_period_start?: string | Date | null;
  service_period_end?: string | Date | null;
};

type RecentTicketActivityRow = {
  title: string;
  timestamp: string;
  description: string | null;
};

type RecentAssetActivityRow = {
  asset_name: string;
  timestamp: string;
  description: string | null;
};

type RecentQuoteActivityRow = {
  quote_number: string | null;
  title: string | null;
  status: string | null;
  timestamp: string | Date;
};

type RecentProjectActivityRow = {
  name: string;
  description: string | null;
  timestamp: string | Date;
};

type RecentServiceRequestActivityRow = {
  name: string;
  status: string;
  execution_error_summary: string | null;
  timestamp: string | Date;
};

type RecentAppointmentActivityRow = {
  name: string | null;
  status: string;
  declined_reason: string | null;
  timestamp: string | Date;
};

/**
 * Extracts plain text from a BlockNote JSON string. Ticket descriptions and
 * comments are stored as serialized BlockNote (an array of blocks). Falls back
 * to the raw string if it's not parseable as BlockNote — covers legacy
 * plain-text rows.
 */
function extractPlainTextFromBlockNote(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return raw;
    const lines: string[] = [];
    for (const block of parsed) {
      const content = (block as { content?: unknown }).content;
      if (Array.isArray(content)) {
        const line = content
          .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
          .join('')
          .trim();
        if (line) lines.push(line);
      }
    }
    return lines.join('\n');
  } catch {
    return raw;
  }
}

function summarizeForActivity(raw: string | null | undefined, maxLength = 200): string {
  const text = extractPlainTextFromBlockNote(raw).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

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

  const userContactId = user.contact_id;
  const { knex } = await createTenantKnex();

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      // Get client_id from contact
      const contact = await scopedDb.table('contacts')
        .where({
          'contact_name_id': userContactId,
        })
        .select('client_id')
        .first();

      if (!contact) {
        throw new Error('Unauthorized: Client information not found');
      }

      const clientId = contact.client_id;
      const visibility = await getClientContactVisibilityContext(trx, tenant, userContactId);

        const [
          [ticketCount],
          [projectCount],
          [invoiceCount],
          [assetCount],
          [serviceRequestCount],
        ] = await Promise.all([
        // Get open tickets count
        applyVisibilityBoardFilter(
          scopedDb.table('tickets')
            .where({
              'tickets.client_id': clientId,
              'is_closed': false
            }),
          visibility.visibleBoardIds,
          'tickets.board_id'
        ).count('ticket_id as count') as unknown as Promise<Array<{ count: string }>>,

        // Get active projects count
        scopedDb.table('projects')
          .where({
            'projects.client_id': clientId,
            'is_inactive': false
          })
          .count('project_id as count') as unknown as Promise<Array<{ count: string }>>,

        // Pending invoice counts remain financial-document / invoice-state
        // metrics. They should not silently pivot to recurring coverage dates.
        scopedDb.table('invoices')
          .where({
            'invoices.client_id': clientId
          })
          .whereNull('finalized_at')
          .count('* as count') as unknown as Promise<Array<{ count: string }>>,

        // Get active assets count
        scopedDb.table('assets')
          .where({
            'assets.client_id': clientId
          })
          .andWhere('status', '!=', 'inactive')
          .count('* as count') as unknown as Promise<Array<{ count: string }>>,

        // Total service request submissions for this client (any status).
        scopedDb.table('service_request_submissions')
          .where({
            'client_id': clientId,
          })
          .count('* as count') as unknown as Promise<Array<{ count: string }>>,
      ]);

      return {
        openTickets: Number(ticketCount.count || 0),
        activeProjects: Number(projectCount.count || 0),
        pendingInvoices: Number(invoiceCount.count || 0),
        activeAssets: Number(assetCount.count || 0),
        serviceRequests: Number(serviceRequestCount.count || 0),
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

  const userContactId = user.contact_id;
  const { knex } = await createTenantKnex();

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      // Get client_id from contact
      const contact = await scopedDb.table('contacts')
        .where({
          'contact_name_id': userContactId,
        })
        .select('client_id')
        .first();

      if (!contact) {
        throw new Error('Unauthorized: Client information not found');
      }

      const clientId = contact.client_id;
      const visibility = await getClientContactVisibilityContext(trx, tenant, userContactId);

      // Get recent tickets with their initial descriptions
      const ticketsQuery = scopedDb.table('tickets')
        .select([
          'tickets.title',
          'tickets.updated_at as timestamp',
          'comments.note as description'
        ]);
      scopedDb.tenantJoin(ticketsQuery, 'comments', 'tickets.ticket_id', 'comments.ticket_id', { type: 'left' });
      const tickets = await ticketsQuery
        .where({
          'tickets.client_id': clientId
        })
        .modify((queryBuilder: Knex.QueryBuilder) => {
          applyVisibilityBoardFilter(queryBuilder, visibility.visibleBoardIds, 'tickets.board_id');
        })
        .orderBy('tickets.updated_at', 'desc')
        .limit(3);

      // Get recent invoices.
      // Drafts (no finalized_at) are not visible to client portal users —
      // mirror the InvoicesTab/getClientInvoices contract here so the activity
      // feed never surfaces an invoice the client can't actually open.
      const invoicesQuery = scopedDb.table('invoices as inv')
        .select([
          'inv.invoice_number',
          'inv.total_amount as total',
          'inv.updated_at as timestamp',
          trx.raw('MIN(iid.service_period_start) as service_period_start'),
          trx.raw('MAX(iid.service_period_end) as service_period_end'),
        ]);
      scopedDb.tenantJoin(invoicesQuery, 'invoice_charges as ic', 'inv.invoice_id', 'ic.invoice_id', { type: 'left' });
      scopedDb.tenantJoin(invoicesQuery, 'invoice_charge_details as iid', 'ic.item_id', 'iid.item_id', { type: 'left' });
      const invoices = await invoicesQuery
        .whereNotNull('inv.finalized_at')
        .where({
          'inv.client_id': clientId
        })
        .groupBy('inv.invoice_id', 'inv.invoice_number', 'inv.total_amount', 'inv.updated_at')
        .orderBy('inv.updated_at', 'desc')
        .limit(3);

      // Get recent asset maintenance activities
      const assetActivitiesQuery = scopedDb.table('asset_maintenance_history')
        .select([
          'asset_maintenance_history.description',
          'asset_maintenance_history.performed_at as timestamp',
          'assets.name as asset_name'
        ]);
      scopedDb.tenantJoin(assetActivitiesQuery, 'assets', 'assets.asset_id', 'asset_maintenance_history.asset_id');
      const assetActivities = await assetActivitiesQuery
        .where({
          'assets.client_id': clientId
        })
        .orderBy('asset_maintenance_history.performed_at', 'desc')
        .limit(3);

      // Recent quotes — only the client-meaningful state transitions
      // (sent/accepted/rejected/expired) so we don't flood the feed with
      // internal draft churn.
      const quotes = await scopedDb.table('quotes')
        .where({ client_id: clientId })
        .whereIn('status', ['sent', 'accepted', 'rejected', 'expired'])
        .select(['quote_number', 'title', 'status', 'updated_at as timestamp'])
        .orderBy('updated_at', 'desc')
        .limit(3);

      // Recent project updates for this client.
      const projects = await scopedDb.table('projects')
        .where({ client_id: clientId })
        .select(['project_name as name', 'description', 'updated_at as timestamp'])
        .orderBy('updated_at', 'desc')
        .limit(3);

      // Recent service request submissions.
      const serviceRequests = await scopedDb.table('service_request_submissions')
        .where({ client_id: clientId })
        .select([
          'request_name as name',
          'execution_status as status',
          'execution_error_summary',
          'created_at as timestamp',
        ])
        .orderBy('created_at', 'desc')
        .limit(3);

      // Recent appointment requests (status transitions).
      const appointmentsQuery = scopedDb.table('appointment_requests as ar');
      scopedDb.tenantJoin(appointmentsQuery, 'service_catalog as sc', 'ar.service_id', 'sc.service_id', { type: 'left' });
      const appointments = await appointmentsQuery
        .where({ 'ar.client_id': clientId })
        .select([
          'sc.service_name as name',
          'ar.status',
          'ar.declined_reason',
          'ar.updated_at as timestamp',
        ])
        .orderBy('ar.updated_at', 'desc')
        .limit(3);

      return {
        tickets: tickets as RecentTicketActivityRow[],
        invoices: invoices as unknown as RecentInvoiceActivityRow[],
        assetActivities: assetActivities as RecentAssetActivityRow[],
        quotes: quotes as RecentQuoteActivityRow[],
        projects: projects as RecentProjectActivityRow[],
        serviceRequests: serviceRequests as RecentServiceRequestActivityRow[],
        appointments: appointments as RecentAppointmentActivityRow[],
      };
    });

    // Combine and sort activities. Each branch returns the untranslated `name`
    // and (where applicable) a `status` sub-type so the client can pick the
    // right translation key (`dashboard.activity.titles.<type>` or
    // `<type>.<status>`).
    const activities: RecentActivity[] = [
      ...result.tickets.map((t): RecentActivity => ({
        type: 'ticket',
        name: t.title,
        title: `New ticket: ${t.title}`,
        timestamp: t.timestamp,
        // Plain-text comment summary; left empty when there's no description so
        // the client can fall through to a localized placeholder if it wants one.
        description: summarizeForActivity(t.description),
      })),
      ...result.invoices.map((i): RecentActivity => ({
        type: 'invoice',
        name: i.invoice_number,
        title: `Invoice ${i.invoice_number} generated`,
        timestamp: i.timestamp,
        description: formatRecentInvoiceDescription(i)
      })),
      ...result.assetActivities.map((a): RecentActivity => ({
        type: 'asset',
        name: a.asset_name,
        title: `Asset maintenance: ${a.asset_name}`,
        timestamp: a.timestamp,
        description: a.description ?? ''
      })),
      ...result.quotes.map((q): RecentActivity => ({
        type: 'quote',
        name: q.quote_number || q.title || '',
        title: `Quote ${q.quote_number ?? ''}`,
        status: q.status ?? undefined,
        timestamp: q.timestamp instanceof Date ? q.timestamp.toISOString() : q.timestamp,
        description: q.title ?? '',
      })),
      ...result.projects.map((p): RecentActivity => ({
        type: 'project',
        name: p.name,
        title: `Project updated: ${p.name}`,
        timestamp: p.timestamp instanceof Date ? p.timestamp.toISOString() : p.timestamp,
        description: p.description ?? '',
      })),
      ...result.serviceRequests.map((s): RecentActivity => ({
        type: 'service_request',
        name: s.name,
        title: `Service request: ${s.name}`,
        status: s.status,
        timestamp: s.timestamp instanceof Date ? s.timestamp.toISOString() : s.timestamp,
        description: s.execution_error_summary || '',
      })),
      ...result.appointments.map((a): RecentActivity => ({
        type: 'appointment',
        name: a.name || '',
        title: `Appointment: ${a.name ?? ''}`,
        status: a.status,
        timestamp: a.timestamp instanceof Date ? a.timestamp.toISOString() : a.timestamp,
        // Only surface declined_reason for the 'declined' status — that's
        // operator-authored explanatory text. For 'cancelled', the column
        // contains a system-generated English string ("Cancelled by client")
        // written by cancelAppointmentRequest, which we don't want to leak as
        // user-visible (untranslated) copy. The status-specific title is
        // already enough to convey the event.
        description: a.status === 'declined' ? (a.declined_reason || '') : '',
      })),
    ]
      .filter((entry) => entry.name) // drop rows with no display name
      .sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, 8);

    return activities;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unauthorized')) {
      throw error;
    }
    console.error('Error fetching recent activity:', error);
    throw new Error('Failed to fetch recent activity');
  }
});
