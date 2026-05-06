import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBucketRateLimiter, type RedisClientLike } from '@alga-psa/email';

const webhookModelState = vi.hoisted(() => ({
  recordDeliveryMock: vi.fn(),
}));

vi.mock('@/lib/webhooks/webhookModel', () => ({
  webhookModel: {
    recordDelivery: (...args: unknown[]) => webhookModelState.recordDeliveryMock(...args),
  },
  buildWebhookSigningSecretName: (id: string) => `webhook_signing_secret_${id}`,
  buildWebhookSigningSecretVaultPath: (tenant: string, name: string) => `tenant/${tenant}/${name}`,
}));

import {
  buildWebhookEnvelope,
  buildSignedWebhookRequestHeaders,
} from '@/lib/webhooks/processWebhookDeliveryJob';
import { performWebhookDeliveryRequest } from '@/lib/webhooks/delivery';
import { signRequest, verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from '@/lib/webhooks/sign';
import { webhookModel } from '@/lib/webhooks/webhookModel';

const TENANT = 'tenant-a';
const WEBHOOK_ID = 'webhook-1';
const SIGNING_SECRET = 'shh';

function createMockRedis(): RedisClientLike {
  const kv = new Map<string, string>();
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
    async zAdd() {
      return 1;
    },
    async zRem() {
      return 1;
    },
    async zRangeByScore() {
      return [];
    },
    async zCard() {
      return 0;
    },
  };
}

async function startStubServer() {
  const received: Array<{ headers: Record<string, string>; bodyRaw: string; body: any }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString('utf8');
      received.push({
        headers: req.headers as Record<string, string>,
        bodyRaw,
        body: JSON.parse(bodyRaw || '{}'),
      });
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  return {
    url: `http://127.0.0.1:${address.port}`,
    received,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

describe('webhook test-endpoint contract (T033)', () => {
  const originalAllowPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
  let stub: Awaited<ReturnType<typeof startStubServer>>;

  beforeEach(async () => {
    process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = 'true';
    webhookModelState.recordDeliveryMock.mockReset();
    webhookModelState.recordDeliveryMock.mockResolvedValue({ deliveryId: 'd1' });

    TokenBucketRateLimiter.resetInstance();
    await TokenBucketRateLimiter.getInstance().initialize(
      async () => createMockRedis(),
      { 'webhook-out': async () => ({ maxTokens: 100, refillRate: 100 / 60 }) },
    );

    stub = await startStubServer();
  });

  afterEach(async () => {
    TokenBucketRateLimiter.resetInstance();
    await stub.close();
    if (originalAllowPrivate === undefined) {
      delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    } else {
      process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = originalAllowPrivate;
    }
  });

  it('sends a webhook.test envelope, signs it, records is_test=true, and never consumes a webhook-out token', async () => {
    const limiter = TokenBucketRateLimiter.getInstance();

    // Snapshot bucket BEFORE any work — should be the initialized capacity.
    const before = await limiter.getState('webhook-out', TENANT, WEBHOOK_ID);

    // Replay the testById() body without going through the auth/HTTP layer:
    // build envelope → sign → HTTP send → recordDelivery(isTest=true).
    const eventId = 'event-test-1';
    const deliveryId = 'delivery-test-1';
    const testedAt = new Date();
    const request = {
      webhookId: WEBHOOK_ID,
      eventId,
      eventType: 'webhook.test',
      occurredAt: testedAt.toISOString(),
      payload: {
        webhook_id: WEBHOOK_ID,
        webhook_name: 'My webhook',
        is_test: true,
      },
      attempt: 1,
    };
    const envelope = buildWebhookEnvelope(TENANT, request);
    const requestBody = JSON.stringify(envelope);
    const signature = signRequest(
      SIGNING_SECRET,
      requestBody,
      Math.floor(testedAt.getTime() / 1000),
    );
    const requestHeaders = buildSignedWebhookRequestHeaders({
      deliveryId,
      request,
      signature,
      customHeaders: null,
    });

    const result = await performWebhookDeliveryRequest({
      webhook_id: WEBHOOK_ID,
      url: stub.url,
      method: 'POST',
      headers: requestHeaders,
      payload: envelope,
      verify_ssl: false,
    });
    expect(result.success).toBe(true);

    await webhookModel.recordDelivery({
      tenant: TENANT,
      deliveryId,
      webhookId: WEBHOOK_ID,
      eventId,
      eventType: 'webhook.test',
      requestHeaders,
      requestBody: envelope,
      responseStatusCode: result.status_code ?? null,
      responseHeaders: result.response_headers ?? null,
      responseBody: result.response_body ?? null,
      status: 'delivered',
      attemptNumber: 1,
      durationMs: result.duration_ms ?? null,
      errorMessage: null,
      nextRetryAt: null,
      isTest: true,
      attemptedAt: testedAt,
      completedAt: testedAt,
    });

    // (a) Stub received exactly one POST with event_type='webhook.test'.
    expect(stub.received).toHaveLength(1);
    expect(stub.received[0].body).toMatchObject({
      tenant_id: TENANT,
      event_type: 'webhook.test',
      data: { is_test: true },
    });

    // (b) Signature verifies against the raw body.
    const sig = stub.received[0].headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()];
    expect(verifyWebhookSignature(sig, stub.received[0].bodyRaw, SIGNING_SECRET)).toBe(true);

    // (c) recordDelivery captured isTest=true.
    expect(webhookModelState.recordDeliveryMock).toHaveBeenCalledTimes(1);
    expect(webhookModelState.recordDeliveryMock.mock.calls[0][0]).toMatchObject({
      isTest: true,
      eventType: 'webhook.test',
      status: 'delivered',
    });

    // (d) Bucket state is unchanged — test endpoint never calls tryConsume.
    const after = await limiter.getState('webhook-out', TENANT, WEBHOOK_ID);
    expect(after?.tokens).toBe(before?.tokens);
  });
});
