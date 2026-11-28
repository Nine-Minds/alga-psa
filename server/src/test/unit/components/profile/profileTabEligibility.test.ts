import { describe, expect, it } from 'vitest';
import { CO_MANAGED_SEAT_SURFACE, surfaceAllowsProfileSection } from '@shared/services/productSurfaceKinds';
import {
  getEligibleProfileTabIds,
  isOnboardingPreferenceEligible,
  resolveEligibleProfileTab,
} from '@/components/settings/profile/profileTabEligibility';

const seat = { surfaceKind: CO_MANAGED_SEAT_SURFACE, isCalendarTabAvailable: true };
const ordinary = { surfaceKind: null, isCalendarTabAvailable: true };

describe('profile tab eligibility', () => {
  it('omits API Keys from a seat technician', () => {
    const tabs = getEligibleProfileTabIds(seat);
    expect(tabs).not.toContain('api-keys');
    expect(tabs[0]).toBe('profile');
  });

  it.each(['api-keys', 'API Keys', 'unknown', '', null, undefined, 'single-sign-on', 'calendar'])(
    'resolves %s to Profile for a seat technician', (requested) => {
      expect(resolveEligibleProfileTab(requested, seat)).toBe('profile');
    });

  it('keeps a tab the seat may use', () => {
    expect(resolveEligibleProfileTab('notifications', seat)).toBe('notifications');
  });

  it('gives an ordinary user API Keys, and the same link opens it', () => {
    expect(getEligibleProfileTabIds(ordinary)).toContain('api-keys');
    expect(resolveEligibleProfileTab('api-keys', ordinary)).toBe('api-keys');
    expect(resolveEligibleProfileTab('API Keys', ordinary)).toBe('api-keys');
    expect(resolveEligibleProfileTab('unknown', ordinary)).toBe('profile');
  });

  it('closes an unregistered kind rather than opening it', () => {
    expect(surfaceAllowsProfileSection('not_a_kind', 'profile')).toBe(false);
    expect(resolveEligibleProfileTab('security', { surfaceKind: 'not_a_kind', isCalendarTabAvailable: false })).toBe('profile');
  });

  it('hides the onboarding preference from a seat only', () => {
    expect(isOnboardingPreferenceEligible(CO_MANAGED_SEAT_SURFACE)).toBe(false);
    expect(isOnboardingPreferenceEligible(null)).toBe(true);
  });
});
