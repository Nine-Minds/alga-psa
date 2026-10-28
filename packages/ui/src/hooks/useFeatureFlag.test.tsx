// @vitest-environment jsdom

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

  it('uses the server-bootstrapped value and never asks PostHog for it', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FeatureFlagBootstrapProvider initialFeatureFlags={{ 'sample-bootstrapped-flag': true }}>
        {children}
      </FeatureFlagBootstrapProvider>
    );

    const { result } = renderHook(
      () => useFeatureFlag('sample-bootstrapped-flag', { defaultValue: false }),
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

  it('reports an unresolved flag when PostHog has not loaded flags, and resolved once it answers', async () => {
    // A blocked or unreachable PostHog answers undefined; that is not the flag being off.
    posthog.isFeatureEnabled.mockReturnValueOnce(undefined as unknown as boolean);
    const { result } = renderHook(() => useFeatureFlag('sample-unbootstrapped-flag', { defaultValue: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current).toMatchObject({ enabled: false, loading: false, resolved: false });

    posthog.isFeatureEnabled.mockReturnValueOnce(false);
    const answered = renderHook(() => useFeatureFlag('sample-unbootstrapped-flag', { defaultValue: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(answered.result.current).toMatchObject({ enabled: false, loading: false, resolved: true });
  });

  it('treats a bootstrapped flag as resolved', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FeatureFlagBootstrapProvider initialFeatureFlags={{ 'sample-bootstrapped-flag': false }}>
        {children}
      </FeatureFlagBootstrapProvider>
    );
    const { result } = renderHook(() => useFeatureFlag('sample-bootstrapped-flag', { defaultValue: true }), { wrapper });
    expect(result.current).toMatchObject({ enabled: false, resolved: true });
  });

  it('a bootstrapped flag is server-decided: a later PostHog update for another subject cannot flip it', async () => {
    // posthog-js evaluates for the person; the server bootstrapped the tenant's
    // value. A person/percentage/group rule can disagree, and the hook must not
    // flip the first-paint value on hydration.
    posthog.isFeatureEnabled.mockReturnValue(false);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FeatureFlagBootstrapProvider initialFeatureFlags={{ 'sample-bootstrapped-flag': true }}>
        {children}
      </FeatureFlagBootstrapProvider>
    );

    const { result } = renderHook(
      () => useFeatureFlag('sample-bootstrapped-flag', { defaultValue: false }),
      { wrapper }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(result.current).toMatchObject({ enabled: true, resolved: true, loading: false });
    expect(posthog.onFeatureFlags).not.toHaveBeenCalled();
    expect(posthog.isFeatureEnabled).not.toHaveBeenCalled();
    posthog.isFeatureEnabled.mockReset();
    posthog.isFeatureEnabled.mockImplementation(() => false);
  });

  it('a flag the server did not bootstrap still follows later PostHog updates', async () => {
    let deliverFeatureFlags: (() => void) | undefined;
    posthog.onFeatureFlags.mockImplementationOnce((callback: () => void) => {
      deliverFeatureFlags = callback;
      return vi.fn();
    });
    posthog.isFeatureEnabled.mockReturnValue(true);

    const { result } = renderHook(() => useFeatureFlag('sample-unbootstrapped-flag', { defaultValue: false }));
    await act(async () => {
      deliverFeatureFlags?.();
    });
    expect(result.current.enabled).toBe(true);

    posthog.isFeatureEnabled.mockReturnValue(false);
    await act(async () => {
      deliverFeatureFlags?.();
    });
    expect(result.current.enabled).toBe(false);
    expect(posthog.isFeatureEnabled).toHaveBeenCalledWith('sample-unbootstrapped-flag');
    posthog.isFeatureEnabled.mockReset();
    posthog.isFeatureEnabled.mockImplementation(() => false);
  });
});
