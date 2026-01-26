import logger from '@alga-psa/core/logger';
import { BaseEmailParams } from './BaseEmailService';

/**
 * Delayed email entry stored in Redis
 */
export interface DelayedEmailEntry {
  id: string;
  params: BaseEmailParams;
  tenantId: string;
  retryCount: number;
  originalTimestamp: number;
  queuedAt: number;
}

/**
 * Configuration for the delayed email queue
 */
export interface DelayedEmailQueueConfig {
  /** Maximum number of retry attempts before giving up (default: 5) */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff (default: 60000 = 1 minute) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 900000 = 15 minutes) */
  maxDelayMs: number;
  /** Interval in milliseconds between processing checks (default: 10000 = 10 seconds) */
  checkIntervalMs: number;
  /** Maximum number of items to process per cycle (default: 100) */
  batchSize: number;
}

const DEFAULT_CONFIG: DelayedEmailQueueConfig = {
  maxRetries: 5,
  baseDelayMs: 60_000,        // 1 minute
  maxDelayMs: 15 * 60_000,    // 15 minutes
  checkIntervalMs: 10_000,    // 10 seconds
  batchSize: 100,
};

/**
 * Type for Redis client - minimal interface needed
 */
export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  zAdd(key: string, item: { score: number; value: string }): Promise<number>;
  zRem(key: string, member: string): Promise<number>;
  zRangeByScore(key: string, min: number, max: number, options?: { LIMIT?: { offset: number; count: number } }): Promise<string[]>;
  zCard(key: string): Promise<number>;
}

/**
 * Function type for getting the Redis client
 */
export type RedisClientGetter = () => Promise<RedisClientLike>;

/**
 * Function type for sending an email (used in retry callback)
 */
export type EmailSendCallback = (tenantId: string, params: BaseEmailParams) => Promise<void>;

/**
 * DelayedEmailQueue - Redis-based delayed email queue for rate-limited emails
 *
 * This service manages emails that were rate-limited and need to be retried later.
 * It uses Redis sorted sets for efficient scheduling and implements:
 * - Exponential backoff with jitter
 * - Maximum retry attempts
 * - Fair processing across tenants (round-robin)
 * - Atomic operations for multi-instance safety
 *
 * Redis storage structure:
 * - Sorted Set: `{prefix}queue` - score = ready timestamp, value = entry ID
 * - String: `{prefix}data:{id}` - JSON serialized DelayedEmailEntry
 */
export class DelayedEmailQueue {
  private static instance: DelayedEmailQueue | null = null;
  private redis: RedisClientLike | null = null;
  private config: DelayedEmailQueueConfig;
  private processingInterval: NodeJS.Timeout | null = null;
  private sendCallback: EmailSendCallback | null = null;
  private isProcessing = false;
  private isInitialized = false;

  /** Key prefix for all queue-related Redis keys */
  private readonly prefix = 'alga-psa:email-ratelimit:';

  private constructor(config: Partial<DelayedEmailQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get singleton instance of the delayed email queue
   */
  static getInstance(config?: Partial<DelayedEmailQueueConfig>): DelayedEmailQueue {
    if (!DelayedEmailQueue.instance) {
      DelayedEmailQueue.instance = new DelayedEmailQueue(config);
    }
    return DelayedEmailQueue.instance;
  }

  /**
   * Get the maximum number of retries (exposed for use by TenantEmailService)
   */
  static get MAX_RETRIES(): number {
    return DEFAULT_CONFIG.maxRetries;
  }

  /**
   * Calculate delay for a given retry count (exposed for logging purposes)
   */
  static calculateDelay(retryCount: number): number {
    const config = DEFAULT_CONFIG;
    // Exponential backoff: 1min, 2min, 4min, 8min, 15min (capped)
    const delay = Math.min(
      config.baseDelayMs * Math.pow(2, retryCount),
      config.maxDelayMs
    );
    // Add jitter (±10%) to prevent thundering herd
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  }

  /**
   * Initialize the queue with a Redis client getter and send callback
   *
   * @param redisGetter - Function that returns a Redis client
   * @param sendCallback - Function to call when retrying an email
   */
  async initialize(redisGetter: RedisClientGetter, sendCallback: EmailSendCallback): Promise<void> {
    if (this.isInitialized) {
      logger.warn('[DelayedEmailQueue] Already initialized');
      return;
    }

    try {
      this.redis = await redisGetter();
      this.sendCallback = sendCallback;
      this.startProcessingLoop();
      this.isInitialized = true;

      logger.info('[DelayedEmailQueue] Initialized successfully', {
        maxRetries: this.config.maxRetries,
        baseDelayMs: this.config.baseDelayMs,
        maxDelayMs: this.config.maxDelayMs,
        checkIntervalMs: this.config.checkIntervalMs
      });
    } catch (error) {
      logger.error('[DelayedEmailQueue] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Check if the queue is initialized and ready
   */
  isReady(): boolean {
    return this.isInitialized && this.redis !== null;
  }

  /**
   * Get the queue sorted set key
   */
  private getQueueKey(): string {
    return `${this.prefix}queue`;
  }

  /**
   * Get the data key for a specific entry
   */
  private getDataKey(id: string): string {
    return `${this.prefix}data:${id}`;
  }

  /**
   * Generate a unique ID for a queue entry
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Calculate delay using exponential backoff with jitter
   */
  private calculateDelayInternal(retryCount: number): number {
    // Exponential backoff: 1min, 2min, 4min, 8min, 15min (capped)
    const delay = Math.min(
      this.config.baseDelayMs * Math.pow(2, retryCount),
      this.config.maxDelayMs
    );
    // Add jitter (±10%) to prevent thundering herd
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  }

  /**
   * Enqueue an email for delayed retry
   *
   * @param tenantId - The tenant ID for the email
   * @param params - The email parameters
   * @param retryCount - Current retry count (0 for first queue)
   */
  async enqueue(tenantId: string, params: BaseEmailParams, retryCount: number = 0): Promise<void> {
    if (!this.redis) {
      logger.warn('[DelayedEmailQueue] Queue not initialized, dropping email', {
        tenantId,
        to: params.to
      });
      return;
    }

    const id = this.generateId();
    const now = Date.now();
    const delay = this.calculateDelayInternal(retryCount);
    const readyAt = now + delay;

    const entry: DelayedEmailEntry = {
      id,
      params,
      tenantId,
      retryCount,
      originalTimestamp: params._originalTimestamp ?? now,
      queuedAt: now
    };

    try {
      // Store the email data with 1 hour TTL (safety net for orphaned entries)
      await this.redis.set(this.getDataKey(id), JSON.stringify(entry), { EX: 3600 });

      // Add to sorted set with ready timestamp as score
      await this.redis.zAdd(this.getQueueKey(), { score: readyAt, value: id });

      logger.info('[DelayedEmailQueue] Email enqueued for retry', {
        id,
        tenantId,
        to: params.to,
        retryCount,
        readyAt: new Date(readyAt).toISOString(),
        delayMs: delay
      });
    } catch (error) {
      logger.error('[DelayedEmailQueue] Failed to enqueue email:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId,
        to: params.to
      });
      throw error;
    }
  }

  /**
   * Start the processing loop
   */
  private startProcessingLoop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    this.processingInterval = setInterval(async () => {
      if (this.isProcessing) {
        logger.debug('[DelayedEmailQueue] Previous processing cycle still running, skipping');
        return;
      }

      try {
        this.isProcessing = true;
        await this.processReady();
      } catch (error) {
        logger.error('[DelayedEmailQueue] Error in processing loop:', error);
      } finally {
        this.isProcessing = false;
      }
    }, this.config.checkIntervalMs);

    logger.info('[DelayedEmailQueue] Processing loop started', {
      intervalMs: this.config.checkIntervalMs
    });
  }

  /**
   * Process all ready emails with fair processing across tenants
   *
   * Uses atomic operations to prevent duplicate processing across instances
   */
  async processReady(): Promise<number> {
    if (!this.redis || !this.sendCallback) {
      return 0;
    }

    const queueKey = this.getQueueKey();
    const now = Date.now();
    let processedCount = 0;

    try {
      // Get all ready items (score <= now)
      const readyIds = await this.redis.zRangeByScore(queueKey, 0, now, {
        LIMIT: { offset: 0, count: this.config.batchSize }
      });

      if (readyIds.length === 0) {
        return 0;
      }

      logger.debug('[DelayedEmailQueue] Found ready emails', { count: readyIds.length });

      // Fetch all entries and group by tenant for fair processing
      const byTenant = new Map<string, DelayedEmailEntry[]>();

      for (const id of readyIds) {
        const data = await this.redis.get(this.getDataKey(id));
        if (data) {
          try {
            const entry = JSON.parse(data) as DelayedEmailEntry;
            if (!byTenant.has(entry.tenantId)) {
              byTenant.set(entry.tenantId, []);
            }
            byTenant.get(entry.tenantId)!.push(entry);
          } catch (parseError) {
            logger.error('[DelayedEmailQueue] Failed to parse entry:', { id, error: parseError });
          }
        }
      }

      // Process one email per tenant (round-robin style)
      // This ensures no single tenant can starve others
      for (const [tenantId, entries] of byTenant) {
        const entry = entries[0]; // Take first entry for this tenant

        // Atomic claim: try to remove from sorted set
        const removed = await this.redis.zRem(queueKey, entry.id);
        if (removed === 0) {
          // Another instance already claimed this item
          logger.debug('[DelayedEmailQueue] Entry already claimed by another instance', {
            id: entry.id,
            tenantId
          });
          continue;
        }

        try {
          // We successfully claimed this item, now process it
          logger.info('[DelayedEmailQueue] Processing queued email', {
            id: entry.id,
            tenantId,
            to: entry.params.to,
            retryCount: entry.retryCount + 1
          });

          // Update params with retry metadata
          const updatedParams = {
            ...entry.params,
            _retryCount: entry.retryCount + 1,
            _originalTimestamp: entry.originalTimestamp
          };

          // Attempt to send via callback
          await this.sendCallback(tenantId, updatedParams);

          // Clean up the data entry
          await this.redis.del(this.getDataKey(entry.id));
          processedCount++;

        } catch (error) {
          logger.error('[DelayedEmailQueue] Failed to process email:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            id: entry.id,
            tenantId
          });

          // Clean up the data entry even on failure
          // (the sendCallback should handle re-queueing if needed)
          await this.redis.del(this.getDataKey(entry.id));
        }
      }

      if (processedCount > 0) {
        logger.info('[DelayedEmailQueue] Processing cycle complete', { processedCount });
      }

      return processedCount;

    } catch (error) {
      logger.error('[DelayedEmailQueue] Error processing ready emails:', error);
      return 0;
    }
  }

  /**
   * Get statistics about the queue
   */
  async getStats(): Promise<{ pendingCount: number; oldestEntryAge?: number }> {
    if (!this.redis) {
      return { pendingCount: 0 };
    }

    try {
      const queueKey = this.getQueueKey();
      const count = await this.redis.zCard(queueKey);

      // Could extend to get oldest entry if needed
      return { pendingCount: count };

    } catch (error) {
      logger.error('[DelayedEmailQueue] Error getting stats:', error);
      return { pendingCount: 0 };
    }
  }

  /**
   * Shutdown the queue, stopping the processing loop
   */
  async shutdown(): Promise<void> {
    logger.info('[DelayedEmailQueue] Shutting down...');

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    this.isInitialized = false;
    this.redis = null;
    DelayedEmailQueue.instance = null;

    logger.info('[DelayedEmailQueue] Shutdown complete');
  }

  /**
   * Reset the singleton instance (for testing purposes)
   */
  static resetInstance(): void {
    if (DelayedEmailQueue.instance) {
      if (DelayedEmailQueue.instance.processingInterval) {
        clearInterval(DelayedEmailQueue.instance.processingInterval);
      }
      DelayedEmailQueue.instance = null;
    }
  }
}
