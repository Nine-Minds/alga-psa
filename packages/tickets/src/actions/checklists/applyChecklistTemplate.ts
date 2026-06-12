'use server'

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_SOURCE,
} from '@alga-psa/shared/lib/ticketActivity';
import {
  applyChecklistTemplateToTicket,
  type ApplyChecklistTemplateResult,
} from '@alga-psa/shared/lib/ticketChecklists';

/** UI entry point: a tech applies a checklist template to a ticket by hand. */
export const applyChecklistTemplate = withAuth(
  async (user, { tenant }, ticketId: string, templateId: string): Promise<ApplyChecklistTemplateResult> => {
    if (!(await hasPermission(user, 'ticket', 'update'))) {
      throw new Error('Permission denied: Cannot update ticket checklist');
    }

    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const ticket = await trx('tickets').where({ tenant, ticket_id: ticketId }).first();
      if (!ticket) throw new Error('Ticket not found');

      return applyChecklistTemplateToTicket(trx, tenant, ticketId, templateId, 'template', {
        actor: {
          actorType: TICKET_ACTIVITY_ACTOR.USER,
          userId: user.user_id,
          displayName:
            [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || '',
        },
        source: TICKET_ACTIVITY_SOURCE.UI,
      });
    });
  }
);
