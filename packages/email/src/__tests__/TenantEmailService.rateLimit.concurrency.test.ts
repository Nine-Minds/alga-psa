import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { TenantEmailService } from '../TenantEmailService';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';
import type { TokenBucketRedisClient } from '@alga-psa/core/rateLimit';

describe('TenantEmailService email rate limit concurrency (live Redis)', () => {
  const redisUrl = process.env.EMAIL_RATE_LIMIT_TEST_REDIS || 'redis://127.0.0.1:6381';
  const tenantId = `email-rate-limit-test-${randomUUID()}`;
  const userId = 'concurrent-user';
  const bucketKey = `alga-psa:ratelimit:bucket:email:${tenantId}:${userId}`;
  const capacity = 20;

  let client: {
    del: (key: string) => Promise<unknown>;
    disconnect: () => Promise<void>;
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, options?: { EX?: number }) => Promise<unknown>;
    eval: (script: string, options: { keys: string[]; arguments: string[] }) => Promise<unknown>;
  } | null = null;

  beforeAll(async () => {
    try {
      const { createClient } = await import('redis');
      const passwordFile = process.env.EMAIL_RATE_LIMIT_TEST_REDIS_PASSWORD_FILE;
      const password = passwordFile ? (await readFile(passwordFile, 'utf8')).trim() : undefined;
      const candidate = createClient({
        url: redisUrl,
        ...(password ? { password } : {}),
        socket: {
          connectTimeout: 2000,
          reconnectStrategy: () => new Error('no live Redis for email rate-limit test'),
        },
      });
      candidate.on('error', () => undefined);
      await candidate.connect();
      await candidate.ping();
      client = candidate as unknown as typeof client;
    } catch {
      client = null;
    }
  }, 15000);

  afterAll(async () => {
    await client?.del(bucketKey).catch(() => undefined);
    TokenBucketRateLimiter.resetInstance();
    await client?.disconnect().catch(() => undefined);
  });

  it('allows exactly the bucket capacity and calls the mocked provider no more than capacity', async ({ skip }) => {
    if (!client) {
      skip();
      return;
    }

    TokenBucketRateLimiter.resetInstance();
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => client as unknown as TokenBucketRedisClient, {
      // A long refill interval prevents elapsed test time from adding tokens.
      email: async () => ({ maxTokens: capacity, refillRate: 0.000001 }),
    });
    await client.del(bucketKey);

    const mockedProviderSend = vi.fn(async () => ({ success: true }));
    const results: Array<{ allowed: boolean }> = await Promise.all(
      Array.from({ length: capacity * 3 }, async () => {
        const gate = await TenantEmailService.checkEmailRateLimit(tenantId, userId);
        if (gate.allowed) await mockedProviderSend();
        return gate;
      }),
    );

    const allowed = results.filter((result) => result.allowed).length;
    expect(allowed).toBe(capacity);
    expect(allowed).toBeLessThanOrEqual(capacity);
    expect(mockedProviderSend).toHaveBeenCalledTimes(capacity);
  });
});
