import { tenantDb } from '@alga-psa/db';
import { conversationUuid, TicketConversationError } from '@alga-psa/shared/lib/tickets/namedConversations';
import { encodeConversationContent } from './conversationContent';
import { ensureCoManagedActorReference } from './actorReferences';
import { mutateCoManagedPrivateTicketComment } from './privateTicketConversation';
import type { withNamedTicketConversation } from './namedTicketConversations';

type Context = Parameters<Parameters<typeof withNamedTicketConversation>[5]>[0];
/** Called only inside the generation completion transaction, after the run CAS
 * and complete source reauthorization. Prompt and reply share one normal root.
 * No draft, email, response-state, follower alert or business workflow is emitted
 * by AI completion. The invoking client refreshes the existing history reader. */
export async function publishNamedConversationAiExchange(context: Context, input: {
  promptId: string; replyId: string; prompt: string; reply: string;
}) {
  const { trx, actor, ticket, conversation } = context;
  if (!trx.isTransaction || ![input.promptId, input.replyId].every(conversationUuid) || input.promptId === input.replyId ||
      conversation.transport !== 'internal' || conversation.audience === 'requester') throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  const store = tenantDb(trx, conversation.storeTenant);
  const prompt = encodeConversationContent({ text: input.prompt }), reply = encodeConversationContent({ text: input.reply });
  if (conversation.storeTenant !== ticket.tenant) {
    await mutateCoManagedPrivateTicketComment(trx, actor,
      { kind: 'ticket', tenant: ticket.tenant, id: ticket.ticketId, relationshipId: ticket.relationshipId! },
      { kind: 'create', operationId: input.promptId, text: input.prompt }, { conversationId: conversation.conversationId });
    await store.table('co_management_private_comments').insert({ tenant: conversation.storeTenant, comment_id: input.replyId,
      thread_id: input.promptId, parent_comment_id: input.promptId, actor_kind: 'ai', actor_user_id: null,
      actor_display_name: 'AI', actor_organization_name: 'AI', ...reply, created_at: trx.raw('clock_timestamp()') });
    await store.table('co_management_private_threads').where('thread_id', input.promptId).update({ last_activity_at: trx.raw('clock_timestamp()') });
  } else {
    const referenceId = actor.tenant !== ticket.tenant ? await ensureCoManagedActorReference(context.sharedContext!) : null;
    const reference = referenceId ? await store.table('collaboration_actor_references').where('actor_reference_id', referenceId).first() : null;
    await store.table('comment_threads').insert({ tenant: ticket.tenant, thread_id: input.promptId, ticket_id: ticket.ticketId,
      conversation_id: conversation.conversationId, root_comment_id: input.promptId, is_internal: true,
      collaboration_audience: conversation.audience, reply_count: 1, created_by: referenceId ? null : actor.userId });
    const common = { tenant: ticket.tenant, ticket_id: ticket.ticketId, thread_id: input.promptId, is_internal: true,
      is_resolution: false, publish_state: 'published', published_at: trx.raw('clock_timestamp()') };
    await store.table('comments').insert({ ...common, comment_id: input.promptId, parent_comment_id: null, ...prompt,
      author_type: 'internal', user_id: referenceId ? null : actor.userId,
      ...(reference ? { actor_reference_id: referenceId, actor_display_name: reference.display_name, actor_organization_name: reference.organization_name } : {}),
      created_at: trx.raw('clock_timestamp()') });
    await store.table('comments').insert({ ...common, comment_id: input.replyId, parent_comment_id: input.promptId, ...reply,
      author_type: 'ai', user_id: null, contact_id: null, is_system_generated: true, created_at: trx.raw('clock_timestamp()') });
  }
  await store.table('ticket_conversations').where('conversation_id', conversation.conversationId)
    .increment('message_version', 2).update({ updated_at: trx.fn.now() });
  return { storeTenant: conversation.storeTenant, threadId: input.promptId, promptId: input.promptId, replyId: input.replyId };
}
