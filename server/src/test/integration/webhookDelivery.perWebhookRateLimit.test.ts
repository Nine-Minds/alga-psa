import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';
import { type RedisClientLike } from '@alga-psa/email';

const webhookModelState = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  getSigningSecretMock: vi.fn(),
  recordDeliveryMock: vi.fn(),
  updateStatsMock: vi.fn(),
}));

vi.mock('@/lib/webhooks/webhookModel', () => ({
  webhookModel: {
    getById: (...args: unknown[]) => webhookModelState.getByIdMock(...args),
    getSigningSecret: (...args: unknown[]) => webhookModelState.getSigningSecretMock(...args),
    recordDelivery: (...args: unknown[]) => webhookModelState.recordDeliveryMock(...args),
    updateStats: (...args: unknown[]) => webhookModelState.updateStatsMock(...args),
  },
}));

vi.mock('@/lib/webhooks/autoDisable', () => ({
  maybeAutoDisable: vi.fn(async () => undefined),
}));

import {
  WebhookDeliveryQueue,
  type WebhookDeliveryJob,
} from '@/lib/webhooks/WebhookDeliveryQueue';
import { processWebhookDeliveryJob } from '@/lib/webhooks/processWebhookDeliveryJob';

function createMockRedis(): RedisClientLike & {
  inspectQueue(): Array<{ member: string; score: number }>;
} {
  const kv = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const QUEUE_KEY = 'alga-psa:webhook-out:queue';

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
    inspectQueue() {
      const z = getZset(QUEUE_KEY);
      return Array.from(z.entries()).map(([member, score]) => ({ member, score }));
    },
  };
}

async function startStubServer(): Promise<{ url: string; hits: () => number; close: () => Promise<void> }> {
  let count = 0;
  const server = http.createServer((_req, res) => {
    count += 1;
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind stub server');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    hits: () => count,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function waitFor(fn: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!fn()) throw new Error('waitFor timed out');
}

describe('webhookDelivery per-webhook rate limit (T029)', () => {
  const TENANT = 'tenant-a';
  const WEBHOOK_ID = 'webhook-1';
  const RATE_LIMIT = 10;
  const originalAllowPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
  let stub: Awaited<ReturnType<typeof startStubServer>>;
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = 'true';
    webhookModelState.getByIdMock.mockReset();
    webhookModelState.getSigningSecretMock.mockReset();
    webhookModelState.recordDeliveryMock.mockReset();
    webhookModelState.updateStatsMock.mockReset();
    webhookModelState.recordDeliveryMock.mockResolvedValue(undefined);
    webhookModelState.updateStatsMock.mockResolvedValue(null);
    webhookModelState.getSigningSecretMock.mockResolvedValue('shh');

    TokenBucketRateLimiter.resetInstance();
    WebhookDeliveryQueue.resetInstance();
    redis = createMockRedis();

    await TokenBucketRateLimiter.getInstance().initialize(
      async () => redis,
      { 'webhook-out': async () => ({ maxTokens: RATE_LIMIT, refillRate: RATE_LIMIT / 60 }) },
    );

    stub = await startStubServer();
    webhookModelState.getByIdMock.mockResolvedValue({
      tenant: TENANT,
      webhookId: WEBHOOK_ID,
      url: stub.url,
      method: 'POST',
      eventTypes: ['ticket.assigned'],
      customHeaders: null,
      verifySsl: false,
      isActive: true,
      rateLimitPerMin: RATE_LIMIT,
    });

    const queue = WebhookDeliveryQueue.getInstance({ checkIntervalMs: 999_999 });
    await queue.initialize(async () => redis, processWebhookDeliveryJob);
  });

  afterEach(async () => {
    await WebhookDeliveryQueue.getInstance().shutdown();
    WebhookDeliveryQueue.resetInstance();
    TokenBucketRateLimiter.resetInstance();
    await stub.close();
    if (originalAllowPrivate === undefined) {
      delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    } else {
      process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = originalAllowPrivate;
    }
  });

  it('with rate_limit_per_min=10, 30 simultaneous jobs deliver 10 and re-enqueue 20 with future scores', async () => {
    const queue = WebhookDeliveryQueue.getInstance();
    const startedAt = Date.now();

    const enqueues: Promise<void>[] = [];
    for (let i = 0; i < 30; i += 1) {
      const job: WebhookDeliveryJob = {
        webhookId: WEBHOOK_ID,
        eventId: `event-${i}`,
        eventType: 'ticket.assigned',
        occurredAt: '2026-05-06T15:00:00.000Z',
        tenantId: TENANT,
        payload: { ticket_id: `ticket-${i}`, tags: [] } as any,
        attempt: 1,
        deliverAt: startedAt - 1,
      };
      enqueues.push(queue.enqueue(job));
    }
    await Promise.all(enqueues);

    expect(redis.inspectQueue()).toHaveLength(30);

    await queue.process();
    await waitFor(() => webhookModelState.recordDeliveryMock.mock.calls.length >= RATE_LIMIT, 5_000);
    // Allow any rate-limited (no recordDelivery) work to complete its re-enqueue.
    await queue.shutdown();

    // Exactly 10 HTTP deliveries fired.
    expect(stub.hits()).toBe(RATE_LIMIT);

    // recordDelivery is only called for non-rate-limited paths (delivered/abandoned/retrying);
    // rate-limited jobs short-circuit before recordDelivery.
    expect(webhookModelState.recordDeliveryMock).toHaveBeenCalledTimes(RATE_LIMIT);
    for (const call of webhookModelState.recordDeliveryMock.mock.calls) {
      expect(call[0]).toMatchObject({ status: 'delivered', attemptNumber: 1 });
    }

    // The remaining 20 are re-enqueued with deliverAt in the future (rate-limited retry).
    const remaining = redis.inspectQueue();
    expect(remaining).toHaveLength(30 - RATE_LIMIT);
    for (const entry of remaining) {
      expect(entry.score).toBeGreaterThan(startedAt);
      // Re-enqueued entries are tagged as attempt=2.
      expect(entry.member.endsWith(':2')).toBe(true);
    }
  });
});
