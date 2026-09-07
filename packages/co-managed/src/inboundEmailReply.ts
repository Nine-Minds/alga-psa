import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import type { EmailReplyAdmission } from '../../../shared/services/email/qualifiedReplyAdmission';
import { admitCoManagedRequesterReply } from './inboundRequesterReply';
import { withCoManagedCustomerEmailReply } from './customerReplyTokens';
import { withCoManagedCustomerCommentNotification } from './customerCommentNotification';
import { authorizeCoManagedWorkRecord, CoManagedSharedWorkError, isCoManagedUuid, lockCoManagedRecipientIdentity } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

/** Both durable worker roots use this adapter. Token rejection is terminal;
 * database, lifecycle and writer failures retain their existing retry policy. */
export const admitCoManagedEmailReply: EmailReplyAdmission = async (trx, input, write) => {
  if (!trx?.isTransaction) throw new Error('Qualified reply admission requires the owning inbox transaction');
  if (/^cm1:/i.test(input.token)) return admitCoManagedRequesterReply(trx, input, write);
  try {
    const result = await withCoManagedCustomerEmailReply(trx, input, async context => {
      const owner = tenantDb(context.trx, context.actor.tenant);
      const source = await owner.table('tickets').where('ticket_id', context.resource.id).first('client_id', 'contact_name_id');
      if (!source?.client_id) throw new CoManagedSharedWorkError();
      const content = await withCoManagedCustomerCommentNotification(context.trx, { kind: 'notification_recipient', ...context.actor },
        context.resource, context.parentCommentId, async (_, message) => message);
      if (!content) throw new CoManagedSharedWorkError();
      return write({ kind: 'customer_technician', ticketId: context.resource.id, parentCommentId: context.parentCommentId,
        userId: context.actor.userId, senderEmail: context.senderEmail, clientId: source.client_id, contactId: source.contact_name_id ?? undefined,
        audience: context.audience, followupTitle: content.ticketTitle,
        assertDestination: async destination => {
          if (destination.clientId !== source.client_id || !isCoManagedUuid(destination.boardId) ||
              !await owner.table('boards').where('board_id', destination.boardId).forShare().first('board_id') ||
              !await owner.table('clients').where({ client_id: destination.clientId, is_inactive: false }).forShare().first('client_id')) throw new CoManagedSharedWorkError();
          if (context.audience !== 'requester' && !content.ticketTitle) throw new CoManagedSharedWorkError();
          const subject = await lockCoManagedRecipientIdentity(context.trx, context.actor);
          // Same shape as the actual follow-up: fixed client/board, technician
          // creator, no assignment. A token cannot evade create or bundle scope.
          for (const action of ['create', 'read', 'update'] as const) {
            const decision = await authorizeCoManagedWorkRecord(context.trx, context.actor, subject, 'ticket', action, {
              id: randomUUID(), clientId: destination.clientId, boardId: destination.boardId, ownerUserId: context.actor.userId, assignedUserIds: [], teamIds: [],
            });
            if (isCoManagedReadFieldHidden(decision.redactedFields, ['title', 'description', 'conversation', 'comments', 'note', 'markdown_content', 'collaboration_audience'])) throw new CoManagedSharedWorkError();
          }
        },
      });
    });
    return { admitted: true, result };
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return { admitted: false };
    throw error;
  }
};
