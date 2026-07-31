'use server';

import { withAuth, withOptionalAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { SupportedLocale, isSupportedLocale } from '@alga-psa/core/i18n/config';

function userPreferences(knex: any, tenant: string) {
  return tenantDb(knex, tenant).table('user_preferences');
}

export const updateUserLocaleAction = withAuth(async (
  user,
  { tenant },
  locale: SupportedLocale | null
) => {
  // If locale is null, we're clearing the preference
  if (locale !== null && !isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const { knex } = await createTenantKnex();

  if (locale === null) {
    // Delete the preference to clear it
    await userPreferences(knex, tenant)
      .where({
        user_id: user.user_id,
        setting_name: 'locale',
      })
      .delete();

    return { success: true };
  }

  // Check if preference exists
  const existing = await userPreferences(knex, tenant)
    .where({
      user_id: user.user_id,
      setting_name: 'locale',
    })
    .first();

  if (existing) {
    // Update existing preference
    await userPreferences(knex, tenant)
      .where({
        user_id: user.user_id,
        setting_name: 'locale',
      })
      .update({
        setting_value: JSON.stringify(locale),
        updated_at: knex.fn.now()
      });
  } else {
    // Insert new preference
    await userPreferences(knex, tenant).insert({
      user_id: user.user_id,
      tenant: tenant,
      setting_name: 'locale',
      setting_value: JSON.stringify(locale),
      updated_at: knex.fn.now()
    });
  }

  return { success: true };
});

export const getUserLocaleAction = withOptionalAuth(async (
  user,
  ctx
): Promise<SupportedLocale | null> => {
  if (!user || !ctx) {
    return null;
  }

  const { knex } = await createTenantKnex();

  const userPref = await userPreferences(knex, ctx.tenant)
    .where({
      user_id: user.user_id,
      setting_name: 'locale',
    })
    .first();

  if (userPref?.setting_value) {
    const locale = typeof userPref.setting_value === 'string'
      ? userPref.setting_value.replace(/"/g, '')
      : userPref.setting_value;
    return isSupportedLocale(locale) ? locale : null;
  }

  return null;
});
