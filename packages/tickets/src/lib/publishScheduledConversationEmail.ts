import { scheduledConversationContentHash } from '@alga-psa/shared/lib/tickets/scheduledConversationContent';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { recordNamedConversationAttention, withNativeAcceptedConversationEmail, deliverNativeNamedConversationEmail } from '@alga-psa/co-managed';
import { authorizeNamedConversationMailbox, assertNamedConversationDeliveryFiles, assertScheduledConversationShareSource, assertScheduledConversationSynthesisSource } from '@alga-psa/co-managed';
import { assertCoManagedScheduledCommentPublication } from '@alga-psa/co-managed/scheduledCommentPublication';
import { snapshotRequesterPublicationOptions } from '@alga-psa/shared/lib/tickets/requesterPublicationOptions';
import { TicketConversationError } from '@alga-psa/shared/lib/tickets/namedConversations';
import { isCoManagedReadFieldHidden } from '@alga-psa/co-managed';
import { namedConversationEmailTransport } from './namedConversationEmail';
import { publishTicketConversationCommentEffects } from './applyTicketConversationComment';

/** A retained named schedule owns publication and its exact external envelope.
 * Returning true prevents the generic scheduler from emitting contact email. */
export async function publishScheduledConversationEmail(db: Knex, input: { tenantId: string; ticketId: string; commentId: string }): Promise<boolean> {
  const owner = tenantDb(db, input.tenantId);
  const named = await owner.table('ticket_conversation_publications').where({ comment_id: input.commentId,
    ticket_tenant: input.tenantId, ticket_id: input.ticketId, mode: 'send' }).first('operation_id', 'publication_options');
  if (!named?.publication_options?.schedule) return false;
  const retained = { tenant: input.tenantId, operationId: named.operation_id };
  const ready = await withNativeAcceptedConversationEmail(db, retained, 'publication', async (context, operation, publication) => {
    if (context.ticket.ticketId !== input.ticketId || publication.comment_id !== input.commentId) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
    if (operation.status !== 'scheduled') return operation.status === 'pending';
    const store = tenantDb(context.trx, input.tenantId);
    const options = snapshotRequesterPublicationOptions(operation.publication_options);
    if (!options?.schedule || options.close || context.conversation.audience !== 'requester') throw new TicketConversationError('CONVERSATION_INVALID');
    const due = await store.table('comments').where({ comment_id: input.commentId, ticket_id: input.ticketId, publish_state: 'scheduled' })
      .where('scheduled_publish_at', '<=', context.trx.raw('clock_timestamp()')).whereNull('deleted_at').first();
    if (!due) return false;
    const authority = await assertCoManagedScheduledCommentPublication(context.trx, { tenant: input.tenantId, ticketId: input.ticketId, commentId: input.commentId });
    if (!authority || operation.scheduled_comment_hash !== scheduledConversationContentHash(due) || due.user_id !== context.actor.userId || due.thread_id !== publication.thread_id ||
      isCoManagedReadFieldHidden(context.hidden, ['email', 'email_envelope', 'recipients', 'from', 'to', 'cc', 'subject', 'scheduled_publish_at', 'scheduled_publish_tz',
        ...(options.isResolution ? ['is_resolution', 'comments.is_resolution'] : [])])) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
    const mailbox = await authorizeNamedConversationMailbox(context, operation.conversation_revision);
    if (mailbox.id !== operation.mailbox_id || mailbox.tenant !== operation.mailbox_tenant) throw new TicketConversationError('CONVERSATION_CONFLICT');
    const current = await namedConversationEmailTransport.recheck(operation.payload, mailbox);
    if (current.messageHash !== operation.review.messageHash || current.senderRevision !== operation.review.senderRevision) throw new TicketConversationError('CONVERSATION_CONFLICT');
    await assertScheduledConversationShareSource({ ...context, shared: false }, publication);
    await assertScheduledConversationSynthesisSource({ ...context, shared: false }, publication);
    await store.table('comments').where({ comment_id: input.commentId, publish_state: 'scheduled' }).update({ publish_state: 'published',
      published_at: context.trx.fn.now(), updated_at: context.trx.fn.now(), schedule_job_id: null, scheduled_publish_retry_at: null });
    await assertNamedConversationDeliveryFiles(context, operation.operation_id, operation.payload.files);
    if (due.parent_comment_id) await store.table('comment_threads').where('thread_id', due.thread_id)
      .increment('reply_count', 1).update({ last_activity_at: context.trx.fn.now() });
    await recordNamedConversationAttention(context, { commentId: due.comment_id, threadId: due.thread_id });
    await store.table('ticket_conversations').where('conversation_id', context.conversation.conversationId)
      .increment('message_version', 1).update({ updated_at: context.trx.fn.now() });
    await publishTicketConversationCommentEffects({ trx: context.trx, actor: context.actor, resource: { tenant: input.tenantId, id: input.ticketId },
      audience: 'requester', conversationId: context.conversation.conversationId, canUpdateResponseState: authority.canUpdateResponseState,
      publication: 'native', externalDelivery: 'reviewed_email',
      assertWriteAuthority: trx => assertCoManagedOperationalWrite(trx, input.tenantId) }, due);
    await store.table('ticket_conversation_email_operations').where('operation_id', operation.operation_id)
      .update({ status: 'pending', recovery_after: context.trx.fn.now() });
    return true;
  });
  if (ready) await deliverNativeNamedConversationEmail(db, retained, namedConversationEmailTransport);
  return true;
}
