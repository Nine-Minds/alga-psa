export const CALENDAR_SETTINGS_CATEGORY = 'calendar';
export const CALENDAR_PROFILE_TAB = 'Calendar';

const BASE_INTEGRATION_CATEGORY_IDS = [
  'accounting',
  'rmm',
  'communication',
  'providers',
  'identity',
  'payments',
] as const;

const BASE_PROFILE_TABS = ['Profile', 'Security', 'Single Sign-On', 'API Keys', 'Notifications'] as const;

export function isCalendarEnterpriseEdition(env: NodeJS.ProcessEnv = process.env): boolean {
  const edition = (env.EDITION ?? '').toLowerCase();
  const publicEdition = (env.NEXT_PUBLIC_EDITION ?? '').toLowerCase();

  return edition === 'ee' || edition === 'enterprise' || publicEdition === 'enterprise';
}

export function getVisibleIntegrationCategoryIds(isEnterpriseEdition = isCalendarEnterpriseEdition()): string[] {
  return isEnterpriseEdition
    ? [
        ...BASE_INTEGRATION_CATEGORY_IDS.slice(0, 3),
        CALENDAR_SETTINGS_CATEGORY,
        ...BASE_INTEGRATION_CATEGORY_IDS.slice(3),
      ]
    : [...BASE_INTEGRATION_CATEGORY_IDS];
}

export function resolveIntegrationSettingsCategory(
  requestedCategory: string | null | undefined,
  isEnterpriseEdition = isCalendarEnterpriseEdition()
): string {
  const visibleCategoryIds = getVisibleIntegrationCategoryIds(isEnterpriseEdition);

  if (requestedCategory && visibleCategoryIds.includes(requestedCategory)) {
    return requestedCategory;
  }

  return visibleCategoryIds[0] ?? 'accounting';
}

export function getVisibleUserProfileTabs(isEnterpriseEdition = isCalendarEnterpriseEdition()): string[] {
  return isEnterpriseEdition ? [...BASE_PROFILE_TABS, CALENDAR_PROFILE_TAB] : [...BASE_PROFILE_TABS];
}

export function resolveUserProfileTab(
  requestedTab: string | null | undefined,
  isEnterpriseEdition = isCalendarEnterpriseEdition()
): string {
  const visibleTabs = getVisibleUserProfileTabs(isEnterpriseEdition);

  if (requestedTab && visibleTabs.includes(requestedTab)) {
    return requestedTab;
  }

  return visibleTabs[0] ?? 'Profile';
}
