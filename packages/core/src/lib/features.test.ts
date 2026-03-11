import { afterEach, describe, expect, it, vi } from 'vitest';

describe('isFeatureFlagEnabled', () => {
  const ORIGINAL_DISABLE = process.env.DISABLE_FEATURE_FLAGS;
  const ORIGINAL_PUBLIC_DISABLE = process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS;

  afterEach(async () => {
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
});
