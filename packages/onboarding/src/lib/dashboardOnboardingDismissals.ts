import type { OnboardingStepId } from '../actions/onboarding-progress';
import { STEP_DEFINITIONS } from './stepDefinitions';

export const DASHBOARD_ONBOARDING_SETTINGS_KEY = 'dashboardOnboarding';
export const DASHBOARD_ONBOARDING_DISMISSED_STEP_IDS_KEY = 'dismissedStepIds';

const VALID_STEP_IDS = new Set<OnboardingStepId>(
  Object.keys(STEP_DEFINITIONS) as OnboardingStepId[]
);

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  return typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function isOnboardingStepId(value: unknown): value is OnboardingStepId {
  return typeof value === 'string' && VALID_STEP_IDS.has(value as OnboardingStepId);
}

export function normalizeDismissedStepIds(value: unknown): OnboardingStepId[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<OnboardingStepId>();
  const normalized: OnboardingStepId[] = [];

  for (const candidate of value) {
    if (!isOnboardingStepId(candidate) || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    normalized.push(candidate);
  }

  return normalized;
}

export function getDismissedStepIdsFromTenantSettings(settingsValue: unknown): OnboardingStepId[] {
  const settings = normalizeRecord(settingsValue);
  const dashboardOnboardingSettings = normalizeRecord(settings[DASHBOARD_ONBOARDING_SETTINGS_KEY]);
  return normalizeDismissedStepIds(
    dashboardOnboardingSettings[DASHBOARD_ONBOARDING_DISMISSED_STEP_IDS_KEY]
  );
}

export function setDismissedStepIdsInTenantSettings(
  settingsValue: unknown,
  dismissedStepIds: OnboardingStepId[]
): Record<string, unknown> {
  const settings = normalizeRecord(settingsValue);
  const dashboardOnboardingSettings = normalizeRecord(settings[DASHBOARD_ONBOARDING_SETTINGS_KEY]);

  return {
    ...settings,
    [DASHBOARD_ONBOARDING_SETTINGS_KEY]: {
      ...dashboardOnboardingSettings,
      [DASHBOARD_ONBOARDING_DISMISSED_STEP_IDS_KEY]: normalizeDismissedStepIds(dismissedStepIds),
      updatedAt: new Date().toISOString(),
    },
  };
}
