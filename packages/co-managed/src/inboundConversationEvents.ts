import { tenantDb, registerAfterCommitWithConnection } from '@alga-psa/db';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import type { InboundConversationEventRetainer } from '../../../shared/services/email/inboundConversationEvents';
import { enqueueCoManagedConversationEvent, dispatchCoManagedConversationEvents } from './conversationEventOutbox';
import { isCoManagedUuid } from './sharedWorkIdentity';

/** Called inside the already-admitted native comment write. Current tenant and
 * canonical source determine ownership/audience, never a supplied internal flag.
 * This adapter is not an independently callable comment-write authorization. */
export const retainCoManagedInboundCommentEvent: InboundConversationEventRetainer = async (trx, input, publish) => {
  if (!trx.isTransaction || ![input.tenant, input.eventId, input.ticketId, input.commentId].every(isCoManagedUuid)) throw new Error('Invalid native conversation event scope');
  const owner = tenantDb(trx, input.tenant);
  const tenant = await owner.table('tenants').forShare().first('product_code');
  const relationship = await owner.table('co_management_relationships').forShare().first('relationship_id');
  if (tenant?.product_code !== 'co_managed' && !relationship) return false;
  const locator = await owner.table('comments').where({ comment_id: input.commentId, ticket_id: input.ticketId }).first('thread_id');
  if (!locator?.thread_id || !await owner.table('comment_threads').where({ thread_id: locator.thread_id, ticket_id: input.ticketId }).forShare().first()) throw new Error('Native conversation event has no canonical thread');
  const query = owner.table('comments as c').where({ 'c.comment_id': input.commentId, 'c.ticket_id': input.ticketId, 'c.thread_id': locator.thread_id,
    'c.publish_state': 'published' }).whereNull('c.deleted_at');
  owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.ticket_id', '=', 'c.ticket_id') });
  owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.ticket_id', '=', 'c.ticket_id').andOn('root.thread_id', '=', 't.thread_id') });
  const comment = await query.where('root.publish_state', 'published').forShare('c', 't', 'root')
    .select('c.*', { audience: commentAudienceSql(trx, 't', 'root', 'c') }).first();
  if (!comment || comment.actor_reference_id || !['requester', 'shared_it', 'organization_private'].includes(comment.audience)) throw new Error('Native conversation event source is unavailable');
  const publication = { kind: 'event' as const, eventType: 'TICKET_COMMENT_ADDED' as const, ...(input.channel ? { channel: input.channel } : {}),
    payload: { ...input.payload, tenantId: input.tenant, ticketId: input.ticketId, commentId: input.commentId,
      thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id ?? null, is_reply: Boolean(comment.parent_comment_id),
      comment: { ...input.payload.comment, id: input.commentId, content: '', isInternal: comment.audience !== 'requester',
        authorType: comment.author_type === 'internal' ? 'internal' : comment.author_type === 'client' ? 'client' : 'unknown',
        audience: comment.audience, thread_id: comment.thread_id, parent_comment_id: comment.parent_comment_id ?? null, is_reply: Boolean(comment.parent_comment_id) } } };
  await enqueueCoManagedConversationEvent(trx, { tenant: input.tenant, eventId: input.eventId, ticketId: input.ticketId, commentId: input.commentId,
    threadId: comment.thread_id, audience: comment.audience, publication });
  const tenantId = input.tenant, eventId = input.eventId;
  registerAfterCommitWithConnection(trx, root => dispatchCoManagedConversationEvents(root, tenantId, async (event, id) => {
    if (event.kind !== 'event') throw new Error('Unexpected native conversation publication');
    await publish({ eventType: event.eventType, payload: event.payload, channel: event.channel }, id);
  }, { eventId }).then(() => {}), 'native conversation event delivery');
  return true;
};
