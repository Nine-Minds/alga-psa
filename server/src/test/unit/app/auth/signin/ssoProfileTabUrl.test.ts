import { describe, expect, it } from 'vitest';
import { SSO_PROFILE_TAB_URL } from '@alga-psa/auth/lib/sso/linkStateCookie';
import { resolveUserProfileTab } from '@alga-psa/integrations/lib/calendarAvailability';

/**
 * Every SSO link outcome is carried back on this URL. Pointing it at the tab
 * *label* ("Single Sign-On") instead of the tab id lands the user on the plain
 * Profile tab, where neither the success note nor the failure banner exists.
 */
describe('SSO profile tab URL', () => {
  it('names a tab the profile page actually resolves', () => {
    const tab = new URL(SSO_PROFILE_TAB_URL, 'http://localhost').searchParams.get('tab');

    expect(tab).toBe('single-sign-on');
    expect(resolveUserProfileTab(tab, true)).toBe('single-sign-on');
    expect(resolveUserProfileTab(tab, false)).toBe('single-sign-on');
  });
});
