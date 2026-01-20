'use server';

import { getConnection } from '@alga-psa/db';
import { SupportedLocale, isSupportedLocale, LOCALE_CONFIG } from '@alga-psa/core/i18n/config';

// Dynamic import to avoid circular dependency (tenancy -> users -> auth -> ui -> analytics -> tenancy)
// Note: Using string concatenation to prevent static analysis from detecting this dependency
const getUsersModule = () => '@alga-psa/' + 'users/actions';

const getCurrentUserAsync = async () => {
  const { getCurrentUser } = await import(/* webpackIgnore: true */ getUsersModule());
  return getCurrentUser();
};

/**
 * Update tenant's default locale for all users
 */
export async function updateTenantDefaultLocaleAction(
  locale: SupportedLocale,
  enabledLocales?: SupportedLocale[]
) {
  const user = await getCurrentUserAsync();
  if (!user) {
    throw new Error('User not found');
  }

  // Check if user has admin permissions (you may want to add proper permission checks)
  // For now, we'll assume any internal user can update tenant settings
  if (user.user_type !== 'internal') {
    throw new Error('Only internal users can update tenant settings');
  }

  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const knex = await getConnection(user.tenant);

  // Get existing settings
  const existingRecord = await knex('tenant_settings')
    .where({ tenant: user.tenant })
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
      .where({ tenant: user.tenant })
      .update({
        settings: updatedSettings,
        updated_at: knex.fn.now()
      });
  } else {
    await knex('tenant_settings').insert({
      tenant: user.tenant,
      settings: updatedSettings,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });
  }

  return { success: true };
}

/**
 * Get tenant's default locale and enabled locales
 */
export async function getTenantLocaleSettingsAction(): Promise<{
  defaultLocale: SupportedLocale;
  enabledLocales: SupportedLocale[];
} | null> {
  const user = await getCurrentUserAsync();
  if (!user) {
    return null;
  }

  const knex = await getConnection(user.tenant);

  const tenantSettings = await knex('tenant_settings')
    .where({ tenant: user.tenant })
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
}
