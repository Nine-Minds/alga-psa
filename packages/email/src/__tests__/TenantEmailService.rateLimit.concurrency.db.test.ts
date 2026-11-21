import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from 'redis';

const controlledProvider = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  isTenantSuspended: vi.fn(async () => false),
}));

vi.mock('../providers/EmailProviderManager', () => ({
  EmailProviderManager: class {
    async initialize() {}
    sendEmail = controlledProvider.sendEmail;
  },
}));

import { defaultSendLive } from '../diagnostics/outboundDiagnostics';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';
import type { TokenBucketRedisClient } from '@alga-psa/core/rateLimit';

describe('TenantEmailService email rate limit concurrency (live Redis)', () => {
  // The .db.test suffix assigns this suite to the workspace database lane,
  // which provides real Redis instead of the unit lane's never-connecting stub.
  const redisUrl = process.env.EMAIL_RATE_LIMIT_TEST_REDIS
    || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || '6379'}`;
  const tenantId = `email-rate-limit-test-${randomUUID()}`;
  const userId = 'concurrent-user';
  const bucketKey = `alga-psa:ratelimit:bucket:email:${tenantId}:${userId}`;
  const capacity = 20;

  let client: ReturnType<typeof createClient>;

  beforeAll(async () => {
    const passwordFile = process.env.EMAIL_RATE_LIMIT_TEST_REDIS_PASSWORD_FILE;
    const password = passwordFile ? (await readFile(passwordFile, 'utf8')).trim() : undefined;
    client = createClient({
      url: redisUrl,
      ...(password ? { password } : {}),
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: () => new Error('no live Redis for email rate-limit test'),
      },
    });
    client.on('error', () => undefined);
    await client.connect();
    await client.ping();
  }, 15000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    TokenBucketRateLimiter.resetInstance();
    if (client?.isOpen) {
      try {
        await client.del(bucketKey);
      } finally {
        await client.disconnect();
      }
    }
  });

  it('sends exactly the bucket capacity through diagnostics live-send and blocks the rest', async () => {
    TokenBucketRateLimiter.resetInstance();
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => client as unknown as TokenBucketRedisClient, {
      // A long refill interval prevents elapsed test time from adding tokens.
      email: async () => ({ maxTokens: capacity, refillRate: 0.000001 }),
    });
    await client.del(bucketKey);

    controlledProvider.sendEmail.mockReset();
    controlledProvider.sendEmail.mockResolvedValue({
      success: true,
      messageId: 'controlled-provider-message',
      providerId: 'controlled-provider',
      providerType: 'smtp',
    });
    const input = {
      tenant: tenantId,
      userId,
      settings: { tenantId, emailProvider: 'smtp', providerConfigs: [] } as any,
      from: 'notifications@example.test',
      recipient: 'recipient@example.test',
    };
    const results = await Promise.all(
      Array.from({ length: capacity * 3 }, () => defaultSendLive(input)),
    );

    expect(controlledProvider.sendEmail).toHaveBeenCalledTimes(capacity);
    const allowed = results.filter((result) => result.success).length;
    expect(allowed).toBe(capacity);
    expect(allowed).toBeLessThanOrEqual(capacity);
    expect(results.filter((result) => result.errorCode === 'RATE_LIMITED')).toHaveLength(capacity * 2);
  });

  it('preserves quota across out-of-order application clocks and normalizes future bucket timestamps', async () => {
    TokenBucketRateLimiter.resetInstance();
    await TokenBucketRateLimiter.getInstance().initialize(async () => client as unknown as TokenBucketRedisClient, {
      email: async () => ({ maxTokens: 2, refillRate: 0.000001 }),
    });
    await client.del(bucketKey);

    controlledProvider.sendEmail.mockReset();
    controlledProvider.sendEmail.mockResolvedValue({
      success: true,
      messageId: 'controlled-provider-message',
      providerId: 'controlled-provider',
      providerType: 'smtp',
    });
    const input = {
      tenant: tenantId,
      userId,
      settings: { tenantId, emailProvider: 'smtp', providerConfigs: [] } as any,
      from: 'notifications@example.test',
      recipient: 'recipient@example.test',
    };

    const originalNow = Date.now;
    const futureClock = vi.spyOn(Date, 'now').mockReturnValueOnce(originalNow() + 60_000);
    const first = await defaultSendLive(input);
    futureClock.mockReturnValueOnce(originalNow() - 60_000);
    const second = await defaultSendLive(input);
    futureClock.mockReturnValue(originalNow() + 60_000);
    const third = await defaultSendLive(input);
    const fourth = await defaultSendLive(input);
    futureClock.mockRestore();

    expect(controlledProvider.sendEmail).toHaveBeenCalledTimes(2);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(third.errorCode).toBe('RATE_LIMITED');
    expect(fourth.errorCode).toBe('RATE_LIMITED');

    const normalizedState = JSON.parse((await client.get(bucketKey))!);
    expect(normalizedState.tokens).toBeLessThan(0.01);
    expect(normalizedState.lastRefillMs).toBeLessThan(originalNow() + 60_000);

    // A pre-existing future timestamp is normalized in place. Its low token
    // balance remains enforceable, and later elapsed time refills from the new
    // baseline rather than from the anomalous future date.
    await client.set(bucketKey, JSON.stringify({ tokens: 1.5, lastRefillMs: originalNow() + 120_000 }), { EX: 3600 });
    const affordable = await defaultSendLive(input);
    const exhausted = await defaultSendLive(input);
    expect(affordable.success).toBe(true);
    expect(exhausted.errorCode).toBe('RATE_LIMITED');
    expect(controlledProvider.sendEmail).toHaveBeenCalledTimes(3);

    const futureStateAfterConsume = JSON.parse((await client.get(bucketKey))!);
    expect(futureStateAfterConsume.tokens).toBeCloseTo(0.5);
    expect(futureStateAfterConsume.lastRefillMs).toBeLessThan(originalNow() + 120_000);

    // Set an old baseline relative to Redis TIME so the configured refill
    // supplies tokens after timestamp normalization without sleep.
    const redisTime = await client.sendCommand<string[]>(['TIME']);
    const redisNowMs = Number(redisTime[0]) * 1000 + Number(redisTime[1]) / 1000;
    await client.set(bucketKey, JSON.stringify({ tokens: 0, lastRefillMs: redisNowMs - 2_000_000_000 }), { EX: 3600 });
    const recovered = await defaultSendLive(input);
    expect(recovered.success).toBe(true);
    expect(controlledProvider.sendEmail).toHaveBeenCalledTimes(4);
  });
});
