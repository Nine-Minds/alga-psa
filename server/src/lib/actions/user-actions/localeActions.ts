'use server';

import { getCurrentUser } from './userActions';
import { getConnection } from '@/lib/db/db';
import { SupportedLocale, isSupportedLocale } from '@/lib/i18n/config';

export async function updateUserLocaleAction(locale: SupportedLocale) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not found');
  }

  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const knex = await getConnection(user.tenant);

  // Check if preference exists
  const existing = await knex('user_preferences')
    .where({
      user_id: user.user_id,
      setting_name: 'locale',
      tenant: user.tenant
    })
    .first();

  if (existing) {
    // Update existing preference
    await knex('user_preferences')
      .where({
        user_id: user.user_id,
        setting_name: 'locale',
        tenant: user.tenant
      })
      .update({
        setting_value: JSON.stringify(locale),
        updated_at: knex.fn.now()
      });
  } else {
    // Insert new preference
    await knex('user_preferences').insert({
      user_id: user.user_id,
      tenant: user.tenant,
      setting_name: 'locale',
      setting_value: JSON.stringify(locale),
      updated_at: knex.fn.now()
    });
  }

  return { success: true };
}

export async function getUserLocaleAction(): Promise<SupportedLocale | null> {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const knex = await getConnection(user.tenant);

  const userPref = await knex('user_preferences')
    .where({
      user_id: user.user_id,
      setting_name: 'locale',
      tenant: user.tenant
    })
    .first();

  if (userPref?.setting_value) {
    const locale = typeof userPref.setting_value === 'string'
      ? userPref.setting_value.replace(/"/g, '')
      : userPref.setting_value;
    return isSupportedLocale(locale) ? locale : null;
  }

  return null;
}