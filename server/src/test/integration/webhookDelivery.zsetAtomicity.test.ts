import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RedisClientLike } from '@alga-psa/email';

import {
  WebhookDeliveryQueue,
  type WebhookDeliveryJob,
  type WebhookDeliveryProcessor,
} from '@/lib/webhooks/WebhookDeliveryQueue';

function createMockRedis(): RedisClientLike {
  const kv = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();

  function getZset(key: string) {
    let z = zsets.get(key);
    if (!z) {
      z = new Map();
      zsets.set(key, z);
    }
    return z;
  }

  return {
    async get(key) {
      return kv.get(key) ?? null;
    },
    async set(key, value) {
      kv.set(key, value);
      return 'OK';
    },
    async del(key) {
      const keys = Array.isArray(key) ? key : [key];
      let removed = 0;
      for (const k of keys) {
        if (kv.delete(k)) removed += 1;
      }
      return removed;
    },
    async zAdd(key, item) {
      const z = getZset(key);
      const isNew = !z.has(item.value);
      z.set(item.value, item.score);
      return isNew ? 1 : 0;
    },
    async zRem(key, member) {
      return getZset(key).delete(member) ? 1 : 0;
    },
    async zRangeByScore(key, min, max, options) {
      const z = getZset(key);
      const entries = Array.from(z.entries())
        .filter(([, score]) => score >= min && score <= max)
        .sort(([, a], [, b]) => a - b)
        .map(([member]) => member);
      const offset = options?.LIMIT?.offset ?? 0;
      const count = options?.LIMIT?.count ?? entries.length;
      return entries.slice(offset, offset + count);
    },
    async zCard(key) {
      return getZset(key).size;
    },
  };
}

describe('webhookDelivery ZSET atomicity (T030)', () => {
  let redis: RedisClientLike;

  beforeEach(() => {
    redis = createMockRedis();
    WebhookDeliveryQueue.resetInstance();
  });

  afterEach(async () => {
    // Drain whatever singleton is currently set, then clear.
    try {
      await WebhookDeliveryQueue.getInstance().shutdown();
    } catch {
      // queue may have already been replaced
    }
    WebhookDeliveryQueue.resetInstance();
  });

  it('two racing workers on the same job: one zRem wins, the other exits without invoking the processor', async () => {
    const processorSpy: WebhookDeliveryProcessor = vi.fn(async () => ({ outcome: 'delivered' as const }));

    // Worker A
    const workerA = WebhookDeliveryQueue.getInstance({ checkIntervalMs: 999_999 });
    await workerA.initialize(async () => redis, processorSpy);

    // Detach the singleton so we can mint a second worker that shares the same Redis state
    // (simulating two pods running side-by-side).
    WebhookDeliveryQueue.resetInstance();

    const workerB = WebhookDeliveryQueue.getInstance({ checkIntervalMs: 999_999 });
    await workerB.initialize(async () => redis, processorSpy);

    expect(workerA).not.toBe(workerB);

    // Enqueue one job that's immediately ready.
    const job: WebhookDeliveryJob = {
      webhookId: 'webhook-1',
      eventId: 'event-race',
      eventType: 'ticket.assigned',
      occurredAt: '2026-05-06T15:00:00.000Z',
      tenantId: 'tenant-a',
      payload: { ticket_id: 't1', tags: [] } as any,
      attempt: 1,
      deliverAt: Date.now() - 1,
    };
    await workerA.enqueue(job);

    // Race the two workers' process cycles.
    await Promise.all([workerA.process(), workerB.process()]);

    // Drain in-flight on both workers.
    await workerA.shutdown();
    await workerB.shutdown();

    // Exactly one worker won the claim and ran the processor.
    expect(processorSpy).toHaveBeenCalledTimes(1);
  });
});
