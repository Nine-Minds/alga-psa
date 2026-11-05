import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTenantSuspended: vi.fn(),
  initialize: vi.fn(),
  sendEmail: vi.fn(),
  tryConsume: vi.fn(),
  limiterReady: { value: true },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: {
    getInstance: () => ({
      isReady: () => mocks.limiterReady.value,
      tryConsume: mocks.tryConsume,
    }),
  },
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  isTenantSuspended: mocks.isTenantSuspended,
  tenantDb: vi.fn(),
}));

vi.mock('../../providers/EmailProviderManager', () => ({
  EmailProviderManager: class {
    initialize = mocks.initialize;
    sendEmail = mocks.sendEmail;
  },
}));

import { defaultSendLive } from '../outboundDiagnostics';

const input = {
  tenant: 'tenant-1',
  settings: { tenantId: 'tenant-1', providerConfigs: [] } as any,
  from: 'sender@example.com',
  recipient: 'admin@example.com',
  userId: 'user-9',
};

describe('diagnostics live-send gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limiterReady.value = true;
    mocks.isTenantSuspended.mockResolvedValue(false);
    mocks.tryConsume.mockResolvedValue({ allowed: true });
    mocks.initialize.mockResolvedValue(undefined);
    mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'm1' });
  });

  it('refuses a suspended tenant without initializing or calling the provider', async () => {
    mocks.isTenantSuspended.mockResolvedValue(true);

    const result = await defaultSendLive(input);

    expect(result).toMatchObject({ success: false, definitelyNotSent: true, retryable: false, errorCode: 'TENANT_SUSPENDED' });
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a rate-limited tenant without initializing or calling the provider', async () => {
    mocks.tryConsume.mockResolvedValue({ allowed: false, reason: 'bucket empty', retryAfterMs: 1500 });

    const result = await defaultSendLive(input);

    expect(result).toMatchObject({ success: false, definitelyNotSent: true, retryable: true, errorCode: 'RATE_LIMITED' });
    expect(result.metadata).toMatchObject({ retryAfterMs: 1500 });
    expect(mocks.tryConsume).toHaveBeenCalledWith('email', 'tenant-1', 'user-9');
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('sends when the tenant is active and within budget', async () => {
    const result = await defaultSendLive(input);

    expect(result.success).toBe(true);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });
});
