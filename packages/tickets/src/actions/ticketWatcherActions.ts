'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildTicketUpdatedPayload } from '@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads';
import { revalidatePath } from 'next/cache';
import type { Knex } from 'knex';
import { actionError } from '@alga-psa/ui/lib/errorHandling';
import {
  TicketWatcherError,
  TicketWatcherService,
  type AddTicketWatcherInput,
  type TicketWatcher,
  type TicketWatcherWriteResult,
} from '@alga-psa/shared/services/tickets/ticketWatcherService';
import type { TicketActionError } from './ticketActionErrors';

/**
 * UI write path for ticket watchers. Every call goes through TicketWatcherService
 * (table write + mirror sync under the ticket row lock); the UI never rewrites
 * `tickets.attributes` to change watchers. A real change publishes the same
 * TICKET_UPDATED event the old whole-attributes save produced.
 */

export type TicketWatchersResult = { watchers: TicketWatcher[] };

async function runWatcherWrite(
  user: { user_id: string },
  tenant: string,
  ticketId: string,
  write: (trx: Knex.Transaction) => Promise<TicketWatcherWriteResult>
): Promise<TicketWatchersResult | TicketActionError> {
  try {
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!(await hasPermission(user as any, 'ticket', 'update', trx))) {
        throw new Error('Permission denied: Cannot update ticket watchers');
      }
      return write(trx);
    });

    if (result.changed) {
      await publishWorkflowEvent({
        eventType: 'TICKET_UPDATED',
        payload: buildTicketUpdatedPayload({
          ticketId,
          userId: user.user_id,
          updatedByUserId: user.user_id,
          changes: {},
        }),
        ctx: { tenantId: tenant, actor: { actorType: 'USER', actorUserId: user.user_id } },
        eventName: 'Ticket Updated',
      });
      revalidatePath('/msp/tickets');
    }
    return { watchers: result.watchers };
  } catch (error) {
    if (error instanceof TicketWatcherError) {
      return actionError(error.message);
    }
    throw error;
  }
}

/** Adds contacts, users and/or bare emails (team add sends its members' user ids). */
export const addTicketWatchers = withAuth(async (
  user,
  { tenant },
  ticketId: string,
  inputs: AddTicketWatcherInput[]
): Promise<TicketWatchersResult | TicketActionError> =>
  runWatcherWrite(user, tenant, ticketId, async (trx) => {
    let last: TicketWatcherWriteResult = { watchers: [], changed: false };
    let changed = false;
    for (const input of inputs) {
      last = await TicketWatcherService.add(trx, tenant, ticketId, { ...input, source: input.source ?? 'manual' }, user.user_id);
      changed = changed || last.changed;
    }
    return { watchers: last.watchers, changed };
  }));

export const setTicketWatcherActive = withAuth(async (
  user,
  { tenant },
  ticketId: string,
  email: string,
  active: boolean
): Promise<TicketWatchersResult | TicketActionError> =>
  runWatcherWrite(user, tenant, ticketId, (trx) =>
    TicketWatcherService.setActive(trx, tenant, ticketId, email, active, user.user_id)));

export const removeTicketWatcher = withAuth(async (
  user,
  { tenant },
  ticketId: string,
  email: string
): Promise<TicketWatchersResult | TicketActionError> =>
  runWatcherWrite(user, tenant, ticketId, (trx) =>
    TicketWatcherService.remove(trx, tenant, ticketId, email, user.user_id)));
