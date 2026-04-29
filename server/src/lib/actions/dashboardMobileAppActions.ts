'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';

const SETTING_NAME = 'dashboardMobileAppCardDismissed';

export const getDashboardMobileAppCardDismissedAction = withAuth(async (
  user,
  { tenant }
): Promise<boolean> => {
  const { knex } = await createTenantKnex();
  const pref = await knex('user_preferences')
    .where({ tenant, user_id: user.user_id, setting_name: SETTING_NAME })
    .first();

  if (!pref?.setting_value) return false;
  const value = typeof pref.setting_value === 'string'
    ? pref.setting_value.replace(/"/g, '')
    : pref.setting_value;
  return value === true || value === 'true';
});

export const dismissDashboardMobileAppCardAction = withAuth(async (
  user,
  { tenant }
): Promise<{ success: true }> => {
  const { knex } = await createTenantKnex();
  // Compute timestamp before query - CitusDB requires IMMUTABLE values in ON CONFLICT UPDATE
  const now = new Date();
  await knex('user_preferences')
    .insert({
      tenant,
      user_id: user.user_id,
      setting_name: SETTING_NAME,
      setting_value: JSON.stringify(true),
      updated_at: now,
    })
    .onConflict(['tenant', 'user_id', 'setting_name'])
    .merge({
      setting_value: JSON.stringify(true),
      updated_at: now,
    });

  return { success: true };
});

export const restoreDashboardMobileAppCardAction = withAuth(async (
  user,
  { tenant }
): Promise<{ success: true }> => {
  const { knex } = await createTenantKnex();
  await knex('user_preferences')
    .where({ tenant, user_id: user.user_id, setting_name: SETTING_NAME })
    .delete();

  return { success: true };
});
