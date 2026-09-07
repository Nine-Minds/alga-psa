import { createHash, randomUUID } from 'node:crypto';
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
  input = { ...input };
  if (/^cm1:/i.test(input.token)) return admitCoManagedRequesterReply(trx, input, write);
  try {
    const result = await withCoManagedCustomerEmailReply(trx, input, async context => {
      const owner = tenantDb(context.trx, context.actor.tenant);
      const source = await owner.table('tickets').where('ticket_id', context.resource.id).first('client_id', 'contact_name_id');
      if (!source?.client_id) throw new CoManagedSharedWorkError();
      const content = await withCoManagedCustomerCommentNotification(context.trx, { kind: 'notification_recipient', ...context.actor },
        context.resource, context.parentCommentId, async (_, message) => message);
      if (!content) throw new CoManagedSharedWorkError();
      const written = await write({ kind: 'customer_technician', ticketId: context.resource.id, parentCommentId: context.parentCommentId,
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
      if (written.outcome === 'created' || written.outcome === 'replied') {
        if (!isCoManagedUuid(input.inboxId) || !isCoManagedUuid(written.ticketId) || !isCoManagedUuid(written.commentId) ||
            !input.sourceSha256 || !/^[a-f0-9]{64}$/.test(input.sourceSha256)) throw new Error('Accepted technician reply lacks durable source identity');
        const inbox = await owner.table('inbound_email_inbox').where({ inbox_id: input.inboxId, status: 'processing' }).forUpdate().first();
        const comment = await owner.table('comments').where({ comment_id: written.commentId, ticket_id: written.ticketId }).forShare().first();
        const thread = comment && await owner.table('comment_threads').where({ thread_id: comment.thread_id, ticket_id: written.ticketId }).forShare().first();
        if (!inbox || inbox.source_sha256 !== input.sourceSha256 || !inbox.source_object_key || !comment || !thread ||
            comment.user_id !== context.actor.userId || comment.contact_id || comment.actor_reference_id || comment.author_type !== 'internal' ||
            comment.deleted_at || comment.publish_state !== 'published' || thread.collaboration_audience !== context.audience ||
            comment.is_internal !== (context.audience !== 'requester') || thread.is_internal !== comment.is_internal) {
          throw new Error('Accepted technician reply does not match its durable source and canonical author');
        }
        // Relationship identity is historical provenance, not continuing MSP
        // authority: the customer retains accepted replies after departure.
        const relationship = await owner.table('co_management_relationships').orderBy('created_at', 'desc').orderBy('relationship_id').forShare().first('relationship_id');
        if (!relationship) throw new Error('Accepted technician reply has no retained relationship provenance');
        const receipt = { tenant: context.actor.tenant, inbox_id: input.inboxId,
          ticket_id: written.ticketId, comment_id: written.commentId, thread_id: comment.thread_id,
          source_ticket_id: context.resource.id, source_thread_id: context.threadId, source_comment_id: context.parentCommentId,
          actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId, relationship_id: relationship.relationship_id,
          audience: context.audience, source_sha256: input.sourceSha256,
          reply_token_hash: createHash('sha256').update(input.token).digest('hex') };
        await owner.table('co_management_inbound_reply_receipts').insert(receipt).onConflict(['tenant', 'inbox_id']).ignore();
        const retained = await owner.table('co_management_inbound_reply_receipts').where('inbox_id', input.inboxId).forShare().first();
        if (!retained || Object.entries(receipt).some(([key, value]) => retained[key] !== value)) throw new Error('Inbound technician reply receipt identity conflict');
      }
      return written;
    });
    return { admitted: true, result };
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return { admitted: false };
    throw error;
  }
};
