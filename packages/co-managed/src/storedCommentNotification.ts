import { withNamedStoredConversationNotification } from './namedStoredConversationNotification';
import type { NamedConversationNotification, NamedNotificationContext } from './namedConversationNotifications';
import { withCoManagedTaskCommentNotification, type CoManagedTaskCommentNotification } from './taskCommentNotification';
import { isCoManagedTaskNotificationAssignee } from './taskCommentRecipients';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { withCoManagedTicketCommentNotification, withCoManagedTicketCommentNotificationRead, type CoManagedTicketCommentNotification } from './ticketCommentNotification';

import { isCoManagedTicketCommentRecipient } from './ticketCommentRecipients';
import type { CoManagedNotificationRecipient, CoManagedNotificationRecipientContext } from './sharedWork';

export interface CoManagedStoredCommentNotification {
  notificationId: string;
  templateName: string;
  languageCode: string;
  deliveryKey: string;
  eventId: string;
  message: CoManagedTicketCommentNotification | CoManagedTaskCommentNotification | NamedConversationNotification;
}

function matchesReceipt(notification: any, receipt: any): boolean {
  const metadata = notification?.metadata;
  const shared = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata.coManaged : null;
  const task = receipt.resource_type === 'project_task';
  return Boolean(shared && shared.version === (task ? 2 : 1) && shared.resource?.kind === (task ? 'project_task' : 'ticket') &&
    shared.resource.tenant === receipt.customer_tenant && shared.resource.relationshipId === receipt.relationship_id &&
    shared.resource.id === (task ? receipt.resource_id : receipt.ticket_id) && shared.commentId === receipt.comment_id && shared.eventId === receipt.event_id &&
    shared.deliveryKey === receipt.delivery_key && (task ? ['requester', 'shared_it', 'organization_private'] : ['requester', 'shared_it']).includes(shared.audience) &&
    notification.template_name === (task ? 'task-comment-added' : 'ticket-comment-added'));

}

/** Stored text is never a fallback for current read authority. A home-owned
 * receipt binds this notification to the actual recipient and qualified source.
 * The returned message is freshly authorized; cached title/body/link/metadata
 * are deliberately absent. Interactive callers supply a verified home session.
 * Customers retain owner-local task reads after separation; MSP archive access
 * uses a separate archive command. */
export async function readCoManagedStoredCommentNotification(db: Knex, inputActor: CoManagedSessionActor,
  notificationId: string, options: { notificationLock?: 'share' | 'update' } = {}): Promise<CoManagedStoredCommentNotification | null> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  return withStoredNotification(db, actor, notificationId, options, async (_context, current) => current);
}

/** Background adapters deliver inside this callback, while recipient, source,
 * receipt and notification locks still protect the freshly authorized text. */
export async function withCoManagedStoredCommentNotification<T>(db: Knex, inputRecipient: CoManagedNotificationRecipient,
  notificationId: string, deliver: (context: NamedNotificationContext, current: CoManagedStoredCommentNotification) => Promise<T>): Promise<T | null> {
  if (!inputRecipient || inputRecipient.kind !== 'notification_recipient' || !isCoManagedUuid(inputRecipient.tenant) || !isCoManagedUuid(inputRecipient.userId)) throw new CoManagedSharedWorkError();
  const actor: CoManagedNotificationRecipient = { kind: 'notification_recipient', tenant: inputRecipient.tenant, userId: inputRecipient.userId };
  return withStoredNotification(db, actor, notificationId, {}, deliver);
}

async function withStoredNotification<T>(db: Knex, actor: CoManagedSessionActor | CoManagedNotificationRecipient,
  notificationId: string, options: { notificationLock?: 'share' | 'update' },
  deliver: (context: NamedNotificationContext, current: CoManagedStoredCommentNotification) => Promise<T>): Promise<T | null> {
  const notificationLock = options.notificationLock ?? 'share';
  if (!['share', 'update'].includes(notificationLock)) throw new CoManagedSharedWorkError();
  if (!isCoManagedUuid(notificationId)) throw new CoManagedSharedWorkError();
  const home = tenantDb(db, actor.tenant);
  const receipt = await home.table('co_management_in_app_receipts').where({ notification_id: notificationId,
    recipient_user_id: actor.userId, outcome: 'created' }).first();
  if (!receipt) return withNamedStoredConversationNotification(db, actor, notificationId, notificationLock, deliver);
  const task = receipt.resource_type === 'project_task';
  if (!task && receipt.resource_type !== undefined && receipt.resource_type !== 'ticket') return null;
  const resource = { tenant: receipt.customer_tenant, relationshipId: receipt.relationship_id, kind: task ? 'project_task' as const : 'ticket' as const, id: task ? receipt.resource_id : receipt.ticket_id };
  try {
    const load = async (context: CoManagedNotificationRecipientContext, message: CoManagedTicketCommentNotification | CoManagedTaskCommentNotification): Promise<T | null> => {
      if (actor.kind === 'notification_recipient' && !await (task ? isCoManagedTaskNotificationAssignee(context) : isCoManagedTicketCommentRecipient(context, message as CoManagedTicketCommentNotification))) return null;
      const lockedHome = tenantDb(context.trx, actor.tenant);
      const current = await lockedHome.table('co_management_in_app_receipts').where({ delivery_key: receipt.delivery_key,
        notification_id: notificationId, recipient_user_id: actor.userId, outcome: 'created' }).forShare().first();
      if (!current || ['customer_tenant', 'relationship_id', 'ticket_id', 'resource_type', 'resource_id', 'comment_id', 'event_id'].some(key => current[key] !== receipt[key])) return null;
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
    if (task) return await withCoManagedTaskCommentNotification(db, actor, resource, receipt.comment_id, load);
    return actor.kind === 'session'
      ? await withCoManagedTicketCommentNotificationRead(db, actor, resource, receipt.comment_id, load)
      : await withCoManagedTicketCommentNotification(db, actor, resource, receipt.comment_id, load);
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return null;
    throw error;
  }
}
