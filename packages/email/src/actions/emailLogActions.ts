'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import type { PaginatedResult } from '@alga-psa/types';

export interface EmailSendingLogRecord {
  id: number;
  tenant: string;
  message_id: string | null;
  provider_id: string;
  provider_type: string;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[] | null;
  bcc_addresses: string[] | null;
  subject: string | null;
  status: 'sent' | 'failed' | 'bounced' | 'delivered' | 'opened' | 'clicked';
  error_message: string | null;
  metadata: Record<string, any> | null;
  sent_at: Date;
  delivered_at: Date | null;
  opened_at: Date | null;
  clicked_at: Date | null;
  entity_type: string | null;
  entity_id: string | null;
  contact_id: string | null;
  notification_subtype_id: number | null;
  created_at: Date;
  updated_at: Date;
}

export const getEmailLogsForTicket = withAuth(
  async (
    _user,
    { tenant },
    ticketId: string,
    options?: { limit?: number }
  ): Promise<EmailSendingLogRecord[]> => {
    const { knex } = await createTenantKnex();
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 200);

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      return trx<EmailSendingLogRecord>('email_sending_logs')
        .select(
          'id',
          'tenant',
          'message_id',
          'provider_id',
          'provider_type',
          'from_address',
          'to_addresses',
          'cc_addresses',
          'bcc_addresses',
          'subject',
          'status',
          'error_message',
          'metadata',
          'sent_at',
          'delivered_at',
          'opened_at',
          'clicked_at',
          'entity_type',
          'entity_id',
          'contact_id',
          'notification_subtype_id',
          'created_at',
          'updated_at'
        )
        .where({
          tenant,
          entity_type: 'ticket',
          entity_id: ticketId
        })
        .orderBy('sent_at', 'desc')
        .limit(limit);
    });
  }
);

export interface EmailLogFilters {
  page?: number;
  pageSize?: number;
  /**
   * Filter by sent_at >= startDate (ISO string).
   */
  startDate?: string;
  /**
   * Filter by sent_at <= endDate (ISO string).
   */
  endDate?: string;
  status?: EmailSendingLogRecord['status'];
  /**
   * Case-insensitive substring match against recipient(s).
   * (matches against to_addresses JSON payload)
   */
  recipientEmail?: string;
  /**
   * Case-insensitive substring match against ticket number.
   * Only applies for entity_type='ticket'.
   */
  ticketNumber?: string;
  sortBy?: 'sent_at';
  sortDirection?: 'asc' | 'desc';
}

export type EmailSendingLogListRecord = EmailSendingLogRecord & {
  ticket_number: string | null;
};

function parseDateFilter(input: string): Date | null {
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateOnlyEndExclusive(input: string): Date | null {
  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateOnlyPattern.test(input)) return null;

  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed;
}

export const getEmailLogs = withAuth(
  async (
    _user,
    { tenant },
    filters: EmailLogFilters = {}
  ): Promise<PaginatedResult<EmailSendingLogListRecord>> => {
    const { knex } = await createTenantKnex();

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 200);
    const sortDirection = filters.sortDirection === 'asc' ? 'asc' : 'desc';
    const offset = (page - 1) * pageSize;

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      let baseQuery = trx('email_sending_logs as esl')
        .leftJoin('tickets as t', function () {
          this.on('esl.entity_id', '=', 't.ticket_id')
            .andOn('t.tenant', '=', 'esl.tenant')
            .andOn('esl.entity_type', '=', trx.raw('?', ['ticket']));
        })
        .where('esl.tenant', tenant);

      if (filters.status) {
        baseQuery = baseQuery.where('esl.status', filters.status);
      }

      if (filters.startDate) {
        const parsedStartDate = parseDateFilter(filters.startDate);
        if (parsedStartDate) {
          baseQuery = baseQuery.where('esl.sent_at', '>=', parsedStartDate);
        }
      }

      if (filters.endDate) {
        const dateOnlyEndExclusive = parseDateOnlyEndExclusive(filters.endDate);
        if (dateOnlyEndExclusive) {
          baseQuery = baseQuery.where('esl.sent_at', '<', dateOnlyEndExclusive);
        } else {
          const parsedEndDate = parseDateFilter(filters.endDate);
          if (parsedEndDate) {
            baseQuery = baseQuery.where('esl.sent_at', '<=', parsedEndDate);
          }
        }
      }

      if (filters.recipientEmail) {
        const pattern = `%${filters.recipientEmail.trim()}%`;
        baseQuery = baseQuery.whereRaw('esl.to_addresses::text ILIKE ?', [pattern]);
      }

      if (filters.ticketNumber) {
        const pattern = `%${filters.ticketNumber.trim()}%`;
        baseQuery = baseQuery.whereRaw('t.ticket_number::text ILIKE ?', [pattern]);
      }

      const totalRow = await baseQuery
        .clone()
        .clearSelect()
        .clearOrder()
        .countDistinct<{ total: string }>({ total: 'esl.id' })
        .first();

      const total = parseInt(String(totalRow?.total ?? '0'), 10);
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      const data = await baseQuery
        .clone()
        .select<EmailSendingLogListRecord[]>(
          'esl.id',
          'esl.tenant',
          'esl.message_id',
          'esl.provider_id',
          'esl.provider_type',
          'esl.from_address',
          'esl.to_addresses',
          'esl.cc_addresses',
          'esl.bcc_addresses',
          'esl.subject',
          'esl.status',
          'esl.error_message',
          'esl.metadata',
          'esl.sent_at',
          'esl.delivered_at',
          'esl.opened_at',
          'esl.clicked_at',
          'esl.entity_type',
          'esl.entity_id',
          'esl.contact_id',
          'esl.notification_subtype_id',
          'esl.created_at',
          'esl.updated_at',
          trx.raw('t.ticket_number as ticket_number')
        )
        .orderBy('esl.sent_at', sortDirection)
        .limit(pageSize)
        .offset(offset);

      return {
        data,
        total,
        page,
        pageSize,
        totalPages
      };
    });
  }
);

export interface EmailLogMetrics {
  total: number;
  failed: number;
  today: number;
  failedRate: number;
}

export const getEmailLogMetrics = withAuth(
  async (_user, { tenant }): Promise<EmailLogMetrics> => {
    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const result = (await trx('email_sending_logs')
        .where({ tenant })
        .select(
          trx.raw('COUNT(*)::int as total'),
          trx.raw(`COUNT(*) FILTER (WHERE status = 'failed')::int as failed`),
          trx.raw('COUNT(*) FILTER (WHERE sent_at >= ?)::int as today', [startOfToday])
        )
        .first()) as unknown as { total: number; failed: number; today: number } | undefined;

      const total = Number(result?.total ?? 0);
      const failed = Number(result?.failed ?? 0);
      const today = Number(result?.today ?? 0);

      return {
        total,
        failed,
        today,
        failedRate: total > 0 ? failed / total : 0
      };
    });
  }
);
