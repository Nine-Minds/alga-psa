import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const posthog = {
  isFeatureEnabled: vi.fn(() => false),
  onFeatureFlags: vi.fn((_callback: () => void) => vi.fn()),
};

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null }),
}));

vi.mock('posthog-js/react', () => ({
  usePostHog: () => posthog,
}));

import { FeatureFlagBootstrapProvider, useFeatureFlag } from './useFeatureFlag';

describe('useFeatureFlag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    posthog.isFeatureEnabled.mockClear();
    posthog.onFeatureFlags.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the server-bootstrapped value until PostHog delivers an update', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FeatureFlagBootstrapProvider initialFeatureFlags={{ 'project-billing-ui': true }}>
        {children}
      </FeatureFlagBootstrapProvider>
    );

    const { result } = renderHook(
      () => useFeatureFlag('project-billing-ui', { defaultValue: false }),
      { wrapper }
    );

    expect(result.current).toMatchObject({ enabled: true, loading: false, error: null });
    expect(posthog.isFeatureEnabled).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(result.current.enabled).toBe(true);
    expect(posthog.isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('accepts later PostHog flag updates after the bootstrapped render', async () => {
    let deliverFeatureFlags: (() => void) | undefined;
    posthog.onFeatureFlags.mockImplementationOnce((callback: () => void) => {
      deliverFeatureFlags = callback;
      return vi.fn();
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <FeatureFlagBootstrapProvider initialFeatureFlags={{ 'project-billing-ui': true }}>
        {children}
      </FeatureFlagBootstrapProvider>
    );

    const { result } = renderHook(
      () => useFeatureFlag('project-billing-ui', { defaultValue: false }),
      { wrapper }
    );

    await act(async () => {
      deliverFeatureFlags?.();
    });

    expect(result.current.enabled).toBe(false);
    expect(posthog.isFeatureEnabled).toHaveBeenCalledWith('project-billing-ui');
  });
});
