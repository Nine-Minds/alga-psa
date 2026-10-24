import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withNamedTicketConversation, canScheduleRequester } from './namedTicketConversations';
import { assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { TicketConversationError } from '@alga-psa/shared/lib/tickets/namedConversations';
import { conversationUuid, type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { coManagedConversationAttachmentSources } from './conversationPolicy';

export interface NamedScheduleCursor { at: string; commentId: string }
export interface NamedScheduledComment {
  commentId: string; note: string | null; markdown: string | null; isResolution: boolean; at: string; timeZone: string;
  email: { subject: string; to: { email: string; name?: string }[]; cc: { email: string; name?: string }[] } | null;
  files: { name: string; size: number }[];
}
/** Accepted schedules are staff-visible withheld messages, not private author
 * drafts. This projection never exposes the private operation payload/token. */
export function listNamedScheduledComments(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  reference: TicketConversationReference, after?: NamedScheduleCursor) {
  if (after && (!conversationUuid(after.commentId) || typeof after.at !== 'string' || !Number.isFinite(Date.parse(after.at)) ||
    new Date(after.at).toISOString() !== after.at || Object.keys(after).some(key => !['at', 'commentId'].includes(key))))
    throw new TicketConversationError('CONVERSATION_INVALID');
  const cursor = after ? { at: after.at, commentId: after.commentId.toLowerCase() } : null;
  return withNamedTicketConversation(db, actor, ticket, reference, 'read', async context => {
    if (!canScheduleRequester(context, context.conversation)) return { items: [], next: null };
    const store = tenantDb(context.trx, context.ticket.tenant);
    const query = store.table('comments as c').where({ 'c.ticket_id': context.ticket.ticketId, 'c.publish_state': 'scheduled' }).whereNull('c.deleted_at');
    store.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id');
    store.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id');
    store.tenantJoin(query, 'ticket_conversation_publications as p', 'c.comment_id', 'p.comment_id');
    const rows = await query.where({ 't.ticket_id': context.ticket.ticketId, 't.conversation_id': context.conversation.conversationId,
      'p.ticket_tenant': context.ticket.tenant, 'p.ticket_id': context.ticket.ticketId, 'p.conversation_id': context.conversation.conversationId, 'p.mode': 'send' })
      .whereRaw("jsonb_exists(p.publication_options, 'schedule')").whereRaw("p.thread_id = c.thread_id AND root.ticket_id = c.ticket_id AND root.thread_id = c.thread_id")
      .whereRaw('(?) = ?', [commentAudienceSql(context.trx, 't', 'root', 'c'), 'requester']).whereNull('root.deleted_at')
      .where(q => q.where('root.publish_state', 'published').orWhereRaw('root.comment_id = c.comment_id'))
      .modify(q => { if (cursor) q.whereRaw('(c.scheduled_publish_at, c.comment_id) > (?::timestamptz, ?::uuid)', [cursor.at, cursor.commentId]); })
      .orderBy('c.scheduled_publish_at').orderBy('c.comment_id').limit(26)
      .select('c.comment_id', 'c.note', 'c.markdown_content', 'c.is_resolution', 'c.scheduled_publish_at', 'c.scheduled_publish_tz', 'p.operation_id', 'p.email_envelope');
    const showEmail = !isCoManagedReadFieldHidden(context.hidden, ['email', 'email_envelope', 'recipients', 'from', 'to', 'cc', 'subject']);
    const showFiles = !isCoManagedReadFieldHidden(context.hidden, coManagedConversationAttachmentSources);
    const showResolution = !isCoManagedReadFieldHidden(context.hidden, ['is_resolution', 'comments.is_resolution']);
    const items: NamedScheduledComment[] = [];
    for (const row of rows.slice(0, 25)) {
      const files = showFiles ? await store.table('co_management_conversation_attachments').where({ named_publication_operation_id: row.operation_id,
        comment_id: row.comment_id, status: 'ready' }).whereNull('discarded_at').whereNull('purged_at').select('file_name', 'file_size') : [];
      items.push({ commentId: row.comment_id as string, note: row.note as string, markdown: row.markdown_content as string,
        isResolution: showResolution && Boolean(row.is_resolution), at: new Date(row.scheduled_publish_at).toISOString(), timeZone: row.scheduled_publish_tz as string,
        email: showEmail && row.email_envelope ? { subject: row.email_envelope.subject as string,
          to: row.email_envelope.to as { email: string; name?: string }[], cc: row.email_envelope.cc as { email: string; name?: string }[] } : null,
        files: files.map(file => ({ name: file.file_name as string, size: Number(file.file_size) })) });
    }
    const last = items.at(-1);
    return { items, next: rows.length > 25 && last ? { at: last.at, commentId: last.commentId } : null };
  });
}

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
