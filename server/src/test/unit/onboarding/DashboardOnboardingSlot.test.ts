import { describe, expect, it } from 'vitest';
import { shouldHideCompletedOnboardingSection } from '../../../../../packages/onboarding/src/components/dashboard/DashboardOnboardingSlot';

describe('shouldHideCompletedOnboardingSection', () => {
  it('hides only a completed section with a saved dismissal', () => {
    expect(shouldHideCompletedOnboardingSection(true, true)).toBe(true);
    expect(shouldHideCompletedOnboardingSection(false, true)).toBe(false);
    expect(shouldHideCompletedOnboardingSection(true, false)).toBe(false);
    expect(shouldHideCompletedOnboardingSection(false, false)).toBe(false);
  });
});
