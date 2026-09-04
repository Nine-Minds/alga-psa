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
  private readonly prefix = `${process.env.REDIS_EVENT_STREAM_PREFIX || 'alga-psa:'}event-email-retry:`;

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

    await this.recoverInterruptedProcessing();
    const ids = await this.redis.zRangeByScore(this.getQueueKey(), 0, Date.now(), {
      LIMIT: { offset: 0, count: this.config.batchSize },
    });

    for (const id of ids) {
      const claimed = await this.claimForProcessing(id);
      if (claimed === 0) {
        continue;
      }

      const dataKey = this.getDataKey(id);
      const raw = await this.redis.get(dataKey);
      if (!raw) {
        await this.redis.set(`${this.prefix}reconciliation:${id}`, JSON.stringify({ id, failedAt: Date.now(), error: 'Retry payload expired or missing' }));
        await this.completeProcessing(id);
        continue;
      }

      let entry: EventEmailRetryEntry;
      try {
        entry = JSON.parse(raw) as EventEmailRetryEntry;
      } catch (error) {
        logger.warn('[EventEmailRetryQueue] Skipping malformed retry entry', {
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        await this.redis.set(`${this.prefix}reconciliation:${id}`, JSON.stringify({ id, raw, failedAt: Date.now(), error: 'Malformed retry payload' }));
        await this.completeProcessing(id);
        continue;
      }

      try {
        await sendEventEmail(entry.params);
        await this.completeProcessing(id);
        logger.info('[EventEmailRetryQueue] Retried event email successfully', {
          id: entry.id,
          tenantId: entry.params.tenantId,
          to: entry.params.to,
          template: entry.params.template,
          retryCount: entry.retryCount,
        });
      } catch (error) {
        if (error && typeof error === 'object' && (error as EmailProviderError).name === 'EmailProviderError' && (error as EmailProviderError).isRetryable) {
          const nextRetryCount = entry.retryCount + 1;
          if (nextRetryCount < this.config.maxRetries) {
            await this.enqueue(entry.params, {
              retryCount: nextRetryCount,
              retryAfterMs: this.extractRetryAfterMs(error as EmailProviderError),
            });

            await this.completeProcessing(id);
            logger.warn('[EventEmailRetryQueue] Retryable event email failure requeued', {
              id: entry.id,
              tenantId: entry.params.tenantId,
              to: entry.params.to,
              template: entry.params.template,
              retryCount: nextRetryCount,
              error: (error as Error).message,
            });
            continue;
          }
        }

        await this.redis.set(`${this.prefix}reconciliation:${entry.id}`, JSON.stringify({ ...entry, failedAt: Date.now(), error: error instanceof Error ? error.message : String(error) }));
        await this.completeProcessing(id);
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

  /** Atomic move retains the payload until completion; expired processing leases are recovered. */
  private async claimForProcessing(id: string): Promise<number> {
    const redis = this.redis as RedisClientLike & { eval(script: string, args: { keys: string[]; arguments: string[] }): Promise<number> };
    return redis.eval(`if redis.call('ZREM', KEYS[1], ARGV[1]) == 1 then
      redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1]); return 1 end; return 0`,
      { keys: [this.getQueueKey(), `${this.prefix}processing`], arguments: [id, String(Date.now() + 10 * 60_000)] });
  }

  private async recoverInterruptedProcessing(): Promise<void> {
    const redis = this.redis as RedisClientLike & { eval(script: string, args: { keys: string[]; arguments: string[] }): Promise<number> };
    await redis.eval(`local ids = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, 100)
      for _, id in ipairs(ids) do redis.call('ZREM', KEYS[1], id); redis.call('ZADD', KEYS[2], ARGV[1], id) end
      return #ids`, { keys: [`${this.prefix}processing`, this.getQueueKey()], arguments: [String(Date.now())] });
  }

  private async completeProcessing(id: string): Promise<void> {
    await this.redis!.del(this.getDataKey(id));
    await this.redis!.zRem(`${this.prefix}processing`, id);
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
