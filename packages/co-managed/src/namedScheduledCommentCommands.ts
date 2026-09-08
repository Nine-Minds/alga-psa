import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withNamedTicketConversation } from './namedTicketConversations';
import { assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { TicketConversationError } from '@alga-psa/shared/lib/tickets/namedConversations';

/** Legacy reschedule/cancel controls retain the named destination's current
 * authority. They can move timing, but cannot borrow another author's session
 * or revise the accepted external envelope. */
export async function admitNamedScheduledCommentCommand(trx: Knex.Transaction, actor: CoManagedSessionActor,
  input: { commentId: string; ticketId: string; operation: 'create' | 'reschedule' | 'cancel' }) {
  const store = tenantDb(trx, actor.tenant);
  const publication = await store.table('ticket_conversation_publications').where({ comment_id: input.commentId,
    ticket_tenant: actor.tenant, ticket_id: input.ticketId, mode: 'send' }).first();
  if (!publication?.publication_options?.schedule) return null;
  if (input.operation === 'create') throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  return withNamedTicketConversation(trx, actor, { tenant: actor.tenant, ticketId: input.ticketId },
    { storeTenant: actor.tenant, conversationId: publication.conversation_id }, 'update', async context => {
      if (context.shared || context.conversation.audience !== 'requester' || isCoManagedReadFieldHidden(context.hidden,
        ['publish_state', 'scheduled_publish_at', 'scheduled_publish_tz', 'comments.publish_state', 'comments.scheduled_publish_at', 'comments.scheduled_publish_tz']))
        throw new TicketConversationError('CONVERSATION_FORBIDDEN');
      const accepted = await store.table('ticket_conversation_email_operations').where({ operation_id: publication.operation_id,
        actor_user_id: publication.actor_user_id, ticket_id: input.ticketId, ticket_tenant: actor.tenant,
        conversation_id: publication.conversation_id, status: 'scheduled' }).forUpdate().first('operation_id');
      const comment = await store.table('comments').where({ comment_id: input.commentId, ticket_id: input.ticketId,
        thread_id: publication.thread_id, publish_state: 'scheduled' }).whereNull('deleted_at').forUpdate().first('comment_id');
      if (!accepted || !comment) throw new TicketConversationError('CONVERSATION_CONFLICT');
      return async () => {
        await assertCoManagedSessionUnexpired(trx, actor);
        await assertCoManagedOperationalWrite(trx, actor.tenant);
      };
    });
}

/** Called after the canonical cancellation in the same admitted transaction. */
export async function retainNamedScheduledCommentCancellation(trx: Knex.Transaction, tenant: string, commentId: string) {
  const store = tenantDb(trx, tenant);
  const publication = await store.table('ticket_conversation_publications').where({ comment_id: commentId, ticket_tenant: tenant, mode: 'send' })
    .whereRaw("jsonb_exists(publication_options, 'schedule')").first('operation_id');
  if (!publication) return;
  const comment = await store.table('comments').where({ comment_id: commentId, publish_state: 'canceled' }).first();
  if (!comment?.deleted_at) throw new TicketConversationError('CONVERSATION_CONFLICT');
  await store.table('ticket_conversation_email_operations').where({ operation_id: publication.operation_id, status: 'scheduled' })
    .update({ status: 'canceled', completed_at: trx.fn.now() });
}
