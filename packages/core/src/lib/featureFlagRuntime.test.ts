import { afterEach, describe, expect, it, vi } from 'vitest';

describe('FeatureFlags runtime', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(['undefined result', 'client error', 'missing client'])('caches %s with its unavailable status and retries after expiry', async (failure) => {
    vi.useFakeTimers();
    const { FeatureFlags } = await import('./featureFlagRuntime');
    const isFeatureEnabled = vi.fn().mockImplementation(async () => {
      if (failure === 'client error') throw new Error('PostHog unavailable');
      return undefined;
    });
    const client = { isFeatureEnabled } as any;
    const clientResolver = vi.fn(() => failure === 'missing client' ? null : client);
    const onBooleanEvaluation = vi.fn();
    const runtime = new FeatureFlags({ clientResolver, onBooleanEvaluation, cacheTtlMs: 60_000 });
    const context = { tenantId: 'tenant-a' };

    for (let request = 0; request < 5; request++) {
      await expect(runtime.evaluate('enable_time_tracking', context)).resolves.toEqual({ status: 'unavailable', enabled: true });
      await expect(runtime.isEnabled('enable_time_tracking', context)).resolves.toBe(true);
    }
    expect(clientResolver).toHaveBeenCalledTimes(1);
    expect(onBooleanEvaluation).not.toHaveBeenCalled();

    clientResolver.mockReturnValue(client);
    isFeatureEnabled.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(60_001);
    await expect(runtime.evaluate('enable_time_tracking', context)).resolves.toEqual({ status: 'evaluated', enabled: false });
    await expect(runtime.isEnabled('enable_time_tracking', context)).resolves.toBe(false);
    expect(clientResolver).toHaveBeenCalledTimes(2);
    expect(onBooleanEvaluation).toHaveBeenCalledTimes(1);
  });

  it('shares concurrent evaluations without conflating tenants or bypassing overrides', async () => {
    const { FeatureFlags } = await import('./featureFlagRuntime');
    let finish!: (value: undefined) => void;
    const isFeatureEnabled = vi.fn(() => new Promise<undefined>((resolve) => { finish = resolve; }));
    const runtime = new FeatureFlags({ clientResolver: () => ({ isFeatureEnabled } as any) });
    const context = { tenantId: 'tenant-a' };
    const requests = [runtime.evaluate('release-v2-0-feature', context), runtime.isEnabled('release-v2-0-feature', context)];
    await vi.waitFor(() => expect(isFeatureEnabled).toHaveBeenCalledTimes(1));
    finish(undefined);
    await expect(Promise.all(requests)).resolves.toEqual([{ status: 'unavailable', enabled: false }, false]);

    runtime.setOverride('release-v2-0-feature', true);
    await expect(runtime.evaluate('release-v2-0-feature', context)).resolves.toEqual({ status: 'evaluated', enabled: true });
    runtime.clearOverride('release-v2-0-feature');
    isFeatureEnabled.mockImplementation(async () => undefined);
    await runtime.evaluate('release-v2-0-feature', { tenantId: 'tenant-b' });
    expect(isFeatureEnabled).toHaveBeenCalledTimes(2);
    runtime.clearCache();
    await runtime.evaluate('release-v2-0-feature', context);
    expect(isFeatureEnabled).toHaveBeenCalledTimes(3);
  });

  it('does not restore a cleared cache when an older evaluation completes', async () => {
    const { FeatureFlags } = await import('./featureFlagRuntime');
    let finish!: (value: boolean) => void;
    const isFeatureEnabled = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }))
      .mockResolvedValue(true);
    const runtime = new FeatureFlags({ clientResolver: () => ({ isFeatureEnabled } as any) });
    const context = { tenantId: 'tenant-a' };
    const older = runtime.evaluate('release-v2-0-feature', context);
    await vi.waitFor(() => expect(isFeatureEnabled).toHaveBeenCalledTimes(1));
    runtime.clearCache();
    await expect(runtime.isEnabled('release-v2-0-feature', context)).resolves.toBe(true);
    finish(false);
    await older;
    await expect(runtime.isEnabled('release-v2-0-feature', context)).resolves.toBe(true);
    expect(isFeatureEnabled).toHaveBeenCalledTimes(2);
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
      runtime.isEnabled('ai-assistant-activation', {
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
      runtime.isEnabled('ai-assistant-activation', {
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
    await expect(failedClient.isEnabled('release-v2-0-feature', { tenantId: 'tenant-a' })).resolves.toBe(false);
  });

  it.each(['missing client', 'undefined result', 'client error'])('preserves boolean defaults without losing unavailable status on %s', async (failure) => {
    const { FeatureFlags } = await import('./featureFlagRuntime');
    const runtime = new FeatureFlags({ clientResolver: () => failure === 'missing client' ? null : ({
      isFeatureEnabled: async () => {
        if (failure === 'client error') throw new Error('PostHog unavailable');
        return undefined;
      },
    } as any) });
    const context = { tenantId: 'tenant-a' };

    // Existing callers keep their flag-specific defaults, including defaults that enable a feature.
    await expect(runtime.isEnabled('enable_time_tracking', context)).resolves.toBe(true);
    await expect(runtime.isEnabled('release-v2-0-feature', context)).resolves.toBe(false);
    // Gates receive the evaluation status independently of those fallback values.
    await expect(runtime.evaluate('enable_time_tracking', context)).resolves.toEqual({ status: 'unavailable', enabled: true });
    await expect(runtime.evaluate('release-v2-0-feature', context)).resolves.toEqual({ status: 'unavailable', enabled: false });
  });
});
