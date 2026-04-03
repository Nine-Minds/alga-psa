import logger from '@alga-psa/core/logger';
import { EmailProviderError } from '@alga-psa/types';
import type { RedisClientGetter, RedisClientLike } from '@alga-psa/email';
import { sendEventEmail, type SendEmailParams } from './sendEventEmail';

interface EventEmailRetryEntry {
  id: string;
  params: SendEmailParams;
  retryCount: number;
  queuedAt: number;
  originalQueuedAt: number;
}

interface EnqueueOptions {
  retryCount?: number;
  retryAfterMs?: number;
}

interface EventEmailRetryQueueConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  checkIntervalMs: number;
  batchSize: number;
  entryTtlSeconds: number;
}

const DEFAULT_CONFIG: EventEmailRetryQueueConfig = {
  maxRetries: 5,
  baseDelayMs: 30_000,
  maxDelayMs: 15 * 60_000,
  checkIntervalMs: 10_000,
  batchSize: 50,
  entryTtlSeconds: 24 * 60 * 60,
};

export class EventEmailRetryQueue {
  private static instance: EventEmailRetryQueue | null = null;

  private redis: RedisClientLike | null = null;
  private redisGetter: RedisClientGetter | null = null;
  private processingInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private isProcessing = false;
  private readonly config: EventEmailRetryQueueConfig;
  private readonly prefix = 'alga-psa:event-email-retry:';

  private constructor(config: Partial<EventEmailRetryQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static getInstance(config?: Partial<EventEmailRetryQueueConfig>): EventEmailRetryQueue {
    if (!EventEmailRetryQueue.instance) {
      EventEmailRetryQueue.instance = new EventEmailRetryQueue(config);
    }
    return EventEmailRetryQueue.instance;
  }

  isReady(): boolean {
    return this.isInitialized && this.redis !== null;
  }

  async initialize(redisGetter: RedisClientGetter): Promise<void> {
    if (this.isInitialized) {
      logger.warn('[EventEmailRetryQueue] Already initialized');
      return;
    }

    this.redisGetter = redisGetter;
    this.redis = await redisGetter();
    this.startProcessingLoop();
    this.isInitialized = true;

    logger.info('[EventEmailRetryQueue] Initialized successfully', {
      maxRetries: this.config.maxRetries,
      baseDelayMs: this.config.baseDelayMs,
      maxDelayMs: this.config.maxDelayMs,
      checkIntervalMs: this.config.checkIntervalMs,
    });
  }

  async enqueue(params: SendEmailParams, options: EnqueueOptions = {}): Promise<void> {
    if (!this.redis) {
      throw new Error('Event email retry queue is not initialized');
    }

    const retryCount = options.retryCount ?? 0;
    const delayMs = this.resolveDelay(retryCount, options.retryAfterMs);
    const now = Date.now();
    const entry: EventEmailRetryEntry = {
      id: this.generateId(),
      params,
      retryCount,
      queuedAt: now,
      originalQueuedAt: params.headers?.['x-alga-original-queued-at']
        ? Number(params.headers['x-alga-original-queued-at'])
        : now,
    };

    await this.redis.set(this.getDataKey(entry.id), JSON.stringify(entry), {
      EX: this.config.entryTtlSeconds,
    });
    await this.redis.zAdd(this.getQueueKey(), { score: now + delayMs, value: entry.id });

    logger.info('[EventEmailRetryQueue] Queued retryable event email', {
      id: entry.id,
      tenantId: params.tenantId,
      to: params.to,
      template: params.template,
      retryCount,
      delayMs,
      readyAt: new Date(now + delayMs).toISOString(),
    });
  }

  async shutdown(): Promise<void> {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    this.isInitialized = false;
    this.redis = null;
    this.redisGetter = null;
    this.isProcessing = false;
  }

  private startProcessingLoop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    this.processingInterval = setInterval(async () => {
      if (this.isProcessing) {
        return;
      }

      this.isProcessing = true;
      try {
        await this.processReady();
      } catch (error) {
        logger.error('[EventEmailRetryQueue] Error processing retry queue', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        this.isProcessing = false;
      }
    }, this.config.checkIntervalMs);
  }

  private async processReady(): Promise<void> {
    if (!this.redis) {
      return;
    }

    const ids = await this.redis.zRangeByScore(this.getQueueKey(), 0, Date.now(), {
      LIMIT: { offset: 0, count: this.config.batchSize },
    });

    for (const id of ids) {
      const claimed = await this.redis.zRem(this.getQueueKey(), id);
      if (claimed === 0) {
        continue;
      }

      const dataKey = this.getDataKey(id);
      const raw = await this.redis.get(dataKey);
      if (!raw) {
        continue;
      }

      await this.redis.del(dataKey);

      let entry: EventEmailRetryEntry;
      try {
        entry = JSON.parse(raw) as EventEmailRetryEntry;
      } catch (error) {
        logger.warn('[EventEmailRetryQueue] Skipping malformed retry entry', {
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        continue;
      }

      try {
        await sendEventEmail(entry.params);
        logger.info('[EventEmailRetryQueue] Retried event email successfully', {
          id: entry.id,
          tenantId: entry.params.tenantId,
          to: entry.params.to,
          template: entry.params.template,
          retryCount: entry.retryCount,
        });
      } catch (error) {
        if (error instanceof EmailProviderError && error.isRetryable) {
          const nextRetryCount = entry.retryCount + 1;
          if (nextRetryCount < this.config.maxRetries) {
            await this.enqueue(entry.params, {
              retryCount: nextRetryCount,
              retryAfterMs: this.extractRetryAfterMs(error),
            });

            logger.warn('[EventEmailRetryQueue] Retryable event email failure requeued', {
              id: entry.id,
              tenantId: entry.params.tenantId,
              to: entry.params.to,
              template: entry.params.template,
              retryCount: nextRetryCount,
              error: error.message,
            });
            continue;
          }
        }

        logger.error('[EventEmailRetryQueue] Event email retry exhausted or became non-retryable', {
          id: entry.id,
          tenantId: entry.params.tenantId,
          to: entry.params.to,
          template: entry.params.template,
          retryCount: entry.retryCount,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private resolveDelay(retryCount: number, retryAfterMs?: number): number {
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return Math.min(retryAfterMs, this.config.maxDelayMs);
    }

    const delay = Math.min(
      this.config.baseDelayMs * Math.pow(2, retryCount),
      this.config.maxDelayMs
    );
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  }

  private extractRetryAfterMs(error: EmailProviderError): number | undefined {
    const retryAfterMs = error.metadata?.retryAfterMs;
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return retryAfterMs;
    }
    return undefined;
  }

  private getQueueKey(): string {
    return `${this.prefix}queue`;
  }

  private getDataKey(id: string): string {
    return `${this.prefix}data:${id}`;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
