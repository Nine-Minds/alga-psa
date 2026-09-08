import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { conversationUuid, snapshotConversationReference, TicketConversationError,
  type NamedTicketConversation, type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { withNamedTicketConversation } from './namedTicketConversations';
import type { CoManagedSessionActor } from './sharedWorkIdentity';
import { coManagedConversationAttachmentSources, coManagedConversationBodySources } from './conversationPolicy';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { listPublishedCoManagedAttachments, readPublishedCoManagedAttachment } from './conversationAttachments';
import type { CoManagedConversationItem } from './ticketConversation';

const deny = (): never => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };
type Context = { trx: Knex.Transaction; ticket: ConversationTicketReference; conversation: NamedTicketConversation; hidden: readonly string[] };
export async function namedConversationMessageContext(context: Context, commentId: string, threadId: string) {
  if (![commentId, threadId].every(conversationUuid) || isCoManagedReadFieldHidden(context.hidden,
    coManagedConversationBodySources)) return deny();
  const { trx, conversation, ticket } = context, owner = tenantDb(trx, conversation.storeTenant);
  if (conversation.storeTenant !== ticket.tenant) {
    const thread = await owner.table('co_management_private_threads').where({ conversation_id: conversation.conversationId, thread_id: threadId,
      customer_tenant: ticket.tenant, relationship_id: ticket.relationshipId, resource_type: 'ticket', resource_id: ticket.ticketId }).forShare().first();
    if (!thread || thread.disclosure_operation_id || conversation.audience !== 'organization_private') return deny();
    const rows = await owner.table('co_management_private_comments').where('thread_id', threadId)
      .whereIn('comment_id', [...new Set([thread.root_comment_id, commentId])]).whereNull('deleted_at').forShare();
    if (!rows.some(row => row.comment_id === commentId) || !rows.some(row => row.comment_id === thread.root_comment_id)) return deny();
  } else {
    const query = owner.table('comments as c').where({ 'c.ticket_id': ticket.ticketId, 'c.comment_id': commentId, 'c.thread_id': threadId });
    owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('c.ticket_id', '=', 't.ticket_id') });
    owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 't.ticket_id') });
    const row = await query.where('t.conversation_id', conversation.conversationId).where('c.publish_state', 'published').where('root.publish_state', 'published')
      .whereNull('c.deleted_at').whereNull('root.deleted_at').forShare('c', 't', 'root').select({ audience: commentAudienceSql(trx, 't', 'root', 'c') }).first();
    if (!row || row.audience !== conversation.audience) return deny();
  }
  // Requester files belong to the ticket owner, including mail received without
  // a relationship. Current named-ticket admission already authorizes the MSP
  // reader; a relationship filter here would hide that owner's requester files.
  const relationshipId = conversation.storeTenant === ticket.tenant && conversation.audience === 'requester' ? undefined : ticket.relationshipId;
  return { trx, resource: { tenant: ticket.tenant, id: ticket.ticketId, relationshipId },
    comment: { storeTenant: conversation.storeTenant, commentId, threadId }, audience: conversation.audience };
}
export async function namedConversationMessageFileContext(context: Context, commentId: string, threadId: string) {
  if (isCoManagedReadFieldHidden(context.hidden, coManagedConversationAttachmentSources)) return deny();
  return namedConversationMessageContext(context, commentId, threadId);
}
/** The caller already selected this authorized conversation before pagination.
 * Only published files inherit its message/root audience; paths never project. */
export async function attachNamedConversationFiles(context: Context, items: CoManagedConversationItem[]) {
  if (isCoManagedReadFieldHidden(context.hidden, [...coManagedConversationAttachmentSources, ...coManagedConversationBodySources])) return;
  for (const item of items) {
    if (item.deleted || item.storeTenant !== context.conversation.storeTenant) continue;
    try {
      const selected = await namedConversationMessageFileContext(context, item.commentId, item.threadId);
      item.attachments = await listPublishedCoManagedAttachments(selected);
    } catch (error) {
      // Deleted or unavailable roots keep their existing history projection,
      // without lending authority to any retained file beneath that root.
      if (!(error instanceof TicketConversationError && error.code === 'CONVERSATION_FORBIDDEN')) throw error;
    }
  }
}
export function listNamedConversationAttachments(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, comment: { commentId: string; threadId: string }) {
  const ref = snapshotConversationReference(input);
  const selected = { commentId: comment.commentId, threadId: comment.threadId };
  return withNamedTicketConversation(db, actor, ticket, ref, 'read', async context =>
    listPublishedCoManagedAttachments(await namedConversationMessageFileContext(context, selected.commentId, selected.threadId)));
}
export function downloadNamedConversationAttachment(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, file: { attachmentId: string; commentId: string; threadId: string }, download: (path: string) => Promise<Uint8Array>) {
  const ref = snapshotConversationReference(input);
  if (!file || ![file.attachmentId, file.commentId, file.threadId].every(conversationUuid) ||
    Object.keys(file).some(key => !['attachmentId', 'commentId', 'threadId'].includes(key))) return Promise.reject(new TicketConversationError('CONVERSATION_INVALID'));
  const selected = { attachmentId: file.attachmentId.toLowerCase(), commentId: file.commentId.toLowerCase(), threadId: file.threadId.toLowerCase() };
  return withNamedTicketConversation(db, actor, ticket, ref, 'read', async context => {
    const source = await namedConversationMessageFileContext(context, selected.commentId, selected.threadId);
    return readPublishedCoManagedAttachment(source, selected.attachmentId, download);
  });
}
