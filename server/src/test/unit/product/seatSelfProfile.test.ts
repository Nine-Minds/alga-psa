import { describe, expect, it } from 'vitest';
import { resolveProductRouteBehavior } from '../../../lib/productSurfaceRegistry';
import {
  CO_MANAGED_SEAT_SURFACE,
  PROFILE_ONBOARDING_PREFERENCE,
  surfaceAllowsProfileSection,
} from '@shared/services/productSurfaceKinds';
import { resolveProfileTabs } from '../../../components/settings/profile/profileTabEligibility';

const seat = { productCode: 'psa' as const, surfaceKind: CO_MANAGED_SEAT_SURFACE };
const ordinary = { productCode: 'psa' as const };

describe('seat self-profile route policy', () => {
  it('opens only the profile route for a seat', () => {
    expect(resolveProductRouteBehavior(seat, '/msp/profile')).toBe('allowed');
    expect(resolveProductRouteBehavior(seat, '/msp/profile?tab=api-keys')).toBe('allowed');
    for (const route of ['/msp/settings', '/msp/settings/users', '/msp/profiles', '/msp/billing', '/msp/dashboard-x']) {
      expect(resolveProductRouteBehavior(seat, route), route).toBe('not_found');
    }
  });

  it('allows profile and user administration for an ordinary principal', () => {
    expect(resolveProductRouteBehavior(ordinary, '/msp/profile')).toBe('allowed');
    expect(resolveProductRouteBehavior(ordinary, '/msp/settings/users')).toBe('allowed');
  });
});

describe('profile tab eligibility', () => {
  it('keeps every tab for an ordinary principal', () => {
    const { eligibleTabs, activeTab } = resolveProfileTabs({ isCalendarTabAvailable: true, requestedTab: 'api-keys' });
    expect(eligibleTabs).toEqual(['profile', 'security', 'single-sign-on', 'api-keys', 'notifications', 'keyboard-shortcuts', 'calendar']);
    expect(activeTab).toBe('api-keys');
  });

  it('offers a seat no API Keys, SSO or calendar tab and resolves their deep links to Profile', () => {
    for (const requested of ['api-keys', 'API Keys', 'single-sign-on', 'calendar']) {
      const { eligibleTabs, activeTab } = resolveProfileTabs({ surfaceKind: CO_MANAGED_SEAT_SURFACE, isCalendarTabAvailable: true, requestedTab: requested });
      expect(eligibleTabs).toEqual(['profile', 'security', 'notifications', 'keyboard-shortcuts']);
      expect(activeTab, requested).toBe('profile');
    }
    expect(resolveProfileTabs({ surfaceKind: CO_MANAGED_SEAT_SURFACE, isCalendarTabAvailable: false, requestedTab: 'security' }).activeTab).toBe('security');
  });

  it('treats an unregistered kind as profile-only and hides the onboarding control from a seat', () => {
    expect(resolveProfileTabs({ surfaceKind: 'unknown_kind', isCalendarTabAvailable: false }).eligibleTabs).toEqual(['profile']);
    expect(surfaceAllowsProfileSection(CO_MANAGED_SEAT_SURFACE, PROFILE_ONBOARDING_PREFERENCE)).toBe(false);
    expect(surfaceAllowsProfileSection(null, PROFILE_ONBOARDING_PREFERENCE)).toBe(true);
  });
});
