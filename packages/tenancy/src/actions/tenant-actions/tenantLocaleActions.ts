'use server';

import { getConnection } from '@alga-psa/db';
import { SupportedLocale, isSupportedLocale, LOCALE_CONFIG } from '@alga-psa/core/i18n/config';
import { withAuth, withOptionalAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';

/**
 * Update tenant's default locale for all users
 */
export const updateTenantDefaultLocaleAction = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  locale: SupportedLocale,
  enabledLocales?: SupportedLocale[]
) => {
  // Check if user has admin permissions (you may want to add proper permission checks)
  // For now, we'll assume any internal user can update tenant settings
  if (user.user_type !== 'internal') {
    throw new Error('Only internal users can update tenant settings');
  }

  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const knex = await getConnection(tenant);

  // Get existing settings
  const existingRecord = await knex('tenant_settings')
    .where({ tenant })
    .first();

  const existingSettings = existingRecord?.settings || {};

  // Build updated settings with tenant-wide locale
  const updatedSettings = {
    ...existingSettings,
    defaultLocale: locale,
    enabledLocales: enabledLocales || LOCALE_CONFIG.supportedLocales,
    // Keep client portal settings separate
    clientPortal: {
      ...(existingSettings.clientPortal || {}),
      // Client portal can have its own defaults if needed
    }
  };

  if (existingRecord) {
    await knex('tenant_settings')
      .where({ tenant })
      .update({
        settings: updatedSettings,
        updated_at: knex.fn.now()
      });
  } else {
    await knex('tenant_settings').insert({
      tenant,
      settings: updatedSettings,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });
  }

  return { success: true };
});

/**
 * Get tenant's default locale and enabled locales
 */
export const getTenantLocaleSettingsAction = withOptionalAuth(async (user: IUserWithRoles | null, ctx: AuthContext | null): Promise<{
  defaultLocale: SupportedLocale;
  enabledLocales: SupportedLocale[];
} | null> => {
  if (!user || !ctx) {
    return null;
  }

  const { tenant } = ctx;
  const knex = await getConnection(tenant);

  const tenantSettings = await knex('tenant_settings')
    .where({ tenant })
    .first();

  if (!tenantSettings?.settings) {
    return {
      defaultLocale: LOCALE_CONFIG.defaultLocale as SupportedLocale,
      enabledLocales: [...LOCALE_CONFIG.supportedLocales]
    };
  }

  const defaultLocale = tenantSettings.settings.defaultLocale;
  const enabledLocales = tenantSettings.settings.enabledLocales;

  return {
    defaultLocale: isSupportedLocale(defaultLocale)
      ? defaultLocale
      : LOCALE_CONFIG.defaultLocale as SupportedLocale,
    enabledLocales: Array.isArray(enabledLocales) && enabledLocales.every(isSupportedLocale)
      ? enabledLocales
      : [...LOCALE_CONFIG.supportedLocales]
  };
});
