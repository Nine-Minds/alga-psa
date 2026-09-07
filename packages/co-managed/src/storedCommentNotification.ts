import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { withCoManagedTicketCommentNotificationRead, type CoManagedTicketCommentNotification } from './ticketCommentNotification';

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
  notificationId: string): Promise<CoManagedStoredCommentNotification | null> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(notificationId)) throw new CoManagedSharedWorkError();
  const home = tenantDb(db, actor.tenant);
  const receipt = await home.table('co_management_in_app_receipts').where({ notification_id: notificationId,
    recipient_user_id: actor.userId, outcome: 'created' }).first();
  if (!receipt) return null;
  const resource = { tenant: receipt.customer_tenant, relationshipId: receipt.relationship_id, kind: 'ticket' as const, id: receipt.ticket_id };
  try {
    return await withCoManagedTicketCommentNotificationRead(db, actor, resource, receipt.comment_id, async (context, message) => {
      const lockedHome = tenantDb(context.trx, actor.tenant);
      const current = await lockedHome.table('co_management_in_app_receipts').where({ delivery_key: receipt.delivery_key,
        notification_id: notificationId, recipient_user_id: actor.userId, outcome: 'created' }).forShare().first();
      if (!current || ['customer_tenant', 'relationship_id', 'ticket_id', 'comment_id', 'event_id'].some(key => current[key] !== receipt[key])) return null;
      const notification = await lockedHome.table('internal_notifications').where({ internal_notification_id: notificationId,
        user_id: actor.userId }).whereNull('deleted_at').forShare().first('template_name', 'language_code', 'metadata');
      if (!notification || !matchesReceipt(notification, current) || notification.metadata.coManaged.threadId !== message.threadId ||
        notification.metadata.coManaged.audience !== message.audience) return null;
      await assertCoManagedSessionUnexpired(context.trx, actor);
      return { notificationId, templateName: notification.template_name, languageCode: notification.language_code,
        deliveryKey: current.delivery_key, eventId: current.event_id, message };
    });
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return null;
    throw error;
  }
}
