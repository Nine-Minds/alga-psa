'use server'

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import { isMspPrincipalUserType } from '@alga-psa/types';
import { authorizeTicketRecordAccessConcealed } from '../../lib/ticketRecordAuthorization';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_SOURCE,
} from '@alga-psa/shared/lib/ticketActivity';
import {
  applyChecklistTemplateToTicket,
  type ApplyChecklistTemplateResult,
} from '@alga-psa/shared/lib/ticketChecklists';
import { checklistActionErrorFrom, TEMPLATE_CLIENT_MISMATCH, type ChecklistActionError } from './checklistActionErrors';

/** UI entry point: an authorized user applies a checklist template to a ticket by hand. */
export const applyChecklistTemplate = withAuth(
  async (user, { tenant }, ticketId: string, templateId: string): Promise<ApplyChecklistTemplateResult | ChecklistActionError> => {
    try {
      if (!isMspPrincipalUserType(user.user_type)
        || !(await hasPermission(user, 'ticket_settings', 'update'))
        || !(await hasPermission(user, 'ticket', 'update'))) {
        throw new Error('Permission denied: Cannot update ticket checklist');
      }

      const { knex: db } = await createTenantKnex();
      return await withTransaction(db, async (trx: Knex.Transaction) => {
        const ticket = await authorizeTicketRecordAccessConcealed({
          trx,
          tenant,
          user,
          ticketId,
          action: 'update',
        });

        const result = await applyChecklistTemplateToTicket(trx, tenant, ticketId, templateId, 'template', {
          actor: {
            actorType: TICKET_ACTIVITY_ACTOR.USER,
            userId: user.user_id,
            displayName:
              [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || '',
          },
          source: TICKET_ACTIVITY_SOURCE.UI,
        }, ticket.client_id);
        // Manual apply of a template scoped to another client is an error, not a silent no-op.
        if (result.reason === 'template-client-mismatch') {
          throw new Error(TEMPLATE_CLIENT_MISMATCH);
        }
        return result;
      });
    } catch (error) {
      const expected = checklistActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  }
);
