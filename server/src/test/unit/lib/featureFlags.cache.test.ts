import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const originalAlgaUsageStats = process.env.ALGA_USAGE_STATS;
const originalDisableFeatureFlags = process.env.DISABLE_FEATURE_FLAGS;
const originalNextDisableFeatureFlags = process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS;

const isFeatureEnabledMock = vi.fn();
const getClientMock = vi.fn(() => null);
const analyticsCaptureMock = vi.fn();
const tenantFirstMock = vi.fn();
const tenantWhereMock = vi.fn();
const tenantKnexMock = vi.fn();
const createTenantKnexMock = vi.fn();

vi.mock('posthog-node', () => ({
  PostHog: vi.fn().mockImplementation(() => ({
    isFeatureEnabled: isFeatureEnabledMock,
    getFeatureFlag: vi.fn(),
  })),
}));

vi.mock('server/src/config/posthog.config', () => ({
  posthogConfig: {
    apiKey: 'test-api-key',
    apiHost: 'https://posthog.example.test',
  },
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    isEnabled: false,
    getClient: getClientMock,
    capture: analyticsCaptureMock,
  },
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

describe('FeatureFlags cache scoping', () => {
  beforeEach(() => {
    vi.resetModules();

    process.env.ALGA_USAGE_STATS = 'true';
    delete process.env.DISABLE_FEATURE_FLAGS;
    delete process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS;

    isFeatureEnabledMock.mockReset();
    getClientMock.mockReset();
    getClientMock.mockReturnValue(null);
    analyticsCaptureMock.mockReset();
    tenantFirstMock.mockReset();
    tenantFirstMock.mockResolvedValue(null);
    tenantWhereMock.mockReset();
    tenantWhereMock.mockReturnValue({ first: tenantFirstMock });
    tenantKnexMock.mockReset();
    tenantKnexMock.mockReturnValue({ where: tenantWhereMock });
    createTenantKnexMock.mockReset();
    createTenantKnexMock.mockResolvedValue({ knex: tenantKnexMock });
  });

  it('caches boolean evaluations per tenant context instead of only by flag key', async () => {
    isFeatureEnabledMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const { FeatureFlags } = await import('server/src/lib/feature-flags/featureFlags');
    const flags = new FeatureFlags();

    await expect(
      flags.isEnabled('ai-assistant-activation', { tenantId: 'tenant-a' })
    ).resolves.toBe(true);
    await expect(
      flags.isEnabled('ai-assistant-activation', { tenantId: 'tenant-b' })
    ).resolves.toBe(false);

    expect(isFeatureEnabledMock).toHaveBeenCalledTimes(2);
    expect(isFeatureEnabledMock).toHaveBeenNthCalledWith(
      1,
      'ai-assistant-activation',
      'tenant_tenant-a',
      expect.objectContaining({
        groups: { tenant: 'tenant-a' },
      })
    );
    expect(isFeatureEnabledMock).toHaveBeenNthCalledWith(
      2,
      'ai-assistant-activation',
      'tenant_tenant-b',
      expect.objectContaining({
        groups: { tenant: 'tenant-b' },
      })
    );
  });
});

afterAll(() => {
  process.env.ALGA_USAGE_STATS = originalAlgaUsageStats;
  process.env.DISABLE_FEATURE_FLAGS = originalDisableFeatureFlags;
  process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS = originalNextDisableFeatureFlags;
});
