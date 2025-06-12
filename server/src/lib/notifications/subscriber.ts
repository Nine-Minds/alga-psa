import Redis from 'ioredis';
import { withTransaction } from '@shared/db';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';
import { SSEEvent } from 'server/src/interfaces/notification.interfaces';

interface SubscriberOptions {
  userId: string;
  tenantId: string;
  writer: WritableStreamDefaultWriter;
  encoder: TextEncoder;
}

export class NotificationSubscriber {
  private redis: Redis;
  private pubsub: Redis;
  private heartbeatInterval?: NodeJS.Timeout;
  private channels: string[] = [];
  private isCleanedUp: boolean = false;

  constructor(private options: SubscriberOptions) {
    // Use separate Redis connections for pub/sub
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.pubsub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    // Subscribe to user-specific and tenant-wide channels
    this.channels = [
      `notifications:user:${options.userId}`,
      `notifications:tenant:${options.tenantId}`,
      `notifications:broadcast`,
    ];
  }

  async start() {
    if (this.isCleanedUp) return;

    try {
      // Send initial connection event
      await this.sendEvent({
        event: 'connected',
        data: { userId: this.options.userId },
      });

      // Subscribe to Redis channels
      await this.setupSubscriptions();

      // Send any pending notifications
      await this.sendPendingNotifications();

      // Start heartbeat
      this.startHeartbeat();
    } catch (error) {
      console.error('Failed to start notification subscriber:', error);
      this.cleanup();
    }
  }

  private async setupSubscriptions() {
    if (this.isCleanedUp) return;

    try {
      // Subscribe to channels
      await this.pubsub.subscribe(...this.channels);

      // Handle incoming messages
      this.pubsub.on('message', async (channel, message) => {
        if (this.isCleanedUp) return;

        try {
          const notification = JSON.parse(message);
          await this.sendEvent({
            event: 'notification',
            data: notification,
            id: notification.id,
          });
        } catch (error) {
          console.error('Failed to process notification:', error);
        }
      });
    } catch (error) {
      console.error('Failed to setup subscriptions:', error);
      throw error;
    }
  }

  private async sendPendingNotifications() {
    if (this.isCleanedUp) return;

    try {
      const { knex, tenant } = await createTenantKnex();
      
      if (!tenant) {
        console.error('No tenant found for pending notifications');
        return;
      }

      await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Fetch unread notifications from database
        const notifications = await trx('notifications')
          .where('user_id', this.options.userId)
          .where('tenant', tenant)
          .whereNull('read_at')
          .whereNull('archived_at')
          .orderBy('created_at', 'desc')
          .limit(20)
          .select('*');

        // Send as initial data
        if (notifications.length > 0) {
          await this.sendEvent({
            event: 'initial-notifications',
            data: notifications,
          });
        }
      });
    } catch (error) {
      console.error('Failed to send pending notifications:', error);
    }
  }

  private startHeartbeat() {
    if (this.isCleanedUp) return;

    // Send heartbeat every 30 seconds to keep connection alive
    this.heartbeatInterval = setInterval(async () => {
      if (this.isCleanedUp) return;

      await this.sendEvent({
        event: 'heartbeat',
        data: { timestamp: Date.now() },
      });
    }, 30000);
  }

  private async sendEvent({ event, data, id }: SSEEvent) {
    if (this.isCleanedUp) return;

    const { writer, encoder } = this.options;
    
    try {
      // Format SSE message
      let message = '';
      if (id) message += `id: ${id}\n`;
      if (event) message += `event: ${event}\n`;
      message += `data: ${JSON.stringify(data)}\n\n`;

      await writer.write(encoder.encode(message));
    } catch (error) {
      // Client disconnected
      console.log('Client disconnected:', error);
      this.cleanup();
    }
  }

  cleanup() {
    if (this.isCleanedUp) return;
    this.isCleanedUp = true;

    try {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }

      // Unsubscribe and disconnect Redis connections
      if (this.pubsub) {
        this.pubsub.unsubscribe(...this.channels);
        this.pubsub.disconnect();
      }

      if (this.redis) {
        this.redis.disconnect();
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}