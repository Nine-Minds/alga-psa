import { afterEach, describe, expect, it, vi } from 'vitest';

describe('FeatureFlags runtime', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('uses the shared default runtime without an external checker', async () => {
    // Under NODE_ENV=test the PostHog client is opt-in (see usageStatsEnabled).
    vi.stubEnv('ALGA_USAGE_STATS', 'true');
    vi.doMock('posthog-node', () => ({
      PostHog: class {
        async isFeatureEnabled() {
          return true;
        }
      },
    }));

    const { FeatureFlags } = await import('./featureFlagRuntime');
    const runtime = new FeatureFlags();

    await expect(
      runtime.isEnabledOrDefault('ai-assistant-activation', {
        tenantId: 'tenant-a',
        userId: 'user-a',
      })
    ).resolves.toBe(true);
  });

  it('never contacts PostHog under NODE_ENV=test unless usage stats are opted in', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ALGA_USAGE_STATS', '');
    const posthogSpy = vi.fn();
    vi.doMock('posthog-node', () => ({
      PostHog: class {
        async isFeatureEnabled(...args: unknown[]) {
          posthogSpy(...args);
          return true;
        }
      },
    }));

    const { FeatureFlags } = await import('./featureFlagRuntime');
    const runtime = new FeatureFlags();

    await expect(
      runtime.isEnabledOrDefault('ai-assistant-activation', {
        tenantId: 'tenant-a',
        userId: 'user-a',
      })
    ).resolves.toBe(false);
    expect(posthogSpy).not.toHaveBeenCalled();
  });

  it('uses manual overrides before consulting PostHog', async () => {
    const posthogSpy = vi.fn();
    vi.doMock('posthog-node', () => ({
      PostHog: class {
        async isFeatureEnabled(...args: unknown[]) {
          posthogSpy(...args);
          return true;
        }
      },
    }));

    const { FeatureFlags } = await import('./featureFlagRuntime');
    const runtime = new FeatureFlags();
    runtime.setOverride('ai-assistant-activation', false);

    await expect(
      runtime.isEnabled('ai-assistant-activation', {
        tenantId: 'tenant-a',
        userId: 'user-a',
      })
    ).resolves.toBe(false);
    expect(posthogSpy).not.toHaveBeenCalled();
  });

  it('distinguishes deliberate false from missing clients, undefined results, and client errors', async () => {
    const { FeatureFlags } = await import('./featureFlagRuntime');
    const evaluatedFalse = new FeatureFlags({ clientResolver: () => ({ isFeatureEnabled: async () => false } as any) });
    const missingClient = new FeatureFlags({ clientResolver: () => null });
    const undefinedResult = new FeatureFlags({ clientResolver: () => ({ isFeatureEnabled: async () => undefined } as any) });
    const failedClient = new FeatureFlags({ clientResolver: () => ({ isFeatureEnabled: async () => { throw new Error('PostHog unavailable'); } } as any) });

    await expect(evaluatedFalse.evaluate('release-v2-0-feature', { tenantId: 'tenant-a' }))
      .resolves.toEqual({ status: 'evaluated', enabled: false });
    await expect(missingClient.evaluate('release-v2-0-feature', { tenantId: 'tenant-a' }))
      .resolves.toEqual({ status: 'unavailable', enabled: false });
    await expect(undefinedResult.evaluate('release-v2-0-feature', { tenantId: 'tenant-a' }))
      .resolves.toEqual({ status: 'unavailable', enabled: false });
    await expect(failedClient.evaluate('release-v2-0-feature', { tenantId: 'tenant-a' }))
      .resolves.toEqual({ status: 'unavailable', enabled: false });
    await expect(failedClient.isEnabled('release-v2-0-feature', { tenantId: 'tenant-a' }))
      .rejects.toMatchObject({ name: 'FeatureFlagUnavailableError' });
    await expect(failedClient.isEnabledOrDefault('release-v2-0-feature', { tenantId: 'tenant-a' })).resolves.toBe(false);
  });
});
