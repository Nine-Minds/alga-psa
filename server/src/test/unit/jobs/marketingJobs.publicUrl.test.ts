import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isFeatureFlagEnabledMock = vi.fn();
const sendDueSequenceStepsInternalMock = vi.fn();
const runWithTenantMock = vi.fn();
const getConnectionMock = vi.fn();
const getMarketingSigningSecretMock = vi.fn();

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@alga-psa/core', () => ({
  isFeatureFlagEnabled: isFeatureFlagEnabledMock,
}));

vi.mock('@alga-psa/marketing/lib', () => ({
  MARKETING_MODULE_FLAG: 'marketing-module',
  flipDuePostsInternal: vi.fn(),
  expireStaleTargetsInternal: vi.fn(),
  sendDueSequenceStepsInternal: sendDueSequenceStepsInternalMock,
}));

vi.mock('server/src/lib/db', () => ({
  runWithTenant: runWithTenantMock,
}));

vi.mock('server/src/lib/db/db', () => ({
  getConnection: getConnectionMock,
}));

vi.mock('server/src/lib/marketing/signingSecret', () => ({
  getMarketingSigningSecret: getMarketingSigningSecretMock,
}));

describe('marketing sequence job public URL', () => {
  const originalApplicationUrl = process.env.APPLICATION_URL;
  const originalNextAuthUrl = process.env.NEXTAUTH_URL;
  const originalPublicBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const originalPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const knex = { name: 'tenant-knex' };

  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureFlagEnabledMock.mockResolvedValue(true);
    getMarketingSigningSecretMock.mockResolvedValue('test-signing-secret');
    getConnectionMock.mockResolvedValue(knex);
    runWithTenantMock.mockImplementation(async (_tenantId, callback) => callback());
    sendDueSequenceStepsInternalMock.mockResolvedValue({
      sent: 1,
      completed: 0,
      stopped: 0,
      failed: 0,
      skipped: 0,
    });
    process.env.APPLICATION_URL = 'https://runtime-public.example.test/';
    process.env.NEXTAUTH_URL = 'https://auth-fallback.example.test/';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://image-build.example.test/';
    process.env.NEXT_PUBLIC_APP_URL = 'https://image-build-fallback.example.test/';
  });

  afterEach(() => {
    if (originalApplicationUrl === undefined) delete process.env.APPLICATION_URL;
    else process.env.APPLICATION_URL = originalApplicationUrl;
    if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalNextAuthUrl;
    if (originalPublicBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = originalPublicBaseUrl;
    if (originalPublicAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalPublicAppUrl;
  });

  it('uses the runtime application URL instead of NEXT_PUBLIC values from the image build', async () => {
    const { marketingSendSequenceStepsHandler } = await import(
      'server/src/lib/jobs/handlers/marketingJobs'
    );

    await marketingSendSequenceStepsHandler({ tenantId: 'tenant-1' });

    expect(sendDueSequenceStepsInternalMock).toHaveBeenCalledWith(knex, 'tenant-1', {
      baseUrl: 'https://runtime-public.example.test',
      signingSecret: 'test-signing-secret',
    });
  });

  it('falls back to the runtime authentication URL for non-Compose local launches', async () => {
    delete process.env.APPLICATION_URL;
    const { marketingSendSequenceStepsHandler } = await import(
      'server/src/lib/jobs/handlers/marketingJobs'
    );

    await marketingSendSequenceStepsHandler({ tenantId: 'tenant-1' });

    expect(sendDueSequenceStepsInternalMock).toHaveBeenCalledWith(knex, 'tenant-1', {
      baseUrl: 'https://auth-fallback.example.test',
      signingSecret: 'test-signing-secret',
    });
  });

  it('fails closed when runtime-only public URLs are absent', async () => {
    delete process.env.APPLICATION_URL;
    delete process.env.NEXTAUTH_URL;
    const { marketingSendSequenceStepsHandler } = await import(
      'server/src/lib/jobs/handlers/marketingJobs'
    );

    await expect(marketingSendSequenceStepsHandler({ tenantId: 'tenant-1' }))
      .rejects.toThrow('No runtime public marketing base URL available');
    expect(sendDueSequenceStepsInternalMock).not.toHaveBeenCalled();
  });
});
