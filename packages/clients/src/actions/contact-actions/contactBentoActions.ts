'use server'

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { assertMspPermission } from '../../lib/authHelpers';
import type { Knex } from 'knex';

export interface ContactTicketSummaryRow {
  ticket_id: string;
  ticket_number: string | number | null;
  title: string | null;
  entered_at: string | null;
  status_name: string | null;
  is_closed: boolean;
  priority_name: string | null;
  urgency: string | null;
  itil_urgency: number | null;
}

export interface ContactTicketsSummary {
  rows: ContactTicketSummaryRow[];
  openCount: number;
  urgentCount: number;
  totalCount: number;
}

export interface ContactStatsSummary {
  openTickets: number;
  urgentTickets: number;
  totalTickets: number;
  lastInteraction: {
    title: string | null;
    type: string | null;
    date: string | null;
  } | null;
  satisfaction: {
    average: number | null;
    count: number;
  };
}

export interface ContactPortalSummary {
  hasAccount: boolean;
  accountInactive: boolean;
  lastSignIn: string | null;
  invitedAt: string | null;
}

export interface ContactRelatedWorkSummary {
  projects: Array<{
    project_id: string;
    project_name: string | null;
    project_number: string | number | null;
    status_name: string | null;
  }>;
  quotes: Array<{
    quote_id: string;
    quote_number: string | null;
    title: string | null;
    total_amount: number | string | null;
    status: string | null;
    currency_code: string | null;
  }>;
}

function scopedTable(trx: Knex | Knex.Transaction, tenant: string, table: string) {
  return tenantDb(trx, tenant).table(table);
}

// Tenants name urgencies freely; ITIL urgency (1=High … 5=Low) is the stable signal.
const URGENT_TICKET_CONDITION =
  "(LOWER(COALESCE(u.urgency_name, '')) IN ('critical', 'high', 'urgent') OR COALESCE(t.itil_urgency, 5) <= 2)";

function asCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
  return 0;
}

async function fetchTicketSummary(trx: Knex.Transaction, tenant: string, contactId: string): Promise<ContactTicketsSummary> {
  const rows = await scopedTable(trx, tenant, 'tickets as t')
    .leftJoin('statuses as s', function joinStatus() {
      this.on('s.status_id', '=', 't.status_id').andOn('s.tenant', '=', 't.tenant');
    })
    .leftJoin('priorities as p', function joinPriority() {
      this.on('p.priority_id', '=', 't.priority_id').andOn('p.tenant', '=', 't.tenant');
    })
    .leftJoin('urgencies as u', function joinUrgency() {
      this.on('u.urgency_id', '=', 't.urgency_id').andOn('u.tenant', '=', 't.tenant');
    })
    .where('t.contact_name_id', contactId)
    .select(
      't.ticket_id',
      't.ticket_number',
      't.title',
      't.entered_at',
      't.is_closed',
      't.itil_urgency',
      'u.urgency_name as urgency',
      's.name as status_name',
      'p.priority_name',
    )
    .orderByRaw('COALESCE(t.is_closed, false) ASC')
    .orderByRaw(`CASE WHEN ${URGENT_TICKET_CONDITION} THEN 0 ELSE 1 END`)
    .orderBy('t.entered_at', 'desc')
    .limit(5);

  const [openResult, urgentResult, totalResult] = await Promise.all([
    scopedTable(trx, tenant, 'tickets')
      .where({ contact_name_id: contactId })
      .where((builder) => builder.where('is_closed', false).orWhereNull('is_closed'))
      .count<{ count: string | number }[]>('ticket_id as count'),
    scopedTable(trx, tenant, 'tickets as t')
      .leftJoin('urgencies as u', function joinUrgency() {
        this.on('u.urgency_id', '=', 't.urgency_id').andOn('u.tenant', '=', 't.tenant');
      })
      .where('t.contact_name_id', contactId)
      .where((builder) => builder.where('t.is_closed', false).orWhereNull('t.is_closed'))
      .whereRaw(URGENT_TICKET_CONDITION)
      .count<{ count: string | number }[]>('t.ticket_id as count'),
    scopedTable(trx, tenant, 'tickets')
      .where({ contact_name_id: contactId })
      .count<{ count: string | number }[]>('ticket_id as count'),
  ]);

  return {
    rows: rows.map((row: any) => ({
      ticket_id: row.ticket_id,
      ticket_number: row.ticket_number ?? null,
      title: row.title ?? null,
      entered_at: row.entered_at ? new Date(row.entered_at).toISOString() : null,
      status_name: row.status_name ?? null,
      is_closed: Boolean(row.is_closed),
      priority_name: row.priority_name ?? null,
      urgency: row.urgency ?? null,
      itil_urgency: row.itil_urgency ?? null,
    })),
    openCount: asCount(openResult[0]?.count),
    urgentCount: asCount(urgentResult[0]?.count),
    totalCount: asCount(totalResult[0]?.count),
  };
}

export const getContactTicketsSummary = withAuth(async (
  user,
  { tenant },
  contactId: string,
): Promise<ContactTicketsSummary> => {
  await assertMspPermission(user, 'ticket', 'read', 'Permission denied: Cannot read tickets');
  const { knex } = await createTenantKnex();
  return withTransaction(knex, (trx) => fetchTicketSummary(trx, tenant, contactId));
});

export const getContactStats = withAuth(async (
  user,
  { tenant },
  contactId: string,
): Promise<ContactStatsSummary> => {
  await assertMspPermission(user, 'contact', 'read', 'Permission denied: Cannot read contacts');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx) => {
    const [tickets, lastInteraction, surveyRows] = await Promise.all([
      fetchTicketSummary(trx, tenant, contactId),
      scopedTable(trx, tenant, 'interactions as i')
        .leftJoin('interaction_types as it', function joinInteractionType() {
          this.on('it.type_id', '=', 'i.type_id').andOn('it.tenant', '=', 'i.tenant');
        })
        // system_interaction_types is a system-wide table with no tenant column.
        .leftJoin('system_interaction_types as sit', function joinSystemInteractionType() {
          this.on('sit.type_id', '=', 'i.type_id');
        })
        .where('i.contact_name_id', contactId)
        .select('i.title', trx.raw('COALESCE(it.type_name, sit.type_name) as type_name'), 'i.interaction_date')
        .orderBy('i.interaction_date', 'desc')
        .first(),
      scopedTable(trx, tenant, 'survey_responses')
        .where({ contact_id: contactId })
        .avg<{ average: string | number | null }[]>('rating as average')
        .count<{ count: string | number }[]>('response_id as count'),
    ]);

    const survey = surveyRows[0] as any;

    return {
      openTickets: tickets.openCount,
      urgentTickets: tickets.urgentCount,
      totalTickets: tickets.totalCount,
      lastInteraction: lastInteraction
        ? {
            title: lastInteraction.title ?? null,
            type: lastInteraction.type_name ?? null,
            date: lastInteraction.interaction_date ? new Date(lastInteraction.interaction_date).toISOString() : null,
          }
        : null,
      satisfaction: {
        average: survey?.average == null ? null : Number(survey.average),
        count: asCount(survey?.count),
      },
    };
  });
});

export const getContactPortalSummary = withAuth(async (
  user,
  { tenant },
  contactId: string,
): Promise<ContactPortalSummary> => {
  await assertMspPermission(user, 'contact', 'read', 'Permission denied: Cannot read contacts');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx) => {
    const [portalUser, latestInvitation] = await Promise.all([
      scopedTable(trx, tenant, 'users')
        .where({ contact_id: contactId, user_type: 'client' })
        .select('is_inactive', 'last_login_at')
        .first(),
      scopedTable(trx, tenant, 'portal_invitations')
        .where({ contact_id: contactId })
        .orderBy('created_at', 'desc')
        .select('created_at')
        .first(),
    ]);

    return {
      hasAccount: Boolean(portalUser),
      accountInactive: Boolean(portalUser?.is_inactive),
      lastSignIn: portalUser?.last_login_at ? new Date(portalUser.last_login_at).toISOString() : null,
      invitedAt: latestInvitation?.created_at ? new Date(latestInvitation.created_at).toISOString() : null,
    };
  });
});

export const getContactRelatedWork = withAuth(async (
  user,
  { tenant },
  contactId: string,
): Promise<ContactRelatedWorkSummary> => {
  await assertMspPermission(user, 'contact', 'read', 'Permission denied: Cannot read contacts');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx) => {
    const [projects, quotes] = await Promise.all([
      scopedTable(trx, tenant, 'projects as p')
        .leftJoin('statuses as s', function joinStatus() {
          this.on('s.status_id', '=', 'p.status').andOn('s.tenant', '=', 'p.tenant');
        })
        .where('p.contact_name_id', contactId)
        .select('p.project_id', 'p.project_name', 'p.project_number', 's.name as status_name')
        .orderBy('p.updated_at', 'desc')
        .limit(3),
      scopedTable(trx, tenant, 'quotes')
        .where({ contact_id: contactId })
        .select('quote_id', 'quote_number', 'title', 'total_amount', 'status', 'currency_code')
        .orderBy('updated_at', 'desc')
        .limit(3),
    ]);

    return {
      projects: projects.map((project: any) => ({
        project_id: project.project_id,
        project_name: project.project_name ?? null,
        project_number: project.project_number ?? null,
        status_name: project.status_name ?? null,
      })),
      quotes: quotes.map((quote: any) => ({
        quote_id: quote.quote_id,
        quote_number: quote.quote_number ?? null,
        title: quote.title ?? null,
        total_amount: quote.total_amount ?? null,
        status: quote.status ?? null,
        currency_code: quote.currency_code ?? null,
      })),
    };
  });
});
