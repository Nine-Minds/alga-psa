import Redis from 'ioredis';
import { withTransaction } from '@shared/db';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';
import { NotificationEvent } from 'server/src/interfaces/notification.interfaces';

export class NotificationPublisher {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }

  async publishNotification(notification: NotificationEvent) {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Save to database
      const [saved] = await trx('notifications')
        .insert({
          id: notification.id,
          tenant: notification.tenant,
          user_id: notification.userId,
          type: notification.type,
          category: notification.category,
          title: notification.title,
          message: notification.message,
          data: notification.data ? JSON.stringify(notification.data) : null,
          action_url: notification.actionUrl,
          priority: notification.priority || 'normal',
          created_at: new Date(),
        })
        .returning('*');

      if (!saved) {
        throw new Error('Failed to save notification');
      }

      // Publish to Redis for real-time delivery
      const channels = [
        `notifications:user:${notification.userId}`,
        `notifications:tenant:${notification.tenant}`,
      ];

      const publishPromises = channels.map(channel =>
        this.redis.publish(channel, JSON.stringify(saved))
      );

      await Promise.all(publishPromises);

      return saved;
    });
  }

  async publishBroadcast(message: any) {
    await this.redis.publish('notifications:broadcast', JSON.stringify(message));
  }

  async publishNotificationRead(userId: number, notificationId: string, tenantId: string) {
    const channels = [
      `notifications:user:${userId}`,
      `notifications:tenant:${tenantId}`,
    ];

    const message = {
      event: 'notification-read',
      data: {
        id: notificationId,
        read_at: new Date(),
      },
    };

    const publishPromises = channels.map(channel =>
      this.redis.publish(channel, JSON.stringify(message))
    );

    await Promise.all(publishPromises);
  }

  disconnect() {
    this.redis.disconnect();
  }
}