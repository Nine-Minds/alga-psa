import { describe, expect, it } from 'vitest';
import {
  CALENDAR_PROFILE_TAB,
  CALENDAR_SETTINGS_CATEGORY,
  getVisibleIntegrationCategoryIds,
  getVisibleUserProfileTabs,
  isCalendarEnterpriseEdition,
  resolveIntegrationSettingsCategory,
  resolveUserProfileTab,
} from './calendarAvailability';

describe('calendarAvailability', () => {
  it('treats only enterprise editions as calendar-enabled', () => {
    expect(isCalendarEnterpriseEdition({ EDITION: 'ee' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isCalendarEnterpriseEdition({ EDITION: 'enterprise' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isCalendarEnterpriseEdition({ NEXT_PUBLIC_EDITION: 'enterprise' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isCalendarEnterpriseEdition({ EDITION: 'ce', NEXT_PUBLIC_EDITION: 'community' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it('omits Calendar from visible settings categories in CE and keeps it in EE', () => {
    expect(getVisibleIntegrationCategoryIds(false)).not.toContain(CALENDAR_SETTINGS_CATEGORY);
    expect(getVisibleIntegrationCategoryIds(true)).toContain(CALENDAR_SETTINGS_CATEGORY);
  });

  it('falls back CE calendar category requests to the first shared category', () => {
    expect(resolveIntegrationSettingsCategory(CALENDAR_SETTINGS_CATEGORY, false)).toBe('accounting');
    expect(resolveIntegrationSettingsCategory(CALENDAR_SETTINGS_CATEGORY, true)).toBe(CALENDAR_SETTINGS_CATEGORY);
    expect(resolveIntegrationSettingsCategory('providers', false)).toBe('providers');
  });

  it('omits the Calendar profile tab in CE and preserves it in EE', () => {
    expect(getVisibleUserProfileTabs(false)).not.toContain(CALENDAR_PROFILE_TAB);
    expect(getVisibleUserProfileTabs(true)).toContain(CALENDAR_PROFILE_TAB);
  });

  it('falls back CE profile tab requests while preserving the Calendar tab in EE', () => {
    expect(resolveUserProfileTab(CALENDAR_PROFILE_TAB, false)).toBe('profile');
    expect(resolveUserProfileTab(CALENDAR_PROFILE_TAB, true)).toBe(CALENDAR_PROFILE_TAB);
    expect(resolveUserProfileTab('notifications', false)).toBe('notifications');
  });
});
