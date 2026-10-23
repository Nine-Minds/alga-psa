'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildTicketTeamAssignedPayload } from '@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads';
import { revalidatePath } from 'next/cache';
import { Knex } from 'knex';
import {
  assignTeamToTicketCore,
  removeTeamFromTicketCore,
  type RemoveTeamFromTicketOptions,
} from '@alga-psa/shared/services/tickets/teamAssignmentCore';
import { ticketActionErrorFrom, type TicketActionError } from './ticketActionErrors';

export type TeamAssignmentNotificationOptions = {
  suppressContactNotifications?: boolean;
  suppressInternalNotifications?: boolean;
};

export const assignTeamToTicket = withAuth(async (
  user,
  { tenant },
  ticketId: string,
  teamId: string,
  options: TeamAssignmentNotificationOptions = {}
): Promise<void | TicketActionError> => {
  const suppressContactNotifications = options.suppressContactNotifications === true;
  const suppressInternalNotifications = options.suppressInternalNotifications === true;
  if (suppressInternalNotifications && !suppressContactNotifications) {
    throw new Error('suppressInternalNotifications requires suppressContactNotifications');
  }

  try {
    const { knex: db } = await createTenantKnex();
    const assignedTo = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'update', trx)) {
        throw new Error('Permission denied: Cannot assign team to ticket');
      }

      return await assignTeamToTicketCore(trx, tenant, user.user_id, ticketId, teamId);
    });

    // Emit event after transaction commits so subscribers can see the data
    await publishWorkflowEvent({
      eventType: 'TICKET_ASSIGNED',
      payload: buildTicketTeamAssignedPayload({
        ticketId,
        assignedToUserId: assignedTo,
        assignedByUserId: user.user_id,
        teamId,
        suppressContactNotifications,
        suppressInternalNotifications,
      }),
      ctx: { tenantId: tenant, actor: { actorType: 'USER', actorUserId: user.user_id } },
    });

    // Invalidate ticket list cache so team badge appears on navigation back
    revalidatePath('/msp/tickets');
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const removeTeamFromTicket = withAuth(async (
  user,
  { tenant },
  ticketId: string,
  options: RemoveTeamFromTicketOptions
): Promise<void | TicketActionError> => {
  try {
    const { knex: db } = await createTenantKnex();
    await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'update', trx)) {
        throw new Error('Permission denied: Cannot remove team from ticket');
      }

      await removeTeamFromTicketCore(trx, tenant, user.user_id, ticketId, options);
    });

    // Invalidate ticket list cache so team badge removal is reflected
    revalidatePath('/msp/tickets');
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});
