'use server';

import { withAuth, withOptionalAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';

type ThemePreference = 'light' | 'dark' | 'system';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export const getThemePreferenceAction = withOptionalAuth(async (
  user,
  ctx
): Promise<ThemePreference | null> => {
  if (!user || !ctx) {
    return null;
  }

  const { knex } = await createTenantKnex();

  const userPref = await knex('user_preferences')
    .where({
      user_id: user.user_id,
      setting_name: 'theme',
      tenant: ctx.tenant
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

  const existing = await knex('user_preferences')
    .where({
      user_id: user.user_id,
      setting_name: 'theme',
      tenant: tenant
    })
    .first();

  if (existing) {
    await knex('user_preferences')
      .where({
        user_id: user.user_id,
        setting_name: 'theme',
        tenant: tenant
      })
      .update({
        setting_value: JSON.stringify(theme),
        updated_at: knex.fn.now()
      });
  } else {
    await knex('user_preferences').insert({
      user_id: user.user_id,
      tenant: tenant,
      setting_name: 'theme',
      setting_value: JSON.stringify(theme),
      updated_at: knex.fn.now()
    });
  }

  return { success: true };
});
