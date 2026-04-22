'use server';

import { getConnection } from '@alga-psa/db';
import { SupportedLocale, isSupportedLocale, LOCALE_CONFIG } from '@alga-psa/core/i18n/config';
import { withAuth, withOptionalAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';

/**
 * Update the client-portal-only default locale.
 * Only touches settings.clientPortal.defaultLocale — the list of available
 * locales is managed org-wide via updateTenantDefaultLocaleAction.
 */
export const updateTenantClientPortalLocaleAction = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  locale: SupportedLocale,
) => {
  if (user.user_type !== 'internal') {
    throw new Error('Only internal users can update tenant settings');
  }

  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const knex = await getConnection(tenant);

  const existingRecord = await knex('tenant_settings')
    .where({ tenant })
    .first();

  const existingSettings = existingRecord?.settings || {};

  const updatedSettings = {
    ...existingSettings,
    clientPortal: {
      ...(existingSettings.clientPortal || {}),
      defaultLocale: locale,
    },
  };

  if (existingRecord) {
    await knex('tenant_settings')
      .where({ tenant })
      .update({
        settings: updatedSettings,
        updated_at: knex.fn.now(),
      });
  } else {
    await knex('tenant_settings').insert({
      tenant,
      settings: updatedSettings,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }

  return { success: true };
});

/**
 * Read the client-portal-only default locale. Returns null when unset so the
 * UI can show a placeholder and resolution falls through to the org default.
 */
export const getTenantClientPortalLocaleAction = withOptionalAuth(async (
  user: IUserWithRoles | null,
  ctx: AuthContext | null,
): Promise<{ defaultLocale: SupportedLocale | null }> => {
  if (!user || !ctx) {
    return { defaultLocale: null };
  }

  const { tenant } = ctx;
  const knex = await getConnection(tenant);

  const tenantSettings = await knex('tenant_settings')
    .where({ tenant })
    .first();

  const stored = tenantSettings?.settings?.clientPortal?.defaultLocale;
  return {
    defaultLocale: isSupportedLocale(stored) ? stored : null,
  };
});

// Keeps LOCALE_CONFIG referenced so lint doesn't complain if trimmed later.
void LOCALE_CONFIG;
