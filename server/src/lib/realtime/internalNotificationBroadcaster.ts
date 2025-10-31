import { getRedisClient, getRedisConfig } from '../../config/redisConfig';
import { InternalNotification } from '../models/internalNotification';
import logger from '@alga-psa/shared/core/logger';

/**
 * Broadcast internal notifications via Redis Pub/Sub
 * This allows Hocuspocus and other subscribers to receive real-time notification updates
 */

const NOTIFICATION_CHANNEL_PREFIX = 'internal-notifications:';

/**
 * Get the Redis channel name for a user's notifications
 */
export function getNotificationChannel(tenant: string, userId: string): string {
  const config = getRedisConfig();
  return `${config.prefix}${NOTIFICATION_CHANNEL_PREFIX}${tenant}:${userId}`;
}

/**
 * Broadcast a new notification to all connected clients for a specific user
 */
export async function broadcastNotification(
  notification: InternalNotification
): Promise<void> {
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
    // Don't throw - broadcasting failure shouldn't prevent notification creation
  }
}

/**
 * Broadcast notification marked as read
 */
export async function broadcastNotificationRead(
  tenant: string,
  userId: string,
  notificationId: number
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

/**
 * Broadcast all notifications marked as read
 */
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

/**
 * Update unread count for a user
 */
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
