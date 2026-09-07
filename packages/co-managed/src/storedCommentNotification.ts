import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { withCoManagedTicketCommentNotification, withCoManagedTicketCommentNotificationRead, type CoManagedTicketCommentNotification } from './ticketCommentNotification';

import { isCoManagedNotificationAssignee } from './ticketCommentRecipients';
import type { CoManagedNotificationRecipient, CoManagedNotificationRecipientContext } from './sharedWork';

export interface CoManagedStoredCommentNotification {
  notificationId: string;
  templateName: string;
  languageCode: string;
  deliveryKey: string;
  eventId: string;
  message: CoManagedTicketCommentNotification;
}

function matchesReceipt(notification: any, receipt: any): boolean {
  const metadata = notification?.metadata;
  const shared = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata.coManaged : null;
  return Boolean(shared && shared.version === 1 && shared.resource?.kind === 'ticket' &&
    shared.resource.tenant === receipt.customer_tenant && shared.resource.relationshipId === receipt.relationship_id &&
    shared.resource.id === receipt.ticket_id && shared.commentId === receipt.comment_id && shared.eventId === receipt.event_id &&
    shared.deliveryKey === receipt.delivery_key && ['requester', 'shared_it'].includes(shared.audience) &&
    notification.template_name === 'ticket-comment-added');
}

/** Stored text is never a fallback for current read authority. An MSP-owned
 * receipt binds this notification to the actual recipient and qualified source.
 * The returned message is freshly authorized; cached title/body/link/metadata
 * are deliberately absent. Interactive callers supply a verified home session.
 * Historical archive access after separation uses a separate archive command. */
export async function readCoManagedStoredCommentNotification(db: Knex, inputActor: CoManagedSessionActor,
  notificationId: string, options: { notificationLock?: 'share' | 'update' } = {}): Promise<CoManagedStoredCommentNotification | null> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  return withStoredNotification(db, actor, notificationId, options, async (_context, current) => current);
}

/** Background adapters deliver inside this callback, while recipient, source,
 * receipt and notification locks still protect the freshly authorized text. */
export async function withCoManagedStoredCommentNotification<T>(db: Knex, inputRecipient: CoManagedNotificationRecipient,
  notificationId: string, deliver: (context: CoManagedNotificationRecipientContext, current: CoManagedStoredCommentNotification) => Promise<T>): Promise<T | null> {
  if (!inputRecipient || inputRecipient.kind !== 'notification_recipient' || !isCoManagedUuid(inputRecipient.tenant) || !isCoManagedUuid(inputRecipient.userId)) throw new CoManagedSharedWorkError();
  const actor: CoManagedNotificationRecipient = { kind: 'notification_recipient', tenant: inputRecipient.tenant, userId: inputRecipient.userId };
  return withStoredNotification(db, actor, notificationId, {}, deliver);
}

async function withStoredNotification<T>(db: Knex, actor: CoManagedSessionActor | CoManagedNotificationRecipient,
  notificationId: string, options: { notificationLock?: 'share' | 'update' },
  deliver: (context: CoManagedNotificationRecipientContext, current: CoManagedStoredCommentNotification) => Promise<T>): Promise<T | null> {
  const notificationLock = options.notificationLock ?? 'share';
  if (!['share', 'update'].includes(notificationLock)) throw new CoManagedSharedWorkError();
  if (!isCoManagedUuid(notificationId)) throw new CoManagedSharedWorkError();
  const home = tenantDb(db, actor.tenant);
  const receipt = await home.table('co_management_in_app_receipts').where({ notification_id: notificationId,
    recipient_user_id: actor.userId, outcome: 'created' }).first();
  if (!receipt) return null;
  const resource = { tenant: receipt.customer_tenant, relationshipId: receipt.relationship_id, kind: 'ticket' as const, id: receipt.ticket_id };
  try {
    const load = async (context: CoManagedNotificationRecipientContext, message: CoManagedTicketCommentNotification): Promise<T | null> => {
      if (actor.kind === 'notification_recipient' && !await isCoManagedNotificationAssignee(context)) return null;
      const lockedHome = tenantDb(context.trx, actor.tenant);
      const current = await lockedHome.table('co_management_in_app_receipts').where({ delivery_key: receipt.delivery_key,
        notification_id: notificationId, recipient_user_id: actor.userId, outcome: 'created' }).forShare().first();
      if (!current || ['customer_tenant', 'relationship_id', 'ticket_id', 'comment_id', 'event_id'].some(key => current[key] !== receipt[key])) return null;
      const notificationQuery = lockedHome.table('internal_notifications').where({ internal_notification_id: notificationId,
        user_id: actor.userId }).whereNull('deleted_at');
      // Mark-read callers lock for update initially; upgrading two retained
      // share locks would deadlock concurrent reads of the same inbox item.
      if (notificationLock === 'update') notificationQuery.forUpdate(); else notificationQuery.forShare();
      const notification = await notificationQuery.first('template_name', 'language_code', 'metadata');
      if (!notification || !matchesReceipt(notification, current) || notification.metadata.coManaged.threadId !== message.threadId ||
        notification.metadata.coManaged.audience !== message.audience) return null;
      if (actor.kind === 'session') await assertCoManagedSessionUnexpired(context.trx, actor);
      return deliver(context, { notificationId, templateName: notification.template_name, languageCode: notification.language_code,
        deliveryKey: current.delivery_key, eventId: current.event_id, message });
    };
    return actor.kind === 'session'
      ? await withCoManagedTicketCommentNotificationRead(db, actor, resource, receipt.comment_id, load)
      : await withCoManagedTicketCommentNotification(db, actor, resource, receipt.comment_id, load);
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return null;
    throw error;
  }
}
