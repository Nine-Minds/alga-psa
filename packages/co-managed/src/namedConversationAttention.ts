import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { coManagedConversationBodySources } from './conversationPolicy';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { conversationUuid, TicketConversationError, type NamedTicketConversation, type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { namedConversationMessageContext } from './namedConversationAttachments';
import { withNamedTicketConversation } from './namedTicketConversations';
import type { CoManagedSessionActor } from './sharedWorkIdentity';

const EVENTS = 'ticket_conversation_message_events', PREFS = 'ticket_conversation_preferences';
export const namedConversationAttentionSources = [...coManagedConversationBodySources, EVENTS, PREFS,
  'attention', 'attention_version', 'last_read_version', 'unread_count', 'following'];
type Context = { trx: Knex.Transaction; ticket: ConversationTicketReference; conversation: NamedTicketConversation; hidden: readonly string[] };
type ViewerContext = Context & { actor: { tenant: string; userId: string } };
const invalid = (): never => { throw new TicketConversationError('CONVERSATION_INVALID'); };

/** Publication engine: callers retain their source-writing admission. The
 * canonical author and source/root proof are re-read; body/envelope/file edits
 * do not create another unread message or notification intent. */
export async function recordNamedConversationAttention(context: Context, input: { commentId: string; threadId: string }): Promise<string | null> {
  if (!input || ![input.commentId, input.threadId].every(conversationUuid) || Object.keys(input).some(key => !['commentId', 'threadId'].includes(key))) return invalid();
  const message = { commentId: input.commentId.toLowerCase(), threadId: input.threadId.toLowerCase() };
  const { trx, conversation, ticket } = context, store = tenantDb(trx, conversation.storeTenant);
  const current = await store.table('ticket_conversations').where({ conversation_id: conversation.conversationId, ticket_tenant: ticket.tenant, ticket_id: ticket.ticketId }).forUpdate().first('attention_version');
  if (!current) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  await namedConversationMessageContext(context, message.commentId, message.threadId);
  const privateStore = conversation.storeTenant !== ticket.tenant;
  const comment = await store.table(privateStore ? 'co_management_private_comments' : 'comments').where({ comment_id: message.commentId, thread_id: message.threadId }).first();
  const decision = comment.metadata?.inboundReopenDecision;
  if (comment.is_system_generated || comment.actor_kind === 'ai' || decision?.automated?.isAutomated || decision?.aiSuppression?.decision === 'ACK') return null;
  let author: { tenant: string; userId: string } | null = null;
  if (privateStore && comment.actor_kind !== 'external' && comment.actor_user_id) author = { tenant: conversation.storeTenant, userId: comment.actor_user_id };
  else if (!privateStore && comment.actor_reference_id) {
    const actor = await store.table('collaboration_actor_references').where('actor_reference_id', comment.actor_reference_id).first('actor_tenant', 'actor_user_id');
    if (!actor) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
    author = { tenant: actor.actor_tenant, userId: actor.actor_user_id };
  } else if (!privateStore && comment.author_type === 'internal' && comment.user_id) author = { tenant: conversation.storeTenant, userId: comment.user_id };
  const existing = await store.table(EVENTS).where({ conversation_id: conversation.conversationId, comment_id: message.commentId }).first();
  if (existing) {
    if (existing.ticket_tenant !== ticket.tenant || existing.ticket_id !== ticket.ticketId || existing.thread_id !== message.threadId) throw new TicketConversationError('CONVERSATION_CONFLICT');
    return String(existing.sequence);
  }
  const sequence = (BigInt(current.attention_version) + 1n).toString();
  await store.table(EVENTS).insert({ tenant: conversation.storeTenant, conversation_id: conversation.conversationId,
    ticket_tenant: ticket.tenant, ticket_id: ticket.ticketId, comment_id: message.commentId, thread_id: message.threadId, sequence,
    kind: author ? 'human' : 'external', author_tenant: author?.tenant ?? null, author_user_id: author?.userId ?? null });
  await store.table('ticket_conversations').where('conversation_id', conversation.conversationId).update({ attention_version: sequence });
  return sequence;
}

export function getNamedConversationAttention(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, reference: TicketConversationReference) {
  return withNamedTicketConversation(db, actor, ticket, reference, 'read', readNamedConversationAttention);
}

/** Reuse the current ticket admission for the navigator; a body mask also
 * withholds activity sequence metadata, not just the unread total. */
export async function readNamedConversationAttention(context: Context & { actor: { tenant: string; userId: string } }) {
  if (isCoManagedReadFieldHidden(context.hidden, namedConversationAttentionSources)) return null;
  const store = tenantDb(context.trx, context.conversation.storeTenant);
  const preference = await store.table(PREFS).where({ conversation_id: context.conversation.conversationId, actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId }).first();
  const current = await store.table('ticket_conversations').where('conversation_id', context.conversation.conversationId).forShare().first('attention_version');
  const unseen = await store.table(EVENTS).where({ conversation_id: context.conversation.conversationId, ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId })
    .where('sequence', '>', preference?.last_read_version ?? '0')
    .where(q => q.whereNull('author_user_id').orWhereNot('author_tenant', context.actor.tenant).orWhereNot('author_user_id', context.actor.userId))
    .orderBy('sequence').select('comment_id', 'thread_id');
  let unreadCount = 0;
  for (const row of unseen) {
    try { await namedConversationMessageContext(context, row.comment_id, row.thread_id); unreadCount++; }
    catch (error) { if (!(error instanceof TicketConversationError && error.code === 'CONVERSATION_FORBIDDEN')) throw error; }
  }
  return { following: Boolean(preference?.following), lastReadVersion: String(preference?.last_read_version ?? '0'), attentionVersion: String(current.attention_version), unreadCount };
}

/** Read access is enough to manage one's own notification preference. The
 * caller cannot name another reader; following never grants resource access. */
export function updateNamedConversationPreference(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, reference: TicketConversationReference,
  input: { following?: boolean; readThrough?: string }) {
  if (!input || (input.following === undefined && input.readThrough === undefined) || Object.keys(input).length === 0 || Object.keys(input).some(key => !['following', 'readThrough'].includes(key)) ||
    (input.following !== undefined && typeof input.following !== 'boolean') ||
    (input.readThrough !== undefined && (typeof input.readThrough !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(input.readThrough) || BigInt(input.readThrough) > 9223372036854775807n))) return invalid();
  const request = { ...input };
  return withNamedTicketConversation(db, actor, ticket, reference, 'read', async context => {
    await persistPreference(context, request);
  });
}

/** Automatic read acknowledgment names the messages actually displayed. The
 * server derives their cursor under current source admission; a later reply
 * cannot be acknowledged by fetching a newer navigator count after rendering. */
export function acknowledgeNamedConversationMessages(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  reference: TicketConversationReference, input: { commentId: string; threadId: string }[]) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100 || input.some(item => !item ||
    ![item.commentId, item.threadId].every(conversationUuid) || Object.keys(item).some(key => !['commentId', 'threadId'].includes(key)))) return invalid();
  const messages = input.map(item => ({ commentId: item.commentId.toLowerCase(), threadId: item.threadId.toLowerCase() }));
  return withNamedTicketConversation(db, actor, ticket, reference, 'read', async context => {
    if (isCoManagedReadFieldHidden(context.hidden, namedConversationAttentionSources)) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
    for (const message of messages) await namedConversationMessageContext(context, message.commentId, message.threadId);
    const last = await tenantDb(context.trx, context.conversation.storeTenant).table(EVENTS)
      .where({ conversation_id: context.conversation.conversationId, ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId })
      .where(query => { for (const message of messages) query.orWhere({ comment_id: message.commentId, thread_id: message.threadId }); })
      .orderBy('sequence', 'desc').first('sequence');
    if (!last) return { changed: false };
    return persistPreference(context, { readThrough: String(last.sequence) });
  });
}

async function persistPreference(context: ViewerContext, request: { following?: boolean; readThrough?: string }) {
  if (isCoManagedReadFieldHidden(context.hidden, namedConversationAttentionSources)) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  await assertCoManagedOperationalWrite(context.trx, context.conversation.storeTenant);
  const store = tenantDb(context.trx, context.conversation.storeTenant), key = { conversation_id: context.conversation.conversationId, actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId };
  const current = await store.table('ticket_conversations').where('conversation_id', context.conversation.conversationId).first('attention_version');
  if (request.readThrough !== undefined && BigInt(request.readThrough) > BigInt(current.attention_version)) return invalid();
  await store.table(PREFS).insert({ tenant: context.conversation.storeTenant, ...key }).onConflict(['tenant', 'conversation_id', 'actor_tenant', 'actor_user_id']).ignore();
  const row = await store.table(PREFS).where(key).forUpdate().first();
  const readThrough = request.readThrough !== undefined && BigInt(request.readThrough) > BigInt(row.last_read_version) ? request.readThrough : String(row.last_read_version);
  const changed = readThrough !== String(row.last_read_version) || (request.following !== undefined && request.following !== row.following);
  if (changed) await store.table(PREFS).where(key).update({ ...(request.following !== undefined ? { following: request.following } : {}),
    last_read_version: readThrough, updated_at: context.trx.fn.now() });
  await assertCoManagedOperationalWrite(context.trx, context.conversation.storeTenant);
  return { changed };
}
