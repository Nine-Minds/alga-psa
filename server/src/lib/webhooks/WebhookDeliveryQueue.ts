import logger from '@alga-psa/core/logger';
import type { RedisClientGetter, RedisClientLike } from '@alga-psa/email';
import type { TicketWebhookPublicEvent } from '../eventBus/subscribers/webhook/webhookEventMap';
import type { TicketWebhookPayload } from '../eventBus/subscribers/webhook/webhookTicketPayload';
import { computeBackoff } from './backoff';
import { emitWebhookMetric } from './metrics';

export type WebhookDeliveryJob = {
  webhookId: string;
  eventId: string;
  eventType: TicketWebhookPublicEvent;
  occurredAt: string;
  tenantId: string;
  payload: TicketWebhookPayload;
  attempt: number;
  deliverAt: number;
};

type StoredWebhookDeliveryJob = WebhookDeliveryJob & {
  queuedAt: number;
};

type WebhookDeliveryQueueConfig = {
  checkIntervalMs: number;
  batchSize: number;
  maxConcurrentDeliveries: number;
  entryTtlSeconds: number;
  maxAttempts: number;
  shutdownDrainMs: number;
};

const DEFAULT_CONFIG: WebhookDeliveryQueueConfig = {
  checkIntervalMs: 2_000,
  batchSize: 100,
  maxConcurrentDeliveries: 50,
  entryTtlSeconds: 24 * 60 * 60,
  maxAttempts: 5,
  shutdownDrainMs: 30_000,
};

export type WebhookDeliveryProcessResult =
  | { outcome: 'delivered' }
  | { outcome: 'retry'; retryDelayMs?: number; errorMessage?: string | null }
  | { outcome: 'abandoned'; errorMessage?: string | null };

export type WebhookDeliveryProcessor = (
  job: WebhookDeliveryJob,
) => Promise<WebhookDeliveryProcessResult>;

export class WebhookDeliveryQueue {
  private static instance: WebhookDeliveryQueue | null = null;

  private redis: RedisClientLike | null = null;
  private redisGetter: RedisClientGetter | null = null;
  private processingInterval: NodeJS.Timeout | null = null;
  private processor: WebhookDeliveryProcessor | null = null;
  private isInitialized = false;
  private isProcessing = false;
  private isShuttingDown = false;
  private readonly config: WebhookDeliveryQueueConfig;
  private readonly prefix = 'alga-psa:webhook-out:';
  private readonly inFlightJobs = new Set<Promise<void>>();
  private readonly sigtermHandler = () => {
    void this.shutdown();
  };

  private constructor(config: Partial<WebhookDeliveryQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static getInstance(config?: Partial<WebhookDeliveryQueueConfig>): WebhookDeliveryQueue {
    if (!WebhookDeliveryQueue.instance) {
      WebhookDeliveryQueue.instance = new WebhookDeliveryQueue(config);
    }

    return WebhookDeliveryQueue.instance;
  }

  async initialize(redisGetter: RedisClientGetter, processor: WebhookDeliveryProcessor): Promise<void> {
    if (this.isInitialized) {
      logger.warn('[WebhookDeliveryQueue] Already initialized');
      return;
    }

    this.redisGetter = redisGetter;
    this.redis = await redisGetter();
    this.processor = processor;
    this.startProcessingLoop();
    process.on('SIGTERM', this.sigtermHandler);
    this.isInitialized = true;
    this.isShuttingDown = false;

    logger.info('[WebhookDeliveryQueue] Initialized queue processing', {
      checkIntervalMs: this.config.checkIntervalMs,
      batchSize: this.config.batchSize,
      maxConcurrentDeliveries: this.config.maxConcurrentDeliveries,
      maxAttempts: this.config.maxAttempts,
    });
  }

  isReady(): boolean {
    return this.isInitialized && this.redis !== null;
  }

  async enqueue(job: WebhookDeliveryJob): Promise<void> {
    const redis = await this.requireRedis();
    const queuedAt = Date.now();
    const storedJob: StoredWebhookDeliveryJob = {
      ...job,
      queuedAt,
    };

    await redis.set(this.getDataKey(job.eventId, job.webhookId, job.attempt), JSON.stringify(storedJob), {
      EX: this.config.entryTtlSeconds,
    });
    await redis.zAdd(this.getQueueKey(), {
      score: job.deliverAt,
      value: this.getMemberValue(job.eventId, job.webhookId, job.attempt),
    });
    const queueDepth = await redis.zCard(this.getQueueKey());

    logger.info('[WebhookDeliveryQueue] Enqueued webhook delivery job', {
      webhookId: job.webhookId,
      eventId: job.eventId,
      eventType: job.eventType,
      tenantId: job.tenantId,
      attempt: job.attempt,
      deliverAt: new Date(job.deliverAt).toISOString(),
    });
    emitWebhookMetric('webhook_queue_depth', {
      queue_depth: queueDepth,
    });
  }

  async shutdown(): Promise<void> {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    process.off('SIGTERM', this.sigtermHandler);
    this.isShuttingDown = true;

    if (this.inFlightJobs.size > 0) {
      await Promise.race([
        Promise.allSettled([...this.inFlightJobs]),
        new Promise((resolve) => setTimeout(resolve, this.config.shutdownDrainMs)),
      ]);
    }

    this.redis = null;
    this.redisGetter = null;
    this.processor = null;
    this.isInitialized = false;
    this.isProcessing = false;
    this.inFlightJobs.clear();
    this.isShuttingDown = false;
  }

  async process(): Promise<void> {
    if (this.isProcessing || this.isShuttingDown || !this.processor) {
      return;
    }

    this.isProcessing = true;
    try {
      await this.processReady();
    } finally {
      this.isProcessing = false;
    }
  }

  private async requireRedis(): Promise<RedisClientLike> {
    if (this.redis) {
      return this.redis;
    }

    if (!this.redisGetter) {
      throw new Error('Webhook delivery queue is not initialized');
    }

    this.redis = await this.redisGetter();
    return this.redis;
  }

  private startProcessingLoop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    this.processingInterval = setInterval(() => {
      void this.process().catch((error) => {
        logger.error('[WebhookDeliveryQueue] Error processing queue', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }, this.config.checkIntervalMs);
  }

  private async processReady(): Promise<void> {
    const redis = await this.requireRedis();
    const processor = this.processor;

    if (!processor) {
      return;
    }

    const availableSlots = this.config.maxConcurrentDeliveries - this.inFlightJobs.size;
    if (availableSlots <= 0) {
      return;
    }

    const readyMembers = await redis.zRangeByScore(this.getQueueKey(), 0, Date.now(), {
      LIMIT: {
        offset: 0,
        count: Math.min(this.config.batchSize, availableSlots),
      },
    });

    for (const member of readyMembers) {
      const claimed = await redis.zRem(this.getQueueKey(), member);
      if (claimed === 0) {
        continue;
      }

      const raw = await redis.get(this.getDataKeyForMember(member));
      if (!raw) {
        continue;
      }

      await redis.del(this.getDataKeyForMember(member));

      let job: StoredWebhookDeliveryJob;
      try {
        job = JSON.parse(raw) as StoredWebhookDeliveryJob;
      } catch (error) {
        logger.warn('[WebhookDeliveryQueue] Skipping malformed queued job', {
          member,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        continue;
      }

      const execution = this.processClaimedJob(job, processor).finally(() => {
        this.inFlightJobs.delete(execution);
      });
      this.inFlightJobs.add(execution);
    }

    if (readyMembers.length > 0) {
      const queueDepth = await redis.zCard(this.getQueueKey());
      emitWebhookMetric('webhook_queue_depth', {
        queue_depth: queueDepth,
      });
    }
  }

  private async processClaimedJob(
    job: StoredWebhookDeliveryJob,
    processor: WebhookDeliveryProcessor
  ): Promise<void> {
    const result = await processor(job);

    if (result.outcome === 'delivered') {
      logger.info('[WebhookDeliveryQueue] Delivered queued webhook job', {
        webhookId: job.webhookId,
        eventId: job.eventId,
        tenantId: job.tenantId,
        attempt: job.attempt,
      });
      return;
    }

    if (result.outcome === 'retry') {
      const nextAttempt = job.attempt + 1;
      if (nextAttempt <= this.config.maxAttempts) {
        const retryDelayMs = result.retryDelayMs ?? computeBackoff(job.attempt);
        await this.enqueue({
          ...job,
          attempt: nextAttempt,
          deliverAt: Date.now() + retryDelayMs,
        });

        logger.warn('[WebhookDeliveryQueue] Requeued failed webhook job', {
          webhookId: job.webhookId,
          eventId: job.eventId,
          tenantId: job.tenantId,
          attempt: nextAttempt,
          retryDelayMs,
          error: result.errorMessage ?? 'Unknown error',
        });
        return;
      }

      logger.error('[WebhookDeliveryQueue] Webhook job exhausted retries', {
        webhookId: job.webhookId,
        eventId: job.eventId,
        tenantId: job.tenantId,
        attempt: job.attempt,
        error: result.errorMessage ?? 'Unknown error',
      });
      return;
    }

    logger.error('[WebhookDeliveryQueue] Webhook job abandoned', {
      webhookId: job.webhookId,
      eventId: job.eventId,
      tenantId: job.tenantId,
      attempt: job.attempt,
      error: result.errorMessage ?? 'Unknown error',
    });
  }

  private getQueueKey(): string {
    return `${this.prefix}queue`;
  }

  private getDataKey(eventId: string, webhookId: string, attempt: number): string {
    return `${this.prefix}data:${this.getMemberValue(eventId, webhookId, attempt)}`;
  }

  private getDataKeyForMember(member: string): string {
    return `${this.prefix}data:${member}`;
  }

  private getMemberValue(eventId: string, webhookId: string, attempt: number): string {
    return `${eventId}:${webhookId}:${attempt}`;
  }
}
