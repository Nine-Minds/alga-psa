'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { revalidatePath } from 'next/cache';

const SETTING_NAME = 'dashboardOnboardingSectionDismissed';
// LEVERAGE: pattern dashboard-card-dismissal — mirrors the per-user mobile dashboard card preference.

export interface DashboardOnboardingSectionResult {
  success: boolean;
  error?: string;
  data?: { dismissed: boolean };
}

export const getDashboardOnboardingSectionDismissedAction = withAuth(async (
  user,
  { tenant }
): Promise<DashboardOnboardingSectionResult> => {
  try {
    const { knex } = await createTenantKnex();
    const pref = await tenantDb(knex, tenant)
      .table('user_preferences')
      .where({ user_id: user.user_id, setting_name: SETTING_NAME })
      .first();
    const value = pref?.setting_value;
    return { success: true, data: { dismissed: value === true || value === 'true' } };
  } catch (error) {
    console.error('Error loading dashboard onboarding section preference:', error);
    return { success: false, error: 'Failed to load onboarding section preference.' };
  }
});

export const dismissDashboardOnboardingSectionAction = withAuth(async (
  user,
  { tenant }
): Promise<DashboardOnboardingSectionResult> => {
  try {
    const { knex } = await createTenantKnex();
    // Compute timestamp before query - CitusDB requires IMMUTABLE values in ON CONFLICT UPDATE
    const now = new Date();
    await tenantDb(knex, tenant)
      .table('user_preferences')
      .insert({
        tenant,
        user_id: user.user_id,
        setting_name: SETTING_NAME,
        setting_value: JSON.stringify(true),
        updated_at: now,
      })
      .onConflict(['tenant', 'user_id', 'setting_name'])
      .merge({ setting_value: JSON.stringify(true), updated_at: now });
    revalidatePath('/msp/dashboard');
    return { success: true, data: { dismissed: true } };
  } catch (error) {
    console.error('Error dismissing dashboard onboarding section:', error);
    return { success: false, error: 'Failed to hide onboarding section.' };
  }
});

export const restoreDashboardOnboardingSectionAction = withAuth(async (
  user,
  { tenant }
): Promise<DashboardOnboardingSectionResult> => {
  try {
    const { knex } = await createTenantKnex();
    await tenantDb(knex, tenant)
      .table('user_preferences')
      .where({ user_id: user.user_id, setting_name: SETTING_NAME })
      .delete();
    revalidatePath('/msp/dashboard');
    return { success: true, data: { dismissed: false } };
  } catch (error) {
    console.error('Error restoring dashboard onboarding section:', error);
    return { success: false, error: 'Failed to restore onboarding section.' };
  }
});
