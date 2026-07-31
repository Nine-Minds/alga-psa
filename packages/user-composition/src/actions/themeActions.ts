'use server';

import { withAuth, withOptionalAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';

type ThemePreference = 'light' | 'dark' | 'system';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function userPreferences(knex: any, tenant: string) {
  return tenantDb(knex, tenant).table('user_preferences');
}

export const getThemePreferenceAction = withOptionalAuth(async (
  user,
  ctx
): Promise<ThemePreference | null> => {
  if (!user || !ctx) {
    return null;
  }

  const { knex } = await createTenantKnex();

  const userPref = await userPreferences(knex, ctx.tenant)
    .where({
      user_id: user.user_id,
      setting_name: 'theme',
    })
    .first();

  if (userPref?.setting_value) {
    const theme = typeof userPref.setting_value === 'string'
      ? userPref.setting_value.replace(/"/g, '')
      : userPref.setting_value;
    return isThemePreference(theme) ? theme : null;
  }

  return null;
});

export const updateThemePreferenceAction = withAuth(async (
  user,
  { tenant },
  theme: ThemePreference
) => {
  if (!isThemePreference(theme)) {
    throw new Error(`Invalid theme preference: ${theme}`);
  }

  const { knex } = await createTenantKnex();

  const existing = await userPreferences(knex, tenant)
    .where({
      user_id: user.user_id,
      setting_name: 'theme',
    })
    .first();

  if (existing) {
    await userPreferences(knex, tenant)
      .where({
        user_id: user.user_id,
        setting_name: 'theme',
      })
      .update({
        setting_value: JSON.stringify(theme),
        updated_at: knex.fn.now()
      });
  } else {
    await userPreferences(knex, tenant).insert({
      user_id: user.user_id,
      tenant: tenant,
      setting_name: 'theme',
      setting_value: JSON.stringify(theme),
      updated_at: knex.fn.now()
    });
  }

  return { success: true };
});
