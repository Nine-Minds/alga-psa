import { afterEach, describe, expect, it, vi } from 'vitest';

describe('isFeatureFlagEnabled', () => {
  const ORIGINAL_DISABLE = process.env.DISABLE_FEATURE_FLAGS;
  const ORIGINAL_PUBLIC_DISABLE = process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS;
  const FEATURE_FLAG_CHECKER_KEY = Symbol.for('alga.core.featureFlagChecker');

  afterEach(async () => {
    const registry = globalThis as typeof globalThis & {
      [key: symbol]: unknown;
    };
    delete registry[FEATURE_FLAG_CHECKER_KEY];

    vi.resetModules();

    if (ORIGINAL_DISABLE === undefined) {
      delete process.env.DISABLE_FEATURE_FLAGS;
    } else {
      process.env.DISABLE_FEATURE_FLAGS = ORIGINAL_DISABLE;
    }

    if (ORIGINAL_PUBLIC_DISABLE === undefined) {
      delete process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS;
    } else {
      process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS = ORIGINAL_PUBLIC_DISABLE;
    }
  });

  it('returns true when server-side feature flags are disabled via env override', async () => {
    process.env.DISABLE_FEATURE_FLAGS = 'true';

    const { isFeatureFlagEnabled } = await import('./features');

    await expect(isFeatureFlagEnabled('teams-integration-ui')).resolves.toBe(true);
  });

  it('returns true when client-style disable env is present without a registered checker', async () => {
    process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS = 'true';

    const { isFeatureFlagEnabled } = await import('./features');

    await expect(isFeatureFlagEnabled('teams-integration-ui')).resolves.toBe(true);
  });

  it('returns false when no checker is registered', async () => {
    const { isFeatureFlagEnabled } = await import('./features');

    await expect(isFeatureFlagEnabled('marketing-module')).resolves.toBe(false);
  });

  it('shares the registered checker across isolated module instances', async () => {
    const firstModule = await import('./features');
    const checker = vi.fn().mockResolvedValue(true);
    const context = {
      tenantId: 'tenant-nine-minds',
      userId: 'user-robert',
    };

    firstModule.registerFeatureFlagChecker(checker);
    vi.resetModules();

    const secondModule = await import('./features');
    await expect(
      secondModule.isFeatureFlagEnabled('marketing-module', context),
    ).resolves.toBe(true);
    expect(checker).toHaveBeenCalledWith('marketing-module', context);
  });
});
