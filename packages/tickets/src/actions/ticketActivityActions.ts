'use server';

import { Knex } from 'knex';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import {
  buildUnifiedTicketTimeline,
  readTicketActivity,
  type TicketActivityRow,
  type TicketTimelineEntry,
} from '@alga-psa/shared/lib/ticketActivity';

/**
 * Return the chronological unified timeline (activity + comments) for an
 * internal MSP user. Internal-only by design — the client portal MUST NOT
 * call this in v1 (see PRD FR-03, F030). Permission enforcement uses the
 * existing `ticket:read` permission check.
 */
export const getTicketTimelineEntries = withAuth(
  async (
    user,
    { tenant },
    ticketId: string,
    opts?: { order?: 'asc' | 'desc' },
  ): Promise<TicketTimelineEntry[]> => {
    if (!tenant) {
      throw new Error('Tenant required');
    }
    if (!ticketId) {
      throw new Error('ticketId required');
    }

    // V1 internal-only: client portal users have a separate user_type and
    // are blocked here as a defense-in-depth check. The action is also not
    // exposed to the client portal route surface.
    if ((user as { user_type?: string }).user_type === 'client') {
      throw new Error('Permission denied: timeline is internal-only in v1');
    }

    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!(await hasPermission(user, 'ticket', 'read', trx))) {
        throw new Error('Permission denied: cannot read ticket');
      }

      // Confirm the ticket exists and is in tenant scope before reading
      // activity rows; this guards against orphan reads if a ticket was
      // deleted and only activity rows remain.
      const ticket = await trx('tickets')
        .where({ tenant, ticket_id: ticketId })
        .first(['ticket_id']);
      if (!ticket) {
        throw new Error('Ticket not found');
      }

      return buildUnifiedTicketTimeline(trx, tenant, ticketId, {
        order: opts?.order ?? 'desc',
        includeInternalNotes: true,
      });
    });
  },
);

/**
 * Activity-only read (no comments interleaved). Useful for tests and
 * specialized UIs that only need the structured operational events.
 */
export const getTicketActivityRows = withAuth(
  async (
    user,
    { tenant },
    ticketId: string,
  ): Promise<TicketActivityRow[]> => {
    if (!tenant) throw new Error('Tenant required');
    if (!ticketId) throw new Error('ticketId required');

    if ((user as { user_type?: string }).user_type === 'client') {
      throw new Error('Permission denied: timeline is internal-only in v1');
    }

    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!(await hasPermission(user, 'ticket', 'read', trx))) {
        throw new Error('Permission denied: cannot read ticket');
      }
      return readTicketActivity(trx, tenant, ticketId);
    });
  },
);
