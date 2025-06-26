import { withTransaction } from '@shared/db';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';
import { SSEEvent } from 'server/src/interfaces/notification.interfaces';
import logger from '@shared/core/logger';
import { getRedisClient } from 'server/src/config/redisConfig';

interface SubscriberOptions {
  userId: string;
  tenantId: string;
  writer: WritableStreamDefaultWriter;
  encoder: TextEncoder;
}

export class NotificationSubscriber {
  private redis?: Awaited<ReturnType<typeof getRedisClient>>;
  private pubsub?: Awaited<ReturnType<typeof getRedisClient>>;
  private heartbeatInterval?: NodeJS.Timeout;
  private channels: string[] = [];
  private isCleanedUp: boolean = false;
  private redisConnected: boolean = false;

  constructor(private options: SubscriberOptions) {
    // Subscribe to user-specific and tenant-wide channels
    this.channels = [
      `notifications:user:${options.userId}`,
      `notifications:tenant:${options.tenantId}`,
      `notifications:broadcast`,
    ];
    
    // Try to initialize Redis connections
    this.initializeRedis();
  }

  private async initializeRedis() {
    try {
      // Use separate Redis connections for pub/sub
      this.redis = await getRedisClient();
      this.pubsub = await getRedisClient();
      
      this.redisConnected = true;
      logger.info('[NotificationSubscriber] Redis connected successfully');
    } catch (error) {
      logger.warn('[NotificationSubscriber] Failed to connect to Redis, falling back to database-only mode:', error);
      this.redisConnected = false;
      this.redis = undefined;
      this.pubsub = undefined;
    }
  }

  async start() {
    if (this.isCleanedUp) return;

    try {
      // Send initial connection event
      await this.sendEvent({
        event: 'connected',
        data: { 
          userId: this.options.userId,
          redisConnected: this.redisConnected 
        },
      });

      // Subscribe to Redis channels if available
      if (this.redisConnected) {
        await this.setupSubscriptions();
      } else {
        logger.info('[NotificationSubscriber] Running in database-only mode');
      }

      // Send any pending notifications
      await this.sendPendingNotifications();

      // Start heartbeat
      this.startHeartbeat();
    } catch (error) {
      logger.error('Failed to start notification subscriber:', error);
      await this.cleanup();
    }
  }

  private async setupSubscriptions() {
    if (this.isCleanedUp || !this.redisConnected || !this.pubsub) return;

    try {
      // Subscribe to channels - for node-redis we need to subscribe one by one
      for (const channel of this.channels) {
        await this.pubsub.subscribe(channel, async (message, channelName) => {
          if (this.isCleanedUp) return;

          try {
            const notification = JSON.parse(message);
            await this.sendEvent({
              event: 'notification',
              data: notification,
              id: notification.id,
            });
          } catch (error) {
            logger.error('Failed to process notification:', error);
          }
        });
      }
    } catch (error) {
      logger.error('Failed to setup subscriptions:', error);
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
        const notifications = await trx('internal_notifications')
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
      logger.error('Failed to send pending notifications:', error);
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
      logger.debug('Client disconnected:', error);
      // Don't await here as this might be called from a sync context
      this.cleanup().catch(e => logger.debug('Cleanup error:', e));
    }
  }

  async cleanup() {
    if (this.isCleanedUp) return;
    this.isCleanedUp = true;

    try {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }

      // Unsubscribe and disconnect Redis connections
      if (this.pubsub && this.redisConnected) {
        try {
          // For node-redis we need to unsubscribe from each channel
          for (const channel of this.channels) {
            await this.pubsub.unsubscribe(channel);
          }
          // Check if still connected before disconnecting
          if (this.pubsub.isOpen) {
            await this.pubsub.disconnect();
          }
        } catch (redisError) {
          logger.debug('Error cleaning up pubsub:', redisError);
        }
      }

      if (this.redis && this.redisConnected) {
        try {
          // Check if still connected before disconnecting
          if (this.redis.isOpen) {
            await this.redis.disconnect();
          }
        } catch (redisError) {
          logger.debug('Error cleaning up redis:', redisError);
        }
      }
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }
}