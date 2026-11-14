'use server'

/**
 * MSP-side actions for the inbound email quarantine queue
 * (inbound_email_quarantine, written by shared/services/email/inboundQuarantine.ts).
 *
 * Authorization follows the inbound-email settings actions: client-portal users
 * are rejected, and the caller must hold `ticket_settings:update`
 * (requireOutboundEmailAdmin) to list or dismiss. The ticket banner count is
 * wider (internal user + `ticket:read`) and reports whether the queue is openable. Every query is
 * tenant-scoped through tenantDb. Rows never contain message bodies or headers.
 */

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  QUARANTINE_REASONS,
  QUARANTINE_STATUSES,
  type QuarantineReason,
  type QuarantineStatus,
} from '@alga-psa/shared/services/email/inboundQuarantineConstants';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import { hasPermission } from '@alga-psa/auth/rbac';
import { isClientUser, requireOutboundEmailAdmin } from './mspOutboundEmailAccess';

export interface InboundQuarantineRow {
  id: string;
  providerId: string;
  mailbox: string;
  sender: string;
  subject: string;
  reason: QuarantineReason;
  ticketId: string | null;
  ticketNumber: string | null;
  receivedAt: string;
  quarantinedAt: string;
  status: QuarantineStatus;
  dismissedAt: string | null;
}

export interface InboundQuarantineFilters {
  providerId?: string;
  reason?: QuarantineReason;
  status?: QuarantineStatus;
  ticketId?: string;
  page?: number;
  pageSize?: number;
}

export interface InboundQuarantineListResult {
  rows: InboundQuarantineRow[];
  total: number;
  mailboxes: Array<{ providerId: string; mailbox: string }>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGE_SIZE = 100;
const DENIED_KEY = 'errors.permissionDenied';

const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value));

export const listInboundQuarantine = withAuth(async (
  user,
  { tenant },
  filters: InboundQuarantineFilters = {}
): Promise<InboundQuarantineListResult | ReturnType<typeof permissionError> | ReturnType<typeof actionError>> => {
  const { knex } = await createTenantKnex();
  const access = await requireOutboundEmailAdmin(user, knex);
  if (!access.allowed) return permissionError(access.message, DENIED_KEY);

  if (filters.providerId && !UUID_PATTERN.test(filters.providerId)) return actionError('Invalid mailbox filter');
  if (filters.ticketId && !UUID_PATTERN.test(filters.ticketId)) return actionError('Invalid ticket filter');
  if (filters.reason && !QUARANTINE_REASONS.includes(filters.reason)) return actionError('Invalid reason filter');
  if (filters.status && !QUARANTINE_STATUSES.includes(filters.status)) return actionError('Invalid status filter');

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(filters.pageSize ?? 25)));
  const db = tenantDb(knex, tenant);

  const base = () => {
    const query = db.table('inbound_email_quarantine');
    if (filters.providerId) query.where({ provider_id: filters.providerId });
    if (filters.reason) query.where({ reason: filters.reason });
    if (filters.status) query.where({ status: filters.status });
    if (filters.ticketId) query.where({ ticket_id: filters.ticketId });
    return query;
  };

  const countRow = await base().count<{ count: string }[]>('id as count').first();
  const rows = await base()
    .orderBy('quarantined_at', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .select(
      'id', 'provider_id', 'mailbox', 'sender', 'subject', 'reason', 'ticket_id', 'ticket_number',
      'received_at', 'quarantined_at', 'status', 'dismissed_at'
    );
  const mailboxes = await db.table('inbound_email_quarantine')
    .distinct('provider_id', 'mailbox')
    .orderBy('mailbox', 'asc');

  return {
    total: Number(countRow?.count ?? 0),
    rows: (rows as any[]).map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      mailbox: row.mailbox,
      sender: row.sender,
      subject: row.subject,
      reason: row.reason,
      ticketId: row.ticket_id ?? null,
      ticketNumber: row.ticket_number ?? null,
      receivedAt: iso(row.received_at),
      quarantinedAt: iso(row.quarantined_at),
      status: row.status,
      dismissedAt: row.dismissed_at ? iso(row.dismissed_at) : null,
    })),
    mailboxes: (mailboxes as any[]).map((m) => ({ providerId: m.provider_id, mailbox: m.mailbox })),
  };
});

export const dismissInboundQuarantine = withAuth(async (
  user,
  { tenant },
  quarantineId: string
): Promise<{ success: true } | ReturnType<typeof permissionError> | ReturnType<typeof actionError>> => {
  const { knex } = await createTenantKnex();
  const access = await requireOutboundEmailAdmin(user, knex);
  if (!access.allowed) return permissionError(access.message, DENIED_KEY);
  if (!UUID_PATTERN.test(quarantineId ?? '')) return actionError('Invalid quarantine entry');

  const updated = await tenantDb(knex, tenant).table('inbound_email_quarantine')
    .where({ id: quarantineId, status: 'open' })
    .update({ status: 'dismissed', dismissed_by: user.user_id, dismissed_at: knex.fn.now() })
    .returning('id');
  if (!Array.isArray(updated) || updated.length === 0) {
    return actionError('This entry was already dismissed or no longer exists');
  }
  return { success: true };
});

/**
 * Count of OPEN quarantined emails matched to a ticket (staff-only ticket banner).
 *
 * Gated on MSP-internal user + `ticket:read` so the technicians working the
 * ticket see it; client-portal users are refused. `canOpenQueue` tells the
 * banner whether this viewer may open the (admin-only) queue page.
 */
export const getOpenQuarantineCountForTicket = withAuth(async (
  user,
  { tenant },
  ticketId: string
): Promise<{ count: number; canOpenQueue: boolean } | ReturnType<typeof permissionError> | ReturnType<typeof actionError>> => {
  const { knex } = await createTenantKnex();
  if (isClientUser(user) || (user as any)?.user_type !== 'internal') {
    return permissionError('Permission denied', DENIED_KEY);
  }
  if (!await hasPermission(user, 'ticket', 'read', knex)) {
    return permissionError('Permission denied: Cannot view tickets', DENIED_KEY);
  }
  if (!UUID_PATTERN.test(ticketId ?? '')) return actionError('Invalid ticket');

  const row = await tenantDb(knex, tenant).table('inbound_email_quarantine')
    .where({ ticket_id: ticketId, status: 'open' })
    .count<{ count: string }[]>('id as count')
    .first();
  const admin = await requireOutboundEmailAdmin(user, knex);
  return { count: Number(row?.count ?? 0), canOpenQueue: admin.allowed };
});
