import logger from '@alga-psa/core/logger';
import type { RedisClientGetter, RedisClientLike } from '@alga-psa/email';
import type { TicketWebhookPublicEvent } from '../eventBus/subscribers/webhook/webhookEventMap';
import type { TicketWebhookPayload } from '../eventBus/subscribers/webhook/webhookTicketPayload';

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

export class WebhookDeliveryQueue {
  private static instance: WebhookDeliveryQueue | null = null;

  private redis: RedisClientLike | null = null;
  private redisGetter: RedisClientGetter | null = null;
  private isInitialized = false;
  private readonly prefix = 'alga-psa:webhook-out:';

  static getInstance(): WebhookDeliveryQueue {
    if (!WebhookDeliveryQueue.instance) {
      WebhookDeliveryQueue.instance = new WebhookDeliveryQueue();
    }

    return WebhookDeliveryQueue.instance;
  }

  async initialize(redisGetter: RedisClientGetter): Promise<void> {
    if (this.isInitialized) {
      logger.warn('[WebhookDeliveryQueue] Already initialized');
      return;
    }

    this.redisGetter = redisGetter;
    this.redis = await redisGetter();
    this.isInitialized = true;

    logger.info('[WebhookDeliveryQueue] Initialized queue storage');
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
      EX: 24 * 60 * 60,
    });
    await redis.zAdd(this.getQueueKey(), {
      score: job.deliverAt,
      value: this.getMemberValue(job.eventId, job.webhookId, job.attempt),
    });

    logger.info('[WebhookDeliveryQueue] Enqueued webhook delivery job', {
      webhookId: job.webhookId,
      eventId: job.eventId,
      eventType: job.eventType,
      tenantId: job.tenantId,
      attempt: job.attempt,
      deliverAt: new Date(job.deliverAt).toISOString(),
    });
  }

  async shutdown(): Promise<void> {
    this.redis = null;
    this.redisGetter = null;
    this.isInitialized = false;
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

  private getQueueKey(): string {
    return `${this.prefix}queue`;
  }

  private getDataKey(eventId: string, webhookId: string, attempt: number): string {
    return `${this.prefix}data:${this.getMemberValue(eventId, webhookId, attempt)}`;
  }

  private getMemberValue(eventId: string, webhookId: string, attempt: number): string {
    return `${eventId}:${webhookId}:${attempt}`;
  }
}
