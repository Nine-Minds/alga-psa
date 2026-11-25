import { afterEach, describe, expect, it, vi } from 'vitest';

const mockDb = vi.hoisted(() => ({
  insert: vi.fn(async () => 1),
}));

vi.mock('@alga-psa/db', () => {
  const query = {
    where: () => query,
    whereNull: () => query,
    select: () => query,
    first: async () => null,
    insert: mockDb.insert,
  };
  const db = {
    table: () => query,
    tenantJoin: () => query,
  };
  return {
    createTenantKnex: vi.fn(async () => ({ knex: {} })),
    getConnection: vi.fn(async () => ({})),
    isTenantSuspended: vi.fn(async () => false),
    tenantDb: vi.fn(() => db),
  };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

import { TenantEmailService } from '../TenantEmailService';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';
import type { TokenBucketRedisClient } from '@alga-psa/core/rateLimit';

function createServiceWithProvider(tenantId: string) {
  const providerSend = vi.fn(async () => ({
    success: true,
    messageId: 'controlled-provider-message',
    providerId: 'controlled-provider',
    providerType: 'smtp',
    sentAt: new Date(),
  }));
  const service = TenantEmailService.getInstance(tenantId);
  vi.spyOn(service as any, 'refreshProviderState').mockResolvedValue({
    emailProvider: {
      providerId: 'controlled-provider',
      providerType: 'smtp',
      sendEmail: providerSend,
    },
    providerInitError: null,
    fromAddress: { email: 'notifications@example.test' },
    settings: null,
  });
  return { service, providerSend };
}

function ordinarySend(service: TenantEmailService, tenantId: string, userId: string) {
  return service.sendEmail({
    tenantId,
    userId,
    mailClass: 'general',
    to: 'recipient@example.test',
    subject: 'Controlled notification',
    html: '<p>Controlled notification</p>',
  });
}

describe('TenantEmailService.checkEmailRateLimit', () => {
  afterEach(() => {
    TokenBucketRateLimiter.resetInstance();
  });

  it('consumes from the atomic email bucket for the tenant and user', async () => {
    const redis: TokenBucketRedisClient = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
      eval: vi.fn(async () => [1, 4, 0]),
    };
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => redis, {
      email: async () => ({ maxTokens: 5, refillRate: 1 }),
    });
    const nonAtomicConsume = vi.spyOn(limiter, 'tryConsume');
    const atomicConsume = vi.spyOn(limiter, 'tryConsumeAtomic');

    const result = await TenantEmailService.checkEmailRateLimit('tenant-unit', 'user-unit');

    expect(result).toEqual({ allowed: true });
    expect(atomicConsume).toHaveBeenCalledOnce();
    expect(atomicConsume).toHaveBeenCalledWith('email', 'tenant-unit', 'user-unit');
    expect(nonAtomicConsume).not.toHaveBeenCalled();
  });

  it('sends through TenantEmailService when initialized Redis EVAL fails, while valid quota exhaustion blocks', async () => {
    const tenantId = 'tenant-eval-failure';
    const userId = 'user-eval-failure';
    const { service, providerSend } = createServiceWithProvider(tenantId);
    const redis: TokenBucketRedisClient = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
      eval: vi.fn(async () => { throw new Error('redis connection details must not be logged'); }),
    };
    const limiter = TokenBucketRateLimiter.getInstance();
    await limiter.initialize(async () => redis, {
      email: async () => ({ maxTokens: 1, refillRate: 1 }),
    });

    const delivered = await ordinarySend(service, tenantId, userId);
    expect(delivered).toMatchObject({ success: true });
    expect(providerSend).toHaveBeenCalledOnce();

    (redis.eval as ReturnType<typeof vi.fn>).mockResolvedValueOnce([0, 0, 1000]);
    const denied = await ordinarySend(service, tenantId, userId);

    expect(denied).toMatchObject({ success: false, error: expect.stringContaining('Rate limit exceeded') });
    expect(providerSend).toHaveBeenCalledOnce();
  });

  it('keeps an uninitialized limiter fail-open at the shared email gate', async () => {
    const gate = await TenantEmailService.checkEmailRateLimit('tenant-no-redis', 'user-no-redis');
    expect(gate).toEqual({ allowed: true });
  });
});
