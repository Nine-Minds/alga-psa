import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBucketRateLimiter, type RedisClientLike } from '@alga-psa/email';

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
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from '@/lib/webhooks/sign';

type CapturedRequest = {
  method: string;
  headers: Record<string, string>;
  bodyRaw: string;
  body: any;
};

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

async function startStubServer(): Promise<{
  url: string;
  received: CapturedRequest[];
  close: () => Promise<void>;
}> {
  const received: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString('utf8');
      let parsed: any = bodyRaw;
      try {
        parsed = JSON.parse(bodyRaw);
      } catch {
        // leave as raw
      }
      received.push({
        method: req.method ?? '',
        headers: req.headers as Record<string, string>,
        bodyRaw,
        body: parsed,
      });
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind stub HTTP server');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    received,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

describe('webhookDelivery happy path (T025)', () => {
  const TENANT = 'tenant-a';
  const WEBHOOK_ID = 'webhook-1';
  const EVENT_ID = 'event-1';
  const SIGNING_SECRET = 'signing-secret-1';
  const originalAllowPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;

  let stub: Awaited<ReturnType<typeof startStubServer>>;

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

    const redis = createMockRedis();
    await TokenBucketRateLimiter.getInstance().initialize(
      async () => redis,
      { 'webhook-out': async () => ({ maxTokens: 100, refillRate: 100 / 60 }) },
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
      rateLimitPerMin: 100,
    });

    // Use a long interval so the auto-poller doesn't race with the manual process() call.
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

  it('drains an enqueued ticket.assigned job: stub receives one signed POST and recordDelivery is delivered/attempt=1', async () => {
    const job: WebhookDeliveryJob = {
      webhookId: WEBHOOK_ID,
      eventId: EVENT_ID,
      eventType: 'ticket.assigned',
      occurredAt: '2026-05-06T15:00:00.000Z',
      tenantId: TENANT,
      payload: {
        ticket_id: 'ticket-123',
        ticket_number: 'TKT-1',
        title: 'Hello',
      } as any,
      attempt: 1,
      deliverAt: Date.now() - 1,
    };

    const queue = WebhookDeliveryQueue.getInstance();
    await queue.enqueue(job);

    // Trigger one processing cycle and drain in-flight deliveries.
    await queue.process();
    await queue.shutdown();

    // (a) Exactly one POST landed on the stub server.
    expect(stub.received).toHaveLength(1);
    const [hit] = stub.received;
    expect(hit.method).toBe('POST');

    // (b) Documented envelope shape.
    expect(hit.body).toMatchObject({
      event_id: EVENT_ID,
      event_type: 'ticket.assigned',
      occurred_at: '2026-05-06T15:00:00.000Z',
      tenant_id: TENANT,
    });
    expect(hit.body.data).toMatchObject({ ticket_id: 'ticket-123' });

    // (c) Signature verifies against the raw body the server received.
    const sigHeader = hit.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()];
    expect(typeof sigHeader).toBe('string');
    expect(verifyWebhookSignature(sigHeader, hit.bodyRaw, SIGNING_SECRET)).toBe(true);

    // (d) Delivery recorded with status='delivered' and attempt_number=1.
    expect(webhookModelState.recordDeliveryMock).toHaveBeenCalledTimes(1);
    const [recordCall] = webhookModelState.recordDeliveryMock.mock.calls;
    expect(recordCall[0]).toMatchObject({
      tenant: TENANT,
      webhookId: WEBHOOK_ID,
      eventId: EVENT_ID,
      eventType: 'ticket.assigned',
      status: 'delivered',
      attemptNumber: 1,
      isTest: false,
    });
  });
});
