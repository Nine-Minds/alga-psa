import { getRedisClient, getRedisConfig } from '@alga-psa/event-bus';
import type { InternalNotification } from '../types/internalNotification';
import logger from '@alga-psa/core/logger';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildNotificationDeliveredPayload,
  buildNotificationFailedPayload,
} from '@shared/workflow/streams/domainEventBuilders/notificationEventBuilders';

/**
 * Broadcast internal notifications via Redis Pub/Sub.
 * This allows Hocuspocus and other subscribers to receive real-time notification updates.
 */

const NOTIFICATION_CHANNEL_PREFIX = 'internal-notifications:';

export function getNotificationChannel(tenant: string, userId: string): string {
  const config = getRedisConfig();
  return `${config.prefix}${NOTIFICATION_CHANNEL_PREFIX}${tenant}:${userId}`;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || 'Unknown error';
  return String(error || 'Unknown error');
}

function safePublishNotificationWorkflowEvent(params: Parameters<typeof publishWorkflowEvent>[0]): void {
  void publishWorkflowEvent(params).catch((error) => {
    logger.warn('[NotificationBroadcaster] Failed to publish workflow notification event', {
      error: normalizeErrorMessage(error),
      eventType: params.eventType,
    });
  });
}

export async function broadcastNotification(notification: InternalNotification): Promise<void> {
  const now = new Date().toISOString();
  try {
    const client = await getRedisClient();
    const channel = getNotificationChannel(notification.tenant, notification.user_id);

    const message = JSON.stringify({
      type: 'notification.created',
      notification,
      timestamp: new Date().toISOString()
    });

    await client.publish(channel, message);

    logger.info('[NotificationBroadcaster] Notification broadcasted', {
      channel,
      notificationId: notification.internal_notification_id,
      userId: notification.user_id,
      tenant: notification.tenant
    });

    await client.disconnect();

    safePublishNotificationWorkflowEvent({
      eventType: 'NOTIFICATION_DELIVERED',
      payload: buildNotificationDeliveredPayload({
        notificationId: notification.internal_notification_id,
        channel: 'in_app',
        recipientId: notification.user_id,
        deliveredAt: now,
      }),
      ctx: {
        tenantId: notification.tenant,
        occurredAt: now,
        actor: { actorType: 'SYSTEM' },
        correlationId: `notification:${notification.internal_notification_id}`,
      },
      idempotencyKey: `notification:${notification.internal_notification_id}:delivered`,
    });
  } catch (error) {
    logger.error('[NotificationBroadcaster] Failed to broadcast notification', {
      error,
      notificationId: notification.internal_notification_id,
      userId: notification.user_id
    });

    safePublishNotificationWorkflowEvent({
      eventType: 'NOTIFICATION_FAILED',
      payload: buildNotificationFailedPayload({
        notificationId: notification.internal_notification_id,
        channel: 'in_app',
        recipientId: notification.user_id,
        failedAt: now,
        errorCode: 'redis_publish_failed',
        errorMessage: normalizeErrorMessage(error),
        retryable: true,
      }),
      ctx: {
        tenantId: notification.tenant,
        occurredAt: now,
        actor: { actorType: 'SYSTEM' },
        correlationId: `notification:${notification.internal_notification_id}`,
      },
      idempotencyKey: `notification:${notification.internal_notification_id}:failed`,
    });
  }
}

export async function broadcastNotificationRead(
  tenant: string,
  userId: string,
  notificationId: string
): Promise<void> {
  try {
    const client = await getRedisClient();
    const channel = getNotificationChannel(tenant, userId);

    const message = JSON.stringify({
      type: 'notification.read',
      notificationId,
      timestamp: new Date().toISOString()
    });

    await client.publish(channel, message);

    logger.info('[NotificationBroadcaster] Notification read broadcasted', {
      channel,
      notificationId,
      userId,
      tenant
    });

    await client.disconnect();
  } catch (error) {
    logger.error('[NotificationBroadcaster] Failed to broadcast notification read', {
      error,
      notificationId,
      userId
    });
  }
}

export async function broadcastAllNotificationsRead(
  tenant: string,
  userId: string
): Promise<void> {
  try {
    const client = await getRedisClient();
    const channel = getNotificationChannel(tenant, userId);

    const message = JSON.stringify({
      type: 'notifications.all_read',
      timestamp: new Date().toISOString()
    });

    await client.publish(channel, message);

    logger.info('[NotificationBroadcaster] All notifications read broadcasted', {
      channel,
      userId,
      tenant
    });

    await client.disconnect();
  } catch (error) {
    logger.error('[NotificationBroadcaster] Failed to broadcast all notifications read', {
      error,
      userId
    });
  }
}

export async function broadcastUnreadCount(
  tenant: string,
  userId: string,
  unreadCount: number
): Promise<void> {
  try {
    const client = await getRedisClient();
    const channel = getNotificationChannel(tenant, userId);

    const message = JSON.stringify({
      type: 'notifications.unread_count',
      unreadCount,
      timestamp: new Date().toISOString()
    });

    await client.publish(channel, message);

    logger.info('[NotificationBroadcaster] Unread count broadcasted', {
      channel,
      unreadCount,
      userId,
      tenant
    });

    await client.disconnect();
  } catch (error) {
    logger.error('[NotificationBroadcaster] Failed to broadcast unread count', {
      error,
      userId,
      unreadCount
    });
  }
}
