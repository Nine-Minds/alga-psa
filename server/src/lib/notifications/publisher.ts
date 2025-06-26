import { withTransaction } from '@shared/db';
import { createTenantKnex } from 'server/src/lib/db';
import { getConnection } from '@shared/db/connection';
import { Knex } from 'knex';
import { 
  CreateNotificationData, 
  InternalNotification, 
  NotificationSseEvent, 
  NotificationTemplate 
} from 'server/src/interfaces/notification.interfaces';
import logger from '@shared/core/logger';
import { getRedisClient } from 'server/src/config/redisConfig';

// A simple template engine
function compileTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
}

export class NotificationPublisher {
  private redis?: Awaited<ReturnType<typeof getRedisClient>>;
  private redisConnected: boolean = false;

  constructor() {
    this.initializeRedis();
  }

  private async initializeRedis() {
    try {
      this.redis = await getRedisClient();
      this.redisConnected = true;
      logger.info('[NotificationPublisher] Redis connected successfully');
    } catch (error) {
      logger.warn('[NotificationPublisher] Failed to connect to Redis, notifications will work without real-time updates:', error);
      this.redisConnected = false;
      this.redis = undefined;
    }
  }

  async publishNotification(notificationData: CreateNotificationData): Promise<InternalNotification> {
    const { knex: tenantKnex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // 1. Fetch the template (using a generic connection for global table)
    const genericKnex = await getConnection();
    const template: NotificationTemplate | undefined = await genericKnex('internal_notification_templates')
      .where('type_id', notificationData.type_id)
      .first();

    if (!template) {
      throw new Error(`Notification template for type ${notificationData.type_id} not found.`);
    }

    // 2. Compile title and message
    const templateData = notificationData.data || {};
    const title = notificationData.title || compileTemplate(template.title_template || '', templateData);
    const message = notificationData.message || compileTemplate(template.message_template || '', templateData);

    // 3. Determine priority
    const priority_id = notificationData.priority_id || template.default_priority_id;

    // 4. Save to database within a transaction
    const savedNotification: InternalNotification = await withTransaction(tenantKnex, async (trx: Knex.Transaction) => {
      const [saved] = await trx('internal_notifications')
        .insert({
          tenant,
          user_id: notificationData.user_id,
          type_id: notificationData.type_id,
          title,
          message,
          data: notificationData.data ? JSON.stringify(notificationData.data) : null,
          action_url: notificationData.action_url,
          priority_id,
          expires_at: notificationData.expires_at,
        })
        .returning('*');

      if (!saved) {
        throw new Error('Failed to save notification');
      }
      return saved;
    });

    // 5. Fetch enriched data for SSE event
    const sseEventPayload = await this.createSsePayload(savedNotification.internal_notification_id);

    // 6. Publish to Redis for real-time delivery (if Redis is available)
    if (sseEventPayload && this.redisConnected) {
      const channels = [
        `notifications:user:${savedNotification.user_id}`,
        `notifications:tenant:${tenant}`,
      ];
      await this.publishToChannels(channels, { event: 'notification', data: sseEventPayload });
    } else if (sseEventPayload && !this.redisConnected) {
      logger.debug('[NotificationPublisher] Notification saved to database but not published to Redis (Redis not connected)');
    }

    return savedNotification;
  }

  async publishNotificationRead(userId: string, notificationId: string, tenantId: string) {
    if (!this.redisConnected) {
      logger.debug('[NotificationPublisher] Notification read event not published (Redis not connected)');
      return;
    }

    const channels = [
      `notifications:user:${userId}`,
      `notifications:tenant:${tenantId}`,
    ];
    const message = {
      event: 'notification-read',
      data: {
        internal_notification_id: notificationId,
        read_at: new Date().toISOString(),
      },
    };
    await this.publishToChannels(channels, message);
  }

  private async createSsePayload(notificationId: string): Promise<NotificationSseEvent | null> {
    // Use tenant-specific knex to fetch tenant-data
    const { knex: tenantKnex } = await createTenantKnex();
    
    const notification = await tenantKnex('internal_notifications as n')
      .where('n.internal_notification_id', notificationId)
      .join('internal_notification_types as nt', 'n.type_id', 'nt.internal_notification_type_id')
      .leftJoin('standard_priorities as sp', 'n.priority_id', 'sp.priority_id')
      .select(
        'n.internal_notification_id',
        'n.tenant',
        'n.user_id',
        'n.title',
        'n.message',
        'n.data',
        'n.action_url',
        'n.created_at',
        'nt.type_name',
        'nt.category_name',
        'sp.priority_name',
        'sp.color as priority_color'
      )
      .first();

    if (!notification) return null;

    return {
      internal_notification_id: notification.internal_notification_id,
      tenant: notification.tenant,
      user_id: notification.user_id,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      action_url: notification.action_url,
      created_at: new Date(notification.created_at).toISOString(),
      type_name: notification.type_name,
      category_name: notification.category_name,
      priority_name: notification.priority_name,
      priority_color: notification.priority_color,
    };
  }

  private async publishToChannels(channels: string[], message: any) {
    if (!this.redisConnected || !this.redis) {
      logger.debug('[NotificationPublisher] Cannot publish to channels (Redis not connected)');
      return;
    }

    try {
      const publishPromises = channels.map(channel =>
        this.redis!.publish(channel, JSON.stringify(message))
      );
      await Promise.all(publishPromises);
    } catch (error) {
      logger.error('[NotificationPublisher] Failed to publish to Redis channels:', error);
      this.redisConnected = false; // Mark as disconnected for future calls
    }
  }

  async disconnect() {
    if (this.redis && this.redisConnected) {
      try {
        await this.redis.disconnect();
      } catch (error) {
        logger.debug('[NotificationPublisher] Error disconnecting Redis:', error);
      }
    }
  }
}
