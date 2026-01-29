import type { Knex } from 'knex';

import type {
  SurveyDashboardFilters,
  SurveyDashboardMetrics,
  SurveyDistributionBucket,
  SurveyIssueSummary,
  SurveyResponseListItem,
  SurveyTrendPoint,
  SurveyClientSatisfactionSummary,
  SurveyTicketSatisfactionSummary,
  SurveyResponsePage,
} from '@alga-psa/types';

const RESPONSES_TABLE = 'survey_responses';
const INVITATIONS_TABLE = 'survey_invitations';
const TICKETS_TABLE = 'tickets';
const CLIENTS_TABLE = 'clients';
const CONTACTS_TABLE = 'contacts';
const USERS_TABLE = 'users';
const NEGATIVE_RATING_THRESHOLD = 2;

type SurveyTrendRow = {
  date: Date | string | null;
  average_rating: string | number | null;
  response_count: string | number | null;
};

const SurveyAnalyticsService = {
  async getDashboardMetrics(
    knex: Knex,
    tenantId: string,
    filters?: SurveyDashboardFilters
  ): Promise<SurveyDashboardMetrics> {
    const invitationsQuery = knex(`${INVITATIONS_TABLE} as si`).where('si.tenant', tenantId);
    if (filters?.startDate) {
      invitationsQuery.andWhere('si.sent_at', '>=', filters.startDate);
    }
    if (filters?.endDate) {
      invitationsQuery.andWhere('si.sent_at', '<=', filters.endDate);
    }

    const outstandingInvitationsQuery = invitationsQuery.clone().where('si.responded', false);

    const [
      totalInvitationsRow,
      totalResponsesRow,
      outstandingInvitationsRow,
      averageRatingRow,
      recentNegativeResponsesRow,
    ] = await Promise.all([
      invitationsQuery.clone().count<{ count: string }>('si.invitation_id as count').first(),
      baseResponseQuery(knex, tenantId, filters)
        .clone()
        .count<{ count: string }>('sr.response_id as count')
        .first(),
      outstandingInvitationsQuery
        .clone()
        .count<{ count: string }>('si.invitation_id as count')
        .first(),
      baseResponseQuery(knex, tenantId, filters)
        .clone()
        .avg<{ avg: string }>('sr.rating as avg')
        .first(),
      baseResponseQuery(knex, tenantId, filters)
        .clone()
        .where('sr.rating', '<=', NEGATIVE_RATING_THRESHOLD)
        .count<{ count: string }>('sr.response_id as count')
        .first(),
    ]);

    const totalInvitations = toNumber(totalInvitationsRow?.count);
    const totalResponses = toNumber(totalResponsesRow?.count);
    const outstandingInvitations = toNumber(outstandingInvitationsRow?.count);
    const averageRating = toNullableNumber(averageRatingRow?.avg);
    const recentNegativeResponses = toNumber(recentNegativeResponsesRow?.count);
    const responseRate =
      totalInvitations > 0 ? Number(((totalResponses / totalInvitations) * 100).toFixed(2)) : 0;

    return {
      totalInvitations,
      totalResponses,
      responseRate,
      averageRating,
      outstandingInvitations,
      recentNegativeResponses,
    };
  },

  async getResponseTrend(
    knex: Knex,
    tenantId: string,
    filters?: SurveyDashboardFilters
  ): Promise<SurveyTrendPoint[]> {
    const rows = (await baseResponseQuery(knex, tenantId, filters)
      .select(
        knex.raw("date_trunc('day', sr.submitted_at)::date as date"),
        knex.raw('AVG(sr.rating)::numeric as average_rating'),
        knex.raw('COUNT(sr.response_id) as response_count')
      )
      .groupBy('date')
      .orderBy('date', 'asc')) as unknown as SurveyTrendRow[];

    return rows.map((row) => ({
      date: formatDate(row.date),
      averageRating: toNullableNumber(row.average_rating),
      responseCount: toNumber(row.response_count),
    }));
  },

  async getRatingDistribution(
    knex: Knex,
    tenantId: string,
    totalResponses: number,
    filters?: SurveyDashboardFilters
  ): Promise<SurveyDistributionBucket[]> {
    if (totalResponses === 0) {
      return [];
    }

    const rows = await baseResponseQuery(knex, tenantId, filters)
      .select('sr.rating')
      .count<{ count: string }>('sr.response_id as count')
      .groupBy('sr.rating')
      .orderBy('sr.rating', 'asc') as unknown as Array<{ rating: number; count: string }>;

    return rows.map((row) => {
      const count = toNumber(row.count);
      const percentage = totalResponses > 0 ? Number(((count / totalResponses) * 100).toFixed(2)) : 0;
      const rating =
        typeof row.rating === 'number'
          ? row.rating
          : Number(row.rating ?? 0);

      return {
        rating,
        count,
        percentage,
      };
    });
  },

  async getTopNegativeResponses(
    knex: Knex,
    tenantId: string,
    filters?: SurveyDashboardFilters,
    limit = 5
  ): Promise<SurveyIssueSummary[]> {
    const rows = await baseResponseQuery(knex, tenantId, filters)
      .leftJoin(`${TICKETS_TABLE} as t`, function joinTickets() {
        this.on('sr.ticket_id', '=', 't.ticket_id').andOn('sr.tenant', '=', 't.tenant');
      })
      .leftJoin(`${CLIENTS_TABLE} as c`, function joinClients() {
        this.on('sr.client_id', '=', 'c.client_id').andOn('sr.tenant', '=', 'c.tenant');
      })
      .leftJoin(`${USERS_TABLE} as u`, function joinUsers() {
        this.on('t.assigned_to', '=', 'u.user_id').andOn('t.tenant', '=', 'u.tenant');
      })
      .where('sr.rating', '<=', NEGATIVE_RATING_THRESHOLD)
      .select(
        'sr.response_id',
        'sr.rating',
        'sr.comment',
        'sr.submitted_at',
        't.ticket_id',
        't.ticket_number',
        'c.client_name',
        knex.raw("COALESCE(CONCAT(u.first_name, ' ', u.last_name), '') as technician_name")
      )
      .orderBy('sr.rating', 'asc')
      .orderBy('sr.submitted_at', 'desc')
      .limit(limit);

    return rows.map((row) => ({
      responseId: row.response_id,
      ticketId: row.ticket_id,
      ticketNumber: row.ticket_number ?? null,
      clientName: row.client_name ?? null,
      comment: row.comment ?? null,
      rating: typeof row.rating === 'number' ? row.rating : Number(row.rating ?? 0),
      submittedAt: formatDateTime(row.submitted_at),
      assignedAgentName: row.technician_name ? row.technician_name.trim() || null : null,
    }));
  },

  async getRecentResponses(
    knex: Knex,
    tenantId: string,
    filters?: SurveyDashboardFilters,
    limit = 10
  ): Promise<SurveyResponseListItem[]> {
    const { items } = await this.getResponsesPage(knex, tenantId, {
      filters,
      pageSize: limit,
    });
    return items;
  },

  async getResponsesPage(
    knex: Knex,
    tenantId: string,
    options?: {
      filters?: SurveyDashboardFilters;
      page?: number;
      pageSize?: number;
    }
  ): Promise<SurveyResponsePage> {
    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? 25));
    const filters = options?.filters;

    const baseQuery = baseResponseQuery(knex, tenantId, filters);

    const responsesQuery = baseQuery
      .clone()
      .leftJoin(`${TICKETS_TABLE} as t`, function joinTickets() {
        this.on('sr.ticket_id', '=', 't.ticket_id').andOn('sr.tenant', '=', 't.tenant');
      })
      .leftJoin(`${CLIENTS_TABLE} as c`, function joinClients() {
        this.on('sr.client_id', '=', 'c.client_id').andOn('sr.tenant', '=', 'c.tenant');
      })
      .leftJoin(`${CONTACTS_TABLE} as ct`, function joinContacts() {
        this.on('sr.contact_id', '=', 'ct.contact_name_id').andOn('sr.tenant', '=', 'ct.tenant');
      })
      .leftJoin(`${USERS_TABLE} as u`, function joinUsers() {
        this.on('t.assigned_to', '=', 'u.user_id').andOn('t.tenant', '=', 'u.tenant');
      })
      .select(
        'sr.response_id',
        'sr.rating',
        'sr.comment',
        'sr.submitted_at',
        't.ticket_id',
        't.ticket_number',
        'c.client_name',
        'ct.full_name as contact_name',
        knex.raw("COALESCE(CONCAT(u.first_name, ' ', u.last_name), '') as technician_name")
      )
      .orderBy('sr.submitted_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const countQuery = baseQuery
      .clone()
      .countDistinct<{ count: string }>('sr.response_id as count')
      .first();

    const [rows, totalCountRow] = await Promise.all([responsesQuery, countQuery]);
    const totalCount = toNumber(totalCountRow?.count);

    const items = rows.map((row) => ({
      responseId: row.response_id,
      ticketId: row.ticket_id,
      ticketNumber: row.ticket_number ?? null,
      clientName: row.client_name ?? null,
      contactName: row.contact_name ?? null,
      rating: typeof row.rating === 'number' ? row.rating : Number(row.rating ?? 0),
      comment: row.comment ?? null,
      submittedAt: formatDateTime(row.submitted_at),
      technicianName: row.technician_name ? row.technician_name.trim() || null : null,
    }));

    const hasMore = page * pageSize < totalCount;

    return {
      items,
      totalCount,
      page,
      pageSize,
      hasMore,
    };
  },

  async getClientSummary(
    knex: Knex,
    tenantId: string,
    clientId: string
  ): Promise<SurveyClientSatisfactionSummary | null> {
    const [clientRow, invitationCounts, responseCounts, averageRatingRow, lastResponseRow, trendRows] =
      await Promise.all([
        knex(`${CLIENTS_TABLE} as c`)
          .select('c.client_id', 'c.client_name')
          .where({ 'c.tenant': tenantId, 'c.client_id': clientId })
          .first(),
        knex(`${INVITATIONS_TABLE} as si`)
          .count<{ count: string }>('si.invitation_id as count')
          .where({ 'si.tenant': tenantId, 'si.client_id': clientId })
          .first(),
        knex(`${RESPONSES_TABLE} as sr`)
          .count<{ count: string }>('sr.response_id as count')
          .where({ 'sr.tenant': tenantId, 'sr.client_id': clientId })
          .first(),
        knex(`${RESPONSES_TABLE} as sr`)
          .avg<{ avg: string }>('sr.rating as avg')
          .where({ 'sr.tenant': tenantId, 'sr.client_id': clientId })
          .first(),
        knex(`${RESPONSES_TABLE} as sr`)
          .select('sr.submitted_at')
          .where({ 'sr.tenant': tenantId, 'sr.client_id': clientId })
          .orderBy('sr.submitted_at', 'desc')
          .first(),
        knex(`${RESPONSES_TABLE} as sr`)
          .select(
            knex.raw("date_trunc('month', sr.submitted_at)::date as date"),
            knex.raw('AVG(sr.rating)::numeric as average_rating'),
            knex.raw('COUNT(sr.response_id) as response_count')
          )
          .where({ 'sr.tenant': tenantId, 'sr.client_id': clientId })
          .groupBy('date')
          .orderBy('date', 'asc'),
      ]);

    if (!clientRow) {
      return null;
    }

    const invitations = toNumber(invitationCounts?.count);
    const responses = toNumber(responseCounts?.count);
    const responseRate = invitations > 0 ? Number(((responses / invitations) * 100).toFixed(2)) : null;

    return {
      clientId: clientRow.client_id,
      clientName: clientRow.client_name ?? null,
      totalResponses: responses,
      averageRating: toNullableNumber(averageRatingRow?.avg),
      lastResponseAt: lastResponseRow ? formatDateTime(lastResponseRow.submitted_at) : null,
      responseRate,
      trend: (trendRows as unknown as SurveyTrendRow[]).map((row) => ({
        date: formatDate(row.date),
        averageRating: toNullableNumber(row.average_rating),
        responseCount: toNumber(row.response_count),
      })),
    };
  },

  async getTicketSummary(
    knex: Knex,
    tenantId: string,
    ticketId: string
  ): Promise<SurveyTicketSatisfactionSummary | null> {
    const ticketRow = await knex(`${TICKETS_TABLE} as t`)
      .select('t.ticket_id', 't.ticket_number')
      .where({ 't.tenant': tenantId, 't.ticket_id': ticketId })
      .first();

    if (!ticketRow) {
      return null;
    }

    const [latestResponseRow, responseCountRow] = await Promise.all([
      knex(`${RESPONSES_TABLE} as sr`)
        .select('sr.rating', 'sr.comment', 'sr.submitted_at')
        .where({ 'sr.tenant': tenantId, 'sr.ticket_id': ticketId })
        .orderBy('sr.submitted_at', 'desc')
        .first(),
      knex(`${RESPONSES_TABLE} as sr`)
        .count<{ count: string }>('sr.response_id as count')
        .where({ 'sr.tenant': tenantId, 'sr.ticket_id': ticketId })
        .first(),
    ]);

    return {
      ticketId: ticketRow.ticket_id,
      ticketNumber: ticketRow.ticket_number ?? null,
      latestResponseRating: latestResponseRow?.rating ?? null,
      latestResponseComment: latestResponseRow?.comment ?? null,
      latestResponseAt: latestResponseRow ? formatDateTime(latestResponseRow.submitted_at) : null,
      totalResponses: toNumber(responseCountRow?.count),
    };
  }

};

export default SurveyAnalyticsService;

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    return value.split('T')[0];
  }
  return '';
}

function formatDateTime(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

function baseResponseQuery(knex: Knex, tenantId: string, filters?: SurveyDashboardFilters) {
  const query = knex(`${RESPONSES_TABLE} as sr`).where('sr.tenant', tenantId);

  if (filters?.startDate) {
    query.andWhere('sr.submitted_at', '>=', filters.startDate);
  }
  if (filters?.endDate) {
    query.andWhere('sr.submitted_at', '<=', filters.endDate);
  }
  if (filters?.clientId) {
    query.andWhere('sr.client_id', filters.clientId);
  }
  if (filters?.templateId) {
    query.andWhere('sr.template_id', filters.templateId);
  }
  if (filters?.technicianId) {
    query.leftJoin(`${TICKETS_TABLE} as t_filter`, function joinTickets() {
      this.on('sr.ticket_id', '=', 't_filter.ticket_id').andOn('sr.tenant', '=', 't_filter.tenant');
    });
    query.andWhere('t_filter.assigned_to', filters.technicianId);
  }

  return query;
}
