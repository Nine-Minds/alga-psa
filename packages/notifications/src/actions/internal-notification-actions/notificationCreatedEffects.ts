import type { Knex } from 'knex';
import { registerAfterCommit } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildNotificationSentPayload } from '@alga-psa/workflow-streams';
import type { InternalNotification } from '../../types/internalNotification';
import { broadcastNotification } from '../../realtime/internalNotificationBroadcaster';
import { runPostCreationHooks } from './notificationHooks';

/** Storage and its receipt/ledger commit together. External effects attach to
 * that owning transaction and never run on rollback or a completed replay.
 * These immediate effects remain best effort: durable transport recovery must
 * separately cover a crash between the storage commit and this callback. */
export function registerNotificationCreatedEffects(trx: Knex.Transaction, notification: InternalNotification,
  options: { postCreationHooks?: boolean; delivery?: (notification: InternalNotification) => Promise<unknown> } = {}): void {
  const createdAt: unknown = notification.created_at;
  const sentAt = typeof createdAt === 'string' ? createdAt : createdAt instanceof Date ? createdAt.toISOString() : new Date().toISOString();
  const runHooks = options.postCreationHooks !== false;
  const delivery = options.delivery;
  registerAfterCommit(trx, () => {
    void publishWorkflowEvent({
      eventType: 'NOTIFICATION_SENT',
      payload: buildNotificationSentPayload({ notificationId: notification.internal_notification_id, channel: 'in_app',
        recipientId: notification.user_id, sentAt, templateId: notification.template_name }),
      ctx: { tenantId: notification.tenant, occurredAt: sentAt, actor: { actorType: 'SYSTEM' },
        correlationId: notification.internal_notification_id },
      idempotencyKey: `notification:${notification.internal_notification_id}:sent`,
    }).catch(error => logger.warn('[NotificationCreatedEffects] Workflow notification event failed', {
      notificationId: notification.internal_notification_id, error: error instanceof Error ? error.message : String(error),
    }));
    if (delivery) {
      void delivery(notification).catch(error => logger.warn('[NotificationCreatedEffects] Durable delivery attempt failed', {
        notificationId: notification.internal_notification_id, error: error instanceof Error ? error.message : String(error),
      }));
      return;
    }
    void broadcastNotification(notification).catch(error => logger.warn('[NotificationCreatedEffects] Notification broadcast failed', {
      notificationId: notification.internal_notification_id, error: error instanceof Error ? error.message : String(error),
    }));
    if (runHooks) void runPostCreationHooks(notification);
  }, `notification=${notification.internal_notification_id} broadcast`);
}
