import { getRedisClient, getRedisConfig } from '@alga-psa/event-bus';
import type { InternalNotification } from '../types/internalNotification';
import logger from '@alga-psa/core/logger';

/**
 * Broadcast internal notifications via Redis Pub/Sub.
 * This allows Hocuspocus and other subscribers to receive real-time notification updates.
 */

const NOTIFICATION_CHANNEL_PREFIX = 'internal-notifications:';

export function getNotificationChannel(tenant: string, userId: string): string {
  const config = getRedisConfig();
  return `${config.prefix}${NOTIFICATION_CHANNEL_PREFIX}${tenant}:${userId}`;
}

export async function broadcastNotification(notification: InternalNotification): Promise<void> {
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
  } catch (error) {
    logger.error('[NotificationBroadcaster] Failed to broadcast notification', {
      error,
      notificationId: notification.internal_notification_id,
      userId: notification.user_id
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

