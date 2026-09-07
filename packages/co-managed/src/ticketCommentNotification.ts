import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { withCoManagedNotificationRecipient, withCoManagedSharedWork, type CoManagedNotificationRecipient, type CoManagedNotificationRecipientContext, type CoManagedSharedResource } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationBodySources, coManagedConversationAuthorSources } from './conversationPolicy';
import type { CoManagedConversationAuthor } from './ticketConversation';

export interface CoManagedTicketCommentNotification {
  resource: CoManagedSharedResource;
  commentId: string;
  threadId: string;
  audience: 'requester' | 'shared_it';
  note: string;
  ticketNumber?: string;
  ticketTitle?: string;
  author?: CoManagedConversationAuthor;
}

/** Customer-owned shared content only. The event identifies a comment; its
 * cached body/author/audience are never a source of delivery authority. Current
 * resource, thread and comment locks remain held through the delivery callback.
 * Notification storage/broadcast adapters must preserve qualified references. */
export async function withCoManagedTicketCommentNotification<T>(db: Knex, recipient: CoManagedNotificationRecipient,
  resource: CoManagedSharedResource, commentId: string,
  deliver: (context: CoManagedNotificationRecipientContext, message: CoManagedTicketCommentNotification) => Promise<T>): Promise<T | null> {
  if (!recipient || recipient.kind !== 'notification_recipient') throw new CoManagedSharedWorkError();
  return withCommentContent(db, recipient, resource, commentId, deliver);
}

/** Interactive notification reads require their own verified home session. */
export async function withCoManagedTicketCommentNotificationRead<T>(db: Knex, inputActor: CoManagedSessionActor,
  resource: CoManagedSharedResource, commentId: string,
  read: (context: CoManagedNotificationRecipientContext, message: CoManagedTicketCommentNotification) => Promise<T>): Promise<T | null> {
  return withCommentContent(db, snapshotCoManagedSessionActor(inputActor), resource, commentId, read);
}

async function withCommentContent<T>(db: Knex, actor: CoManagedSessionActor | CoManagedNotificationRecipient,
  resource: CoManagedSharedResource, commentId: string,
  deliver: (context: CoManagedNotificationRecipientContext, message: CoManagedTicketCommentNotification) => Promise<T>): Promise<T | null> {
  if (!resource || resource.kind !== 'ticket' || !isCoManagedUuid(commentId)) throw new CoManagedSharedWorkError();
  const load = async (context: CoManagedNotificationRecipientContext): Promise<T | null> => {
    const { trx, actor: homeActor, redactedFields } = context;
    const owner = tenantDb(trx, context.resource.tenant);
    if (isCoManagedReadFieldHidden(redactedFields, [...coManagedConversationBodySources, 'comments', 'comment_threads', 'comment_id'])) return null;
    const locator = await owner.table('comments').where({ ticket_id: context.resource.id, comment_id: commentId }).first('thread_id');
    if (!locator?.thread_id) return null;
    // Match native command lock order: ticket -> thread -> comment/root. The
    // thread lock serializes disclosure and reply operations during delivery.
    const thread = await owner.table('comment_threads').where({ thread_id: locator.thread_id, ticket_id: context.resource.id }).forShare().first('thread_id');
    if (!thread) return null;
    const query = owner.table('comments as c').where({ 'c.comment_id': commentId, 'c.ticket_id': context.resource.id,
      'c.thread_id': thread.thread_id, 'c.publish_state': 'published' }).whereNull('c.deleted_at');
    owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.ticket_id', '=', 'c.ticket_id') });
    owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', {
      on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 'c.ticket_id') });
    const audience = commentAudienceSql(trx, 't', 'root', 'c');
    const comment = await query.where('root.publish_state', 'published').whereRaw('? IN (?, ?)', [audience, 'requester', 'shared_it'])
      .select('c.user_id', 'c.contact_id', 'c.actor_reference_id', 'c.actor_display_name', 'c.actor_organization_name', 'c.note', 'c.is_system_generated', { audience }).forShare().first();
    if (!comment) return null;
    let author: CoManagedConversationAuthor;
    if (comment.actor_reference_id) {
      const reference = await owner.table('collaboration_actor_references').where('actor_reference_id', comment.actor_reference_id).forShare().first('actor_tenant', 'actor_user_id');
      if (!reference || comment.user_id || comment.contact_id || !comment.actor_display_name || !comment.actor_organization_name) return null;
      author = { tenant: reference.actor_tenant, kind: 'user', id: reference.actor_user_id, referenceId: comment.actor_reference_id,
        displayName: comment.actor_display_name, organizationName: comment.actor_organization_name };
    } else {
      const organization = await owner.table('tenants').first('client_name');
      const user = comment.user_id ? await owner.table('users').where('user_id', comment.user_id).forShare().first('first_name', 'last_name') : null;
      const contact = !comment.user_id && comment.contact_id ? await owner.table('contacts').where('contact_name_id', comment.contact_id).forShare().first('full_name') : null;
      author = { tenant: context.resource.tenant, kind: comment.user_id ? 'user' : comment.contact_id ? 'contact' : comment.is_system_generated ? 'system' : 'unknown',
        id: comment.user_id ?? comment.contact_id ?? null, referenceId: null,
        displayName: user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : contact?.full_name ?? null, organizationName: organization?.client_name ?? null };
    }
    // Self-suppression compares the qualified identity, even when display fields
    // are redacted. A coincident customer UUID is a different author.
    if (author.kind === 'user' && author.tenant === homeActor.tenant && author.id === homeActor.userId) return null;
    const ticket = await owner.table('tickets').where('ticket_id', context.resource.id).first('ticket_number', 'title');
    if (!ticket) return null;
    const message: CoManagedTicketCommentNotification = {
      resource: { ...context.resource }, commentId, threadId: thread.thread_id, audience: comment.audience, note: comment.note ?? '',
      ...(!isCoManagedReadFieldHidden(redactedFields, ['ticket_number', 'tickets.ticket_number']) ? { ticketNumber: ticket.ticket_number } : {}),
      ...(!isCoManagedReadFieldHidden(redactedFields, ['title', 'tickets.title']) ? { ticketTitle: ticket.title } : {}),
      ...(!isCoManagedReadFieldHidden(redactedFields, coManagedConversationAuthorSources) ? { author } : {}),
    };
    if (actor.kind === 'session') await assertCoManagedSessionUnexpired(trx, actor);
    return deliver(context, message);
  };
  return actor.kind === 'session'
    ? withCoManagedSharedWork(db, actor, resource, 'read', context => load({ ...context, action: 'read' }))
    : withCoManagedNotificationRecipient(db, actor, resource, load);
}
