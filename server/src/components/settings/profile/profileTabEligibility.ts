import { getVisibleUserProfileTabs, resolveUserProfileTab } from '@alga-psa/integrations/lib/calendarAvailability';
import { surfaceAllowsProfileSection } from '@shared/services/productSurfaceKinds';

export interface ProfileTabEligibilityInput {
  /** The principal's surface kind; absent or null for an ordinary MSP user. */
  surfaceKind?: string | null;
  isCalendarTabAvailable: boolean;
  requestedTab?: string | null;
}

/**
 * The one eligibility decision for the profile page, per principal. Both the rendered tab navigation and the
 * `?tab=` selection read it, so a tab that is not offered can never be selected by URL (and never mounts).
 */
export function resolveProfileTabs(input: ProfileTabEligibilityInput) {
  const eligibleTabs = getVisibleUserProfileTabs(input.isCalendarTabAvailable)
    .filter((tab) => surfaceAllowsProfileSection(input.surfaceKind, tab));
  const resolved = resolveUserProfileTab(input.requestedTab, input.isCalendarTabAvailable);
  const activeTab = eligibleTabs.includes(resolved) ? resolved : 'profile';
  return { eligibleTabs, activeTab };
}
