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
  fastForwardAll(): void;
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
    fastForwardAll() {
      const z = getZset(QUEUE_KEY);
      for (const member of z.keys()) {
        z.set(member, Date.now() - 1);
      }
    },
  };
}

async function startStubServerReturning500(): Promise<{
  url: string;
  hits: number;
  close: () => Promise<void>;
}> {
  const state = { hits: 0 };
  const server = http.createServer((_req, res) => {
    state.hits += 1;
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'boom' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind stub HTTP server');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    get hits() {
      return state.hits;
    },
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  } as any;
}

async function waitFor(fn: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!fn()) {
    throw new Error('waitFor timed out');
  }
}

describe('webhookDelivery retries (T027)', () => {
  const TENANT = 'tenant-a';
  const WEBHOOK_ID = 'webhook-1';
  const EVENT_ID = 'event-retries';
  const SIGNING_SECRET = 'shh';
  const originalAllowPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
  let stub: Awaited<ReturnType<typeof startStubServerReturning500>>;
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = 'true';
    webhookModelState.getByIdMock.mockReset();
    webhookModelState.getSigningSecretMock.mockReset();
    webhookModelState.recordDeliveryMock.mockReset();
    webhookModelState.updateStatsMock.mockReset();
    webhookModelState.recordDeliveryMock.mockResolvedValue(undefined);
    webhookModelState.updateStatsMock.mockResolvedValue(null);
    webhookModelState.getSigningSecretMock.mockResolvedValue(SIGNING_SECRET);

    TokenBucketRateLimiter.resetInstance();
    WebhookDeliveryQueue.resetInstance();
    redis = createMockRedis();

    await TokenBucketRateLimiter.getInstance().initialize(
      async () => redis,
      { 'webhook-out': async () => ({ maxTokens: 1000, refillRate: 1000 / 60 }) },
    );

    stub = await startStubServerReturning500();

    webhookModelState.getByIdMock.mockResolvedValue({
      tenant: TENANT,
      webhookId: WEBHOOK_ID,
      url: stub.url,
      method: 'POST',
      eventTypes: ['ticket.assigned'],
      customHeaders: null,
      verifySsl: false,
      isActive: true,
      rateLimitPerMin: 1000,
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

  it('runs 5 attempts on a 500-returning target with retrying x4 + abandoned, and the ZSET is empty after the 5th', async () => {
    const queue = WebhookDeliveryQueue.getInstance();
    const job: WebhookDeliveryJob = {
      webhookId: WEBHOOK_ID,
      eventId: EVENT_ID,
      eventType: 'ticket.assigned',
      occurredAt: '2026-05-06T15:00:00.000Z',
      tenantId: TENANT,
      payload: { ticket_id: 'ticket-1', tags: [] } as any,
      attempt: 1,
      deliverAt: Date.now() - 1,
    };

    await queue.enqueue(job);

    const expectedBackoffMs = [
      60_000,           // attempt 1 → schedules attempt 2 at now + 1m
      5 * 60_000,       // attempt 2 → 5m
      30 * 60_000,      // attempt 3 → 30m
      2 * 60 * 60_000,  // attempt 4 → 2h
    ];

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const beforeQueue = redis.inspectQueue();
      const expectedAttempts = attempt;

      await queue.process();
      await waitFor(
        () => webhookModelState.recordDeliveryMock.mock.calls.length >= expectedAttempts,
      );

      const recorded = webhookModelState.recordDeliveryMock.mock.calls[attempt - 1][0];
      expect(recorded).toMatchObject({
        attemptNumber: attempt,
        eventId: EVENT_ID,
        status: attempt < 5 ? 'retrying' : 'abandoned',
      });

      const queueAfter = redis.inspectQueue();
      if (attempt < 5) {
        // Exactly one entry queued for the next attempt with the documented backoff.
        expect(queueAfter).toHaveLength(1);
        const [next] = queueAfter;
        expect(next.member.endsWith(`:${attempt + 1}`)).toBe(true);

        const expectedDelivery = Date.now() + expectedBackoffMs[attempt - 1];
        // Allow a small fudge factor for elapsed time during the assertion.
        expect(next.score).toBeGreaterThan(expectedDelivery - 5_000);
        expect(next.score).toBeLessThan(expectedDelivery + 5_000);

        // Fast-forward the next attempt so process() picks it up immediately.
        redis.fastForwardAll();
      } else {
        // After attempt 5 (abandoned), the queue is empty.
        expect(queueAfter).toHaveLength(0);
      }

      // Sanity: the stub HTTP server received exactly `attempt` 500-responses.
      expect(stub.hits).toBe(attempt);
      void beforeQueue;
    }

    expect(webhookModelState.recordDeliveryMock).toHaveBeenCalledTimes(5);
    expect(redis.inspectQueue()).toHaveLength(0);
  });
});
