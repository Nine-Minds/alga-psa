import { getRedisClient, getRedisConfig } from '../../config/redisConfig';
import logger from '@alga-psa/core/logger';
import type { RedisClientType } from 'redis';

/**
 * Accumulated change record for a ticket update
 */
export interface AccumulatedChange {
  timestamp: string;
  userId: string;
  changes: Record<string, { old?: unknown; new?: unknown }>;
}

/**
 * Pending notification record stored in Redis
 */
export interface PendingNotification {
  tenantId: string;
  ticketId: string;
  recipientEmail: string;
  recipientUserId?: string;
  isInternal: boolean; // true for assigned users/resources, false for contacts/clients
  accumulatedChanges: AccumulatedChange[];
  createdAt: string;
}

/**
 * Configuration for the notification accumulator
 */
export interface AccumulatorConfig {
  /** Time window in milliseconds to accumulate changes before sending (default: 30000 = 30s) */
  accumulationWindowMs: number;
  /** Interval in milliseconds between flush checks (default: 5000 = 5s) */
  flushIntervalMs: number;
}

const DEFAULT_CONFIG: AccumulatorConfig = {
  accumulationWindowMs: 30_000, // 30 seconds
  flushIntervalMs: 5_000, // 5 seconds
};

/**
 * Callback function type for processing accumulated notifications
 */
export type FlushCallback = (notification: PendingNotification) => Promise<void>;

/**
 * NotificationAccumulator - Accumulates ticket update notifications and sends them in batches
 *
 * This service intercepts ticket update events and accumulates them by ticket+recipient combination.
 * After a configurable time window, it flushes the accumulated changes as a single notification.
 *
 * Redis storage structure:
 * - Hash: `{prefix}email-accumulator:pending:{tenantId}:{ticketId}:{recipientEmail}` - notification data
 * - Sorted Set: `{prefix}email-accumulator:flush_times` - flush timestamps for polling
 *
 * The `email-accumulator` namespace ensures these keys are isolated from other notification systems
 * and only processed by hosts running the accumulator flush loop.
 */
export class NotificationAccumulator {
  private static instance: NotificationAccumulator | null = null;
  private redis: RedisClientType | null = null;
  private config: AccumulatorConfig;
  private flushInterval: NodeJS.Timeout | null = null;
  private flushCallback: FlushCallback | null = null;
  private prefix: string;
  private isInitialized = false;

  /** Namespace for email accumulator keys, follows emailservice::vN convention */
  private static readonly ACCUMULATOR_NAMESPACE = 'emailservice::accumulator::v1:';

  private constructor(config: Partial<AccumulatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.prefix = getRedisConfig().prefix + NotificationAccumulator.ACCUMULATOR_NAMESPACE;
  }

  /**
   * Get singleton instance of the accumulator
   */
  static getInstance(config?: Partial<AccumulatorConfig>): NotificationAccumulator {
    if (!NotificationAccumulator.instance) {
      NotificationAccumulator.instance = new NotificationAccumulator(config);
    }
    return NotificationAccumulator.instance;
  }

  /**
   * Initialize the accumulator with Redis connection and start the flush loop
   */
  async initialize(flushCallback: FlushCallback): Promise<void> {
    if (this.isInitialized) {
      logger.warn('[NotificationAccumulator] Already initialized');
      return;
    }

    try {
      this.redis = await getRedisClient() as RedisClientType;
      this.flushCallback = flushCallback;
      this.startFlushLoop();
      this.isInitialized = true;
      logger.info('[NotificationAccumulator] Initialized successfully', {
        accumulationWindowMs: this.config.accumulationWindowMs,
        flushIntervalMs: this.config.flushIntervalMs
      });
    } catch (error) {
      logger.error('[NotificationAccumulator] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Check if the accumulator is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.redis !== null;
  }

  /**
   * Generate Redis key for a pending notification
   */
  private getPendingKey(tenantId: string, ticketId: string, recipientEmail: string): string {
    const normalizedEmail = recipientEmail.toLowerCase().trim();
    return `${this.prefix}notification:pending:${tenantId}:${ticketId}:${normalizedEmail}`;
  }

  /**
   * Get the flush times sorted set key
   */
  private getFlushTimesKey(): string {
    return `${this.prefix}notification:flush_times`;
  }

  /**
   * Add a ticket update to the accumulator
   */
  async accumulate(params: {
    tenantId: string;
    ticketId: string;
    recipientEmail: string;
    recipientUserId?: string;
    isInternal: boolean;
    userId: string;
    changes: Record<string, { old?: unknown; new?: unknown }>;
  }): Promise<void> {
    if (!this.redis) {
      throw new Error('NotificationAccumulator not initialized');
    }

    const { tenantId, ticketId, recipientEmail, recipientUserId, isInternal, userId, changes } = params;
    const pendingKey = this.getPendingKey(tenantId, ticketId, recipientEmail);
    const flushTimesKey = this.getFlushTimesKey();

    try {
      // Check if there's an existing pending notification
      const existingData = await this.redis.get(pendingKey);

      const newChange: AccumulatedChange = {
        timestamp: new Date().toISOString(),
        userId,
        changes
      };

      let notification: PendingNotification;

      if (existingData) {
        // Append to existing notification
        notification = JSON.parse(existingData);
        notification.accumulatedChanges.push(newChange);

        logger.debug('[NotificationAccumulator] Appending to existing notification', {
          tenantId,
          ticketId,
          recipientEmail,
          totalChanges: notification.accumulatedChanges.length
        });
      } else {
        // Create new pending notification
        notification = {
          tenantId,
          ticketId,
          recipientEmail,
          recipientUserId,
          isInternal,
          accumulatedChanges: [newChange],
          createdAt: new Date().toISOString()
        };

        logger.debug('[NotificationAccumulator] Creating new pending notification', {
          tenantId,
          ticketId,
          recipientEmail
        });
      }

      // Store the updated notification
      await this.redis.set(pendingKey, JSON.stringify(notification));

      // Update flush time (sliding window - each new change resets the timer)
      const flushTime = Date.now() + this.config.accumulationWindowMs;
      await this.redis.zAdd(flushTimesKey, { score: flushTime, value: pendingKey });

      logger.debug('[NotificationAccumulator] Accumulated change', {
        tenantId,
        ticketId,
        recipientEmail,
        flushAt: new Date(flushTime).toISOString(),
        changeCount: notification.accumulatedChanges.length
      });

    } catch (error) {
      logger.error('[NotificationAccumulator] Failed to accumulate notification:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId,
        ticketId,
        recipientEmail
      });
      throw error;
    }
  }

  /**
   * Start the flush loop that periodically checks for ready notifications
   */
  private startFlushLoop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    this.flushInterval = setInterval(async () => {
      try {
        await this.flushReady();
      } catch (error) {
        logger.error('[NotificationAccumulator] Error in flush loop:', error);
      }
    }, this.config.flushIntervalMs);

    logger.info('[NotificationAccumulator] Flush loop started', {
      intervalMs: this.config.flushIntervalMs
    });
  }

  /**
   * Flush all notifications that are ready (past their accumulation window)
   * Uses atomic operations to prevent duplicate sends in multi-instance deployments
   */
  async flushReady(): Promise<number> {
    if (!this.redis || !this.flushCallback) {
      return 0;
    }

    const flushTimesKey = this.getFlushTimesKey();
    const now = Date.now();
    let flushedCount = 0;

    try {
      // Process items one at a time using atomic operations
      // This prevents race conditions when multiple instances are running
      while (true) {
        // Atomically pop the lowest-scored item if its score is <= now
        // This ensures only one instance can claim each notification
        const result = await this.redis.zRangeByScoreWithScores(flushTimesKey, 0, now, { LIMIT: { offset: 0, count: 1 } });

        if (result.length === 0) {
          break; // No more ready items
        }

        const { value: pendingKey, score } = result[0];

        // Try to atomically remove this specific item
        // If another instance already removed it, this returns 0
        const removed = await this.redis.zRem(flushTimesKey, pendingKey);

        if (removed === 0) {
          // Another instance already claimed this item, skip it
          continue;
        }

        try {
          // We successfully claimed this item, now process it
          const data = await this.redis.get(pendingKey);

          if (!data) {
            // Data was already cleaned up, nothing to do
            logger.debug('[NotificationAccumulator] Notification data already cleaned up', { pendingKey });
            continue;
          }

          const notification: PendingNotification = JSON.parse(data);

          // Call the flush callback to send the accumulated notification
          await this.flushCallback(notification);

          // Clean up the notification data
          await this.redis.del(pendingKey);

          flushedCount++;

          logger.info('[NotificationAccumulator] Flushed notification', {
            tenantId: notification.tenantId,
            ticketId: notification.ticketId,
            recipientEmail: notification.recipientEmail,
            changeCount: notification.accumulatedChanges.length
          });

        } catch (error) {
          logger.error('[NotificationAccumulator] Failed to flush notification:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            pendingKey
          });
          // The item is already removed from the sorted set, so it won't be retried
          // In a more robust implementation, you might want to add it to a dead letter queue
        }
      }

      if (flushedCount > 0) {
        logger.info('[NotificationAccumulator] Flush cycle complete', { flushedCount });
      }

      return flushedCount;

    } catch (error) {
      logger.error('[NotificationAccumulator] Error flushing notifications:', error);
      return 0;
    }
  }

  /**
   * Force flush all pending notifications immediately (useful for shutdown)
   * Uses atomic operations to prevent duplicate sends in multi-instance deployments
   */
  async flushAll(): Promise<number> {
    if (!this.redis || !this.flushCallback) {
      return 0;
    }

    const flushTimesKey = this.getFlushTimesKey();
    let flushedCount = 0;

    try {
      logger.info('[NotificationAccumulator] Force flushing all pending notifications');

      // Process items one at a time using atomic claim pattern
      while (true) {
        // Get the first item (lowest score)
        const result = await this.redis.zRangeWithScores(flushTimesKey, 0, 0);

        if (result.length === 0) {
          break; // No more items
        }

        const { value: pendingKey } = result[0];

        // Try to atomically claim this item
        const removed = await this.redis.zRem(flushTimesKey, pendingKey);

        if (removed === 0) {
          // Another instance already claimed this item
          continue;
        }

        try {
          const data = await this.redis.get(pendingKey);

          if (!data) {
            continue;
          }

          const notification: PendingNotification = JSON.parse(data);
          await this.flushCallback(notification);

          await this.redis.del(pendingKey);
          flushedCount++;

        } catch (error) {
          logger.error('[NotificationAccumulator] Failed to force flush notification:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            pendingKey
          });
        }
      }

      logger.info('[NotificationAccumulator] Force flush complete', { flushedCount });
      return flushedCount;

    } catch (error) {
      logger.error('[NotificationAccumulator] Error force flushing notifications:', error);
      return 0;
    }
  }

  /**
   * Stop the flush loop and clean up
   */
  async shutdown(): Promise<void> {
    logger.info('[NotificationAccumulator] Shutting down...');

    // Stop the flush loop
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Flush any remaining notifications
    const flushed = await this.flushAll();
    logger.info('[NotificationAccumulator] Flushed remaining notifications on shutdown', {
      count: flushed
    });

    // Close Redis connection
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }

    this.isInitialized = false;
    NotificationAccumulator.instance = null;

    logger.info('[NotificationAccumulator] Shutdown complete');
  }

  /**
   * Get statistics about pending notifications (for monitoring)
   */
  async getStats(): Promise<{ pendingCount: number; oldestPendingAge?: number }> {
    if (!this.redis) {
      return { pendingCount: 0 };
    }

    const flushTimesKey = this.getFlushTimesKey();

    try {
      const count = await this.redis.zCard(flushTimesKey);

      if (count === 0) {
        return { pendingCount: 0 };
      }

      // Get the oldest entry (lowest score = earliest flush time)
      const oldest = await this.redis.zRange(flushTimesKey, 0, 0);

      if (oldest.length > 0) {
        const score = await this.redis.zScore(flushTimesKey, oldest[0]);
        if (score !== null) {
          // Score is the flush time, created time is score - accumulationWindowMs
          const createdAt = score - this.config.accumulationWindowMs;
          const ageMs = Date.now() - createdAt;
          return { pendingCount: count, oldestPendingAge: ageMs };
        }
      }

      return { pendingCount: count };

    } catch (error) {
      logger.error('[NotificationAccumulator] Error getting stats:', error);
      return { pendingCount: 0 };
    }
  }
}
