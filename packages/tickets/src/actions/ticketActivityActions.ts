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
import { authorizeTicketRecordAccessConcealed } from '../lib/ticketRecordAuthorization';
import { ticketActionErrorFrom, type TicketActionError } from './ticketActionErrors';

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
    opts?: { order?: 'asc' | 'desc'; includeTimeEntries?: boolean; includeAlerts?: boolean },
  ): Promise<TicketTimelineEntry[] | TicketActionError> => {
    try {
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

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!(await hasPermission(user, 'ticket', 'read', trx))) {
        throw new Error('Permission denied: cannot read ticket');
      }

      // Record-level policy (bundle/relationship narrowing). Hidden and missing
      // tickets both surface as `Ticket not found`.
      const ticket = await authorizeTicketRecordAccessConcealed({
        trx, tenant, user, ticketId, action: 'read', conceal: 'all',
      });

      return buildUnifiedTicketTimeline(trx, tenant, ticket.ticket_id, {
        order: opts?.order ?? 'desc',
        includeInternalNotes: true,
        includeTimeEntries: opts?.includeTimeEntries ?? false,
        includeAlerts: opts?.includeAlerts ?? false,
      });
    });
    } catch (error) {
      const expected = ticketActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
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
  ): Promise<TicketActivityRow[] | TicketActionError> => {
    try {
    if (!tenant) throw new Error('Tenant required');
    if (!ticketId) throw new Error('ticketId required');

    if ((user as { user_type?: string }).user_type === 'client') {
      throw new Error('Permission denied: timeline is internal-only in v1');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!(await hasPermission(user, 'ticket', 'read', trx))) {
        throw new Error('Permission denied: cannot read ticket');
      }
      const ticket = await authorizeTicketRecordAccessConcealed({
        trx, tenant, user, ticketId, action: 'read', conceal: 'all',
      });
      return readTicketActivity(trx, tenant, ticket.ticket_id);
    });
    } catch (error) {
      const expected = ticketActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  },
);
