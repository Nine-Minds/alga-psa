'use server'

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal dashboard actions intentionally compose ticket visibility helpers to keep dashboard counts and recent activity aligned with canonical client portal ticket visibility rules. */

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  applyVisibilityBoardFilter,
  getClientContactVisibilityContext
} from '@alga-psa/tickets/lib';

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
      // Get client_id from contact
      const contact = await trx('contacts')
        .where({
          'contact_name_id': userContactId,
          'tenant': tenant
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
          trx('tickets')
            .where({
              'tickets.tenant': tenant,
              'tickets.client_id': clientId,
              'is_closed': false
            }),
          visibility.visibleBoardIds,
          'tickets.board_id'
        ).count('ticket_id as count'),

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
          .count('* as count'),

        // Total service request submissions for this client (any status).
        trx('service_request_submissions')
          .where({
            'tenant': tenant,
            'client_id': clientId,
          })
          .count('* as count'),
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
      // Get client_id from contact
      const contact = await trx('contacts')
        .where({
          'contact_name_id': userContactId,
          'tenant': tenant
        })
        .select('client_id')
        .first();

      if (!contact) {
        throw new Error('Unauthorized: Client information not found');
      }

      const clientId = contact.client_id;
      const visibility = await getClientContactVisibilityContext(trx, tenant, userContactId);

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
        .modify((queryBuilder: Knex.QueryBuilder) => {
          applyVisibilityBoardFilter(queryBuilder, visibility.visibleBoardIds, 'tickets.board_id');
        })
        .orderBy('tickets.updated_at', 'desc')
        .limit(3);

      // Get recent invoices.
      // Drafts (no finalized_at) are not visible to client portal users —
      // mirror the InvoicesTab/getClientInvoices contract here so the activity
      // feed never surfaces an invoice the client can't actually open.
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
        .whereNotNull('inv.finalized_at')
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

      // Recent quotes — only the client-meaningful state transitions
      // (sent/accepted/rejected/expired) so we don't flood the feed with
      // internal draft churn.
      const quotes = await trx('quotes')
        .where({ tenant, client_id: clientId })
        .whereIn('status', ['sent', 'accepted', 'rejected', 'expired'])
        .select(['quote_number', 'title', 'status', 'updated_at as timestamp'])
        .orderBy('updated_at', 'desc')
        .limit(3);

      // Recent project updates for this client.
      const projects = await trx('projects')
        .where({ tenant, client_id: clientId })
        .select(['project_name as name', 'description', 'updated_at as timestamp'])
        .orderBy('updated_at', 'desc')
        .limit(3);

      // Recent service request submissions.
      const serviceRequests = await trx('service_request_submissions')
        .where({ tenant, client_id: clientId })
        .select([
          'request_name as name',
          'execution_status as status',
          'execution_error_summary',
          'created_at as timestamp',
        ])
        .orderBy('created_at', 'desc')
        .limit(3);

      // Recent appointment requests (status transitions).
      const appointments = await trx('appointment_requests as ar')
        .leftJoin('service_catalog as sc', function () {
          this.on('ar.service_id', '=', 'sc.service_id').andOn('ar.tenant', '=', 'sc.tenant');
        })
        .where({ 'ar.tenant': tenant, 'ar.client_id': clientId })
        .select([
          'sc.service_name as name',
          'ar.status',
          'ar.declined_reason',
          'ar.updated_at as timestamp',
        ])
        .orderBy('ar.updated_at', 'desc')
        .limit(3);

      return { tickets, invoices, assetActivities, quotes, projects, serviceRequests, appointments };
    });

    // Combine and sort activities. Each branch returns the untranslated `name`
    // and (where applicable) a `status` sub-type so the client can pick the
    // right translation key (`dashboard.activity.titles.<type>` or
    // `<type>.<status>`).
    const activities: RecentActivity[] = [
      ...result.tickets.map((t: { title: string; timestamp: string; description: string }): RecentActivity => ({
        type: 'ticket',
        name: t.title,
        title: `New ticket: ${t.title}`,
        timestamp: t.timestamp,
        // Plain-text comment summary; left empty when there's no description so
        // the client can fall through to a localized placeholder if it wants one.
        description: summarizeForActivity(t.description),
      })),
      ...result.invoices.map((i: RecentInvoiceActivityRow): RecentActivity => ({
        type: 'invoice',
        name: i.invoice_number,
        title: `Invoice ${i.invoice_number} generated`,
        timestamp: i.timestamp,
        description: formatRecentInvoiceDescription(i)
      })),
      ...result.assetActivities.map((a: { asset_name: string; timestamp: string; description: string }): RecentActivity => ({
        type: 'asset',
        name: a.asset_name,
        title: `Asset maintenance: ${a.asset_name}`,
        timestamp: a.timestamp,
        description: a.description
      })),
      ...result.quotes.map((q: { quote_number: string | null; title: string | null; status: string | null; timestamp: string | Date }): RecentActivity => ({
        type: 'quote',
        name: q.quote_number || q.title || '',
        title: `Quote ${q.quote_number ?? ''}`,
        status: q.status ?? undefined,
        timestamp: q.timestamp instanceof Date ? q.timestamp.toISOString() : q.timestamp,
        description: q.title ?? '',
      })),
      ...result.projects.map((p: { name: string; description: string | null; timestamp: string | Date }): RecentActivity => ({
        type: 'project',
        name: p.name,
        title: `Project updated: ${p.name}`,
        timestamp: p.timestamp instanceof Date ? p.timestamp.toISOString() : p.timestamp,
        description: p.description ?? '',
      })),
      ...result.serviceRequests.map((s: { name: string; status: string; execution_error_summary: string | null; timestamp: string | Date }): RecentActivity => ({
        type: 'service_request',
        name: s.name,
        title: `Service request: ${s.name}`,
        status: s.status,
        timestamp: s.timestamp instanceof Date ? s.timestamp.toISOString() : s.timestamp,
        description: s.execution_error_summary || '',
      })),
      ...result.appointments.map((a: { name: string | null; status: string; declined_reason: string | null; timestamp: string | Date }): RecentActivity => ({
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
