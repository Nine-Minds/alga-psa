import type { Knex } from 'knex';
import { withCoManagedNotificationRecipient, withCoManagedSharedWork, type CoManagedNotificationRecipient, type CoManagedNotificationRecipientContext, type CoManagedSharedResource } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { readLockedTicketCommentNotification, type TicketCommentNotificationContent } from './ticketCommentNotificationContent';

export interface CoManagedTicketCommentNotification extends Omit<TicketCommentNotificationContent<CoManagedSharedResource>, 'audience'> {
  audience: 'requester' | 'shared_it';
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
    const message = await readLockedTicketCommentNotification(context, commentId, ['requester', 'shared_it']);
    if (!message || message.audience === 'organization_private') return null;
    if (actor.kind === 'session') await assertCoManagedSessionUnexpired(context.trx, actor);
    return deliver(context, { ...message, audience: message.audience });
  };
  return actor.kind === 'session'
    ? withCoManagedSharedWork(db, actor, resource, 'read', context => load({ ...context, action: 'read' }))
    : withCoManagedNotificationRecipient(db, actor, resource, load);
}
