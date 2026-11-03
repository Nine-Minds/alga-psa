'use server';

import { revalidatePath } from 'next/cache';
import { withAuth, hasPermission, type AuthContext } from '@alga-psa/auth';
import { isLicensedUserType, type IUserWithRoles } from '@alga-psa/types';
import { getTenantSettings } from '@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions';
import { mergeTenantSettingsJson } from '@alga-psa/tenancy/server/tenantSettingsStore';
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

async function saveDismissedStepIds(tenant: string, nextDismissedStepIds: OnboardingStepId[]): Promise<void> {
  const tenantSettings = await getTenantSettings();
  const mergedSettings = setDismissedStepIdsInTenantSettings(
    tenantSettings?.settings,
    nextDismissedStepIds
  );

  await mergeTenantSettingsJson(tenant, {
    [DASHBOARD_ONBOARDING_SETTINGS_KEY]: mergedSettings[DASHBOARD_ONBOARDING_SETTINGS_KEY],
  });
  revalidatePath('/msp/dashboard');
}

function dashboardOnboardingActionErrorMessage(_error: unknown, fallback: string): string {
  return fallback;
}

export const dismissDashboardOnboardingStep = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  stepId: OnboardingStepId
): Promise<DashboardOnboardingDismissalResult> => {
  try {
    if (!isOnboardingStepId(stepId)) {
      return { success: false, error: 'Invalid onboarding step id.' };
    }
    if (!isLicensedUserType(user.user_type) || !(await hasPermission(user, 'settings', 'update'))) return { success: false, error: 'Permission denied.' };

    const dismissedStepIds = await getDismissedStepIds();

    if (dismissedStepIds.includes(stepId)) {
      return { success: true, data: { dismissedStepIds } };
    }

    const nextDismissedStepIds = [...dismissedStepIds, stepId];
    await saveDismissedStepIds(tenant, nextDismissedStepIds);

    return { success: true, data: { dismissedStepIds: nextDismissedStepIds } };
  } catch (error) {
    console.error('Error dismissing dashboard onboarding step:', error);
    return { success: false, error: dashboardOnboardingActionErrorMessage(error, 'Failed to dismiss onboarding step') };
  }
});

export const restoreDashboardOnboardingStep = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  stepId: OnboardingStepId
): Promise<DashboardOnboardingDismissalResult> => {
  try {
    if (!isOnboardingStepId(stepId)) {
      return { success: false, error: 'Invalid onboarding step id.' };
    }
    if (!isLicensedUserType(user.user_type) || !(await hasPermission(user, 'settings', 'update'))) return { success: false, error: 'Permission denied.' };

    const dismissedStepIds = await getDismissedStepIds();
    const nextDismissedStepIds = dismissedStepIds.filter((id) => id !== stepId);

    if (nextDismissedStepIds.length === dismissedStepIds.length) {
      return { success: true, data: { dismissedStepIds } };
    }

    await saveDismissedStepIds(tenant, nextDismissedStepIds);

    return { success: true, data: { dismissedStepIds: nextDismissedStepIds } };
  } catch (error) {
    console.error('Error restoring dashboard onboarding step:', error);
    return { success: false, error: dashboardOnboardingActionErrorMessage(error, 'Failed to restore onboarding step') };
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
