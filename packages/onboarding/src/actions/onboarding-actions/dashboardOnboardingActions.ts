'use server';

import { revalidatePath } from 'next/cache';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { getTenantSettings, updateTenantSettings } from '@alga-psa/tenancy/actions';
import type { OnboardingStepId } from '../onboarding-progress';
import type { OnboardingActionResult } from './onboardingActions';
import {
  DASHBOARD_ONBOARDING_SETTINGS_KEY,
  getDismissedStepIdsFromTenantSettings,
  isOnboardingStepId,
  setDismissedStepIdsInTenantSettings,
} from '../../lib/dashboardOnboardingDismissals';

export interface DashboardOnboardingDismissalResult extends OnboardingActionResult {
  data?: {
    dismissedStepIds: OnboardingStepId[];
  };
}

async function getDismissedStepIds(): Promise<OnboardingStepId[]> {
  const tenantSettings = await getTenantSettings();
  return getDismissedStepIdsFromTenantSettings(tenantSettings?.settings);
}

async function saveDismissedStepIds(nextDismissedStepIds: OnboardingStepId[]): Promise<void> {
  const tenantSettings = await getTenantSettings();
  const mergedSettings = setDismissedStepIdsInTenantSettings(
    tenantSettings?.settings,
    nextDismissedStepIds
  );

  await updateTenantSettings({
    [DASHBOARD_ONBOARDING_SETTINGS_KEY]: mergedSettings[DASHBOARD_ONBOARDING_SETTINGS_KEY],
  });
  revalidatePath('/msp/dashboard');
}

export const dismissDashboardOnboardingStep = withAuth(async (
  _user: IUserWithRoles,
  _context: AuthContext,
  stepId: OnboardingStepId
): Promise<DashboardOnboardingDismissalResult> => {
  try {
    if (!isOnboardingStepId(stepId)) {
      return { success: false, error: 'Invalid onboarding step id.' };
    }

    const dismissedStepIds = await getDismissedStepIds();

    if (dismissedStepIds.includes(stepId)) {
      return { success: true, data: { dismissedStepIds } };
    }

    const nextDismissedStepIds = [...dismissedStepIds, stepId];
    await saveDismissedStepIds(nextDismissedStepIds);

    return { success: true, data: { dismissedStepIds: nextDismissedStepIds } };
  } catch (error) {
    console.error('Error dismissing dashboard onboarding step:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

export const restoreDashboardOnboardingStep = withAuth(async (
  _user: IUserWithRoles,
  _context: AuthContext,
  stepId: OnboardingStepId
): Promise<DashboardOnboardingDismissalResult> => {
  try {
    if (!isOnboardingStepId(stepId)) {
      return { success: false, error: 'Invalid onboarding step id.' };
    }

    const dismissedStepIds = await getDismissedStepIds();
    const nextDismissedStepIds = dismissedStepIds.filter((id) => id !== stepId);

    if (nextDismissedStepIds.length === dismissedStepIds.length) {
      return { success: true, data: { dismissedStepIds } };
    }

    await saveDismissedStepIds(nextDismissedStepIds);

    return { success: true, data: { dismissedStepIds: nextDismissedStepIds } };
  } catch (error) {
    console.error('Error restoring dashboard onboarding step:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

export const getDismissedDashboardOnboardingSteps = withAuth(async (
  _user: IUserWithRoles,
  _context: AuthContext
): Promise<OnboardingStepId[]> => {
  try {
    return await getDismissedStepIds();
  } catch (error) {
    console.error('Error loading dismissed dashboard onboarding steps:', error);
    return [];
  }
});
