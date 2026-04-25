/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADD_ONS, TIER_FEATURES } from '@alga-psa/types';
import { TierProvider, useTier } from '../../../context/TierContext';

const useSession = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: (...args: unknown[]) => useSession(...args),
}));

describe('TierContext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    useSession.mockReturnValue({
      status: 'authenticated',
      update: vi.fn(),
      data: {
        user: {
          plan: 'pro',
          addons: [],
          subscription_status: 'active',
        },
      },
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <TierProvider>{children}</TierProvider>
  );

  it('provides isSolo=true when tier is solo', () => {
    useSession.mockReturnValue({
      status: 'authenticated',
      update: vi.fn(),
      data: { user: { plan: 'solo', addons: [] } },
    });

    const { result } = renderHook(() => useTier(), { wrapper });

    expect(result.current.isSolo).toBe(true);
    expect(result.current.tier).toBe('solo');
  });

  it('provides isSolo=false when tier is pro', () => {
    const { result } = renderHook(() => useTier(), { wrapper });

    expect(result.current.isSolo).toBe(false);
    expect(result.current.tier).toBe('pro');
  });

  it('grants solo tenants access to WORKFLOW_DESIGNER (now unlocked at solo)', () => {
    useSession.mockReturnValue({
      status: 'authenticated',
      update: vi.fn(),
      data: { user: { plan: 'solo', addons: [] } },
    });

    const { result } = renderHook(() => useTier(), { wrapper });

    expect(result.current.hasFeature(TIER_FEATURES.WORKFLOW_DESIGNER)).toBe(true);
  });

  it('provides addOns from the session', () => {
    useSession.mockReturnValue({
      status: 'authenticated',
      update: vi.fn(),
      data: { user: { plan: 'solo', addons: [ADD_ONS.AI_ASSISTANT] } },
    });

    const { result } = renderHook(() => useTier(), { wrapper });

    expect(result.current.addOns).toEqual([ADD_ONS.AI_ASSISTANT]);
  });

  it('hasAddOn returns true when the add-on is present', () => {
    useSession.mockReturnValue({
      status: 'authenticated',
      update: vi.fn(),
      data: { user: { plan: 'solo', addons: [ADD_ONS.AI_ASSISTANT] } },
    });

    const { result } = renderHook(() => useTier(), { wrapper });

    expect(result.current.hasAddOn(ADD_ONS.AI_ASSISTANT)).toBe(true);
  });

  it('hasAddOn returns false when the add-on is missing', () => {
    const { result } = renderHook(() => useTier(), { wrapper });

    expect(result.current.hasAddOn(ADD_ONS.AI_ASSISTANT)).toBe(false);
  });

  it('CE edition unlocks all add-ons and tier features', () => {
    process.env.NEXT_PUBLIC_EDITION = 'ce';
    useSession.mockReturnValue({
      status: 'authenticated',
      update: vi.fn(),
      data: { user: { plan: 'solo', addons: [] } },
    });

    const { result } = renderHook(() => useTier(), { wrapper });

    expect(result.current.hasAddOn(ADD_ONS.AI_ASSISTANT)).toBe(true);
    expect(result.current.hasFeature(TIER_FEATURES.ENTRA_SYNC)).toBe(true);
  });

  it('unlocks Pro-tier features during an active Solo -> Pro trial', () => {
    useSession.mockReturnValue({
      status: 'authenticated',
      update: vi.fn(),
      data: {
        user: {
          plan: 'solo',
          addons: [],
          solo_pro_trial_end: '2099-04-25T00:00:00.000Z',
        },
      },
    });

    const { result } = renderHook(() => useTier(), { wrapper });

    expect(result.current.isSoloProTrial).toBe(true);
    // TEAMS_INTEGRATION is gated at Pro+, so the trial should unlock it
    // for Solo tenants while the trial is active.
    expect(result.current.hasFeature(TIER_FEATURES.TEAMS_INTEGRATION)).toBe(true);
  });

  it('reverts Solo -> Pro trial feature access after the trial end passes', () => {
    useSession.mockReturnValue({
      status: 'authenticated',
      update: vi.fn(),
      data: {
        user: {
          plan: 'solo',
          addons: [],
          solo_pro_trial_end: '2000-04-25T00:00:00.000Z',
        },
      },
    });

    const { result } = renderHook(() => useTier(), { wrapper });

    expect(result.current.isSoloProTrial).toBe(false);
    // Once the trial expires, Solo loses access to the still-gated
    // TEAMS_INTEGRATION feature.
    expect(result.current.hasFeature(TIER_FEATURES.TEAMS_INTEGRATION)).toBe(false);
  });
});
