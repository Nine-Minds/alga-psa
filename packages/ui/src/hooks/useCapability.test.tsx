// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// useCapability must never reach posthog-js: fail the test if it tries.
vi.mock('posthog-js/react', () => {
  throw new Error('useCapability must not import posthog-js/react');
});
vi.mock('next-auth/react', () => {
  throw new Error('useCapability must not import next-auth/react');
});

import { FeatureFlagBootstrapProvider } from '../capability/bootstrapContext';
import { useCapability } from './useCapability';

const withBootstrap = (flags: Record<string, boolean | string>) =>
  ({ children }: { children: ReactNode }) => (
    <FeatureFlagBootstrapProvider initialFeatureFlags={flags}>{children}</FeatureFlagBootstrapProvider>
  );

describe('useCapability', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed and reports unresolved when nothing was bootstrapped', () => {
    const { result } = renderHook(() => useCapability('co-managed'));
    expect(result.current).toEqual({ enabled: false, admitted: false, resolved: false });
  });

  it('reads served and admitted from the server bootstrap', () => {
    const { result } = renderHook(() => useCapability('co-managed'), {
      wrapper: withBootstrap({ 'capability:co-managed': true, 'capability:co-managed:admit': false }),
    });
    expect(result.current).toEqual({ enabled: true, admitted: false, resolved: true });
  });

  it('does not treat the release flag alone as the capability', () => {
    const { result } = renderHook(() => useCapability('co-managed'), {
      wrapper: withBootstrap({ 'release-v2-0-feature': true }),
    });
    expect(result.current).toMatchObject({ enabled: false, admitted: false, resolved: false });
  });

  it('a bootstrapped value beats NEXT_PUBLIC_FORCE_CAPABILITIES', () => {
    vi.stubEnv('NEXT_PUBLIC_FORCE_CAPABILITIES', 'co-managed:on');
    const { result } = renderHook(() => useCapability('co-managed'), {
      wrapper: withBootstrap({ 'capability:co-managed': false, 'capability:co-managed:admit': false }),
    });
    expect(result.current.enabled).toBe(false);
  });

  it('uses NEXT_PUBLIC_FORCE_CAPABILITIES only when the bootstrap key is absent', () => {
    vi.stubEnv('NEXT_PUBLIC_FORCE_CAPABILITIES', 'co-managed:on');
    const { result } = renderHook(() => useCapability('co-managed'));
    expect(result.current).toEqual({ enabled: true, admitted: true, resolved: true });
  });

  it('a malformed public force closes', () => {
    vi.stubEnv('NEXT_PUBLIC_FORCE_CAPABILITIES', 'co-managed:maybe');
    const { result } = renderHook(() => useCapability('co-managed'));
    expect(result.current).toMatchObject({ enabled: false, admitted: false });
  });

  it('reads ticket-conversations independently of co-managed, in both directions', () => {
    const bootstrap = {
      'capability:co-managed': true,
      'capability:co-managed:admit': true,
      'capability:ticket-conversations': false,
      'capability:ticket-conversations:admit': true,
    };
    const tc = renderHook(() => useCapability('ticket-conversations'), { wrapper: withBootstrap(bootstrap) });
    const cm = renderHook(() => useCapability('co-managed'), { wrapper: withBootstrap(bootstrap) });
    expect(tc.result.current).toEqual({ enabled: false, admitted: true, resolved: true });
    expect(cm.result.current).toEqual({ enabled: true, admitted: true, resolved: true });

    const flipped = {
      'capability:co-managed': false,
      'capability:co-managed:admit': false,
      'capability:ticket-conversations': true,
      'capability:ticket-conversations:admit': true,
    };
    const tc2 = renderHook(() => useCapability('ticket-conversations'), { wrapper: withBootstrap(flipped) });
    const cm2 = renderHook(() => useCapability('co-managed'), { wrapper: withBootstrap(flipped) });
    expect(tc2.result.current).toEqual({ enabled: true, admitted: true, resolved: true });
    expect(cm2.result.current).toEqual({ enabled: false, admitted: false, resolved: true });
  });

  it('a co-managed bootstrap alone leaves ticket-conversations unresolved and closed', () => {
    const { result } = renderHook(() => useCapability('ticket-conversations'), {
      wrapper: withBootstrap({ 'capability:co-managed': true, 'capability:co-managed:admit': true, 'release-v2-0-feature': true }),
    });
    expect(result.current).toMatchObject({ enabled: false, admitted: false, resolved: false });
  });
});
