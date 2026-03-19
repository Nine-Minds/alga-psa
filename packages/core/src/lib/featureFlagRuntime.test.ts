import { afterEach, describe, expect, it, vi } from 'vitest';

describe('FeatureFlags runtime', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('uses the shared default runtime without an external checker', async () => {
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
});
