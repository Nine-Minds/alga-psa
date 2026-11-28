import { getVisibleUserProfileTabs } from '@alga-psa/integrations/lib/calendarAvailability';
import { surfaceAllowsProfileSection } from '@shared/services/productSurfaceKinds';

export const DASHBOARD_ONBOARDING_PROFILE_SECTION = 'dashboard-onboarding';

interface ProfileTabEligibilityInput {
  /** Principal kind of the signed-in user; absent for an ordinary MSP user. */
  surfaceKind?: string | null;
  isCalendarTabAvailable: boolean;
}

/** The profile tabs this principal may use, in display order. The first is the fallback. */
export function getEligibleProfileTabIds({ surfaceKind, isCalendarTabAvailable }: ProfileTabEligibilityInput): string[] {
  const tabs = getVisibleUserProfileTabs(isCalendarTabAvailable);
  return surfaceKind ? tabs.filter((tab) => surfaceAllowsProfileSection(surfaceKind, tab)) : tabs;
}

/**
 * The one decision behind both the rendered tabs and the `?tab=` selection: a requested tab the principal
 * may not use, or one that does not exist, resolves to Profile.
 */
export function resolveEligibleProfileTab(
  requestedTab: string | null | undefined,
  input: ProfileTabEligibilityInput,
): string {
  const eligible = getEligibleProfileTabIds(input);
  // Same normalisation as resolveUserProfileTab: links written with the human label still land on their tab.
  const normalized = requestedTab?.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (normalized && eligible.includes(normalized)) return normalized;
  return eligible[0] ?? 'profile';
}

/** Whether the principal sees the dashboard onboarding preference on the profile page. */
export function isOnboardingPreferenceEligible(surfaceKind?: string | null): boolean {
  return !surfaceKind || surfaceAllowsProfileSection(surfaceKind, DASHBOARD_ONBOARDING_PROFILE_SECTION);
}
