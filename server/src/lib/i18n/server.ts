/**
 * Server-side i18n utilities for Next.js App Router
 */

import i18next, { TFunction } from 'i18next';
import HttpBackend from 'i18next-http-backend';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import {
  LOCALE_CONFIG,
  I18N_CONFIG,
  SupportedLocale,
  getBestMatchingLocale,
  isSupportedLocale,
} from './config';
import { getConnection } from '@/lib/db/db';

/**
 * Initialize i18next for server-side rendering
 */
async function initI18next(locale: SupportedLocale) {
  const instance = i18next.createInstance();

  await instance
    .use(HttpBackend)
    .init({
      ...I18N_CONFIG,
      lng: locale,
      backend: {
        loadPath: `${process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'}/locales/{{lng}}/{{ns}}.json`,
      },
    });

  return instance;
}

/**
 * Server-side locale detection with proper fallback chain
 * Cached per request for performance
 */
export const getServerLocale = cache(
  async (options?: {
    tenantId?: string;
    userId?: string;
    clientId?: string;
  }): Promise<SupportedLocale> => {
    try {
      // 1. Check cookie (user's explicit choice)
      const cookieStore = await cookies();
      const localeCookie = cookieStore.get(LOCALE_CONFIG.cookie.name)?.value;
      if (localeCookie && isSupportedLocale(localeCookie)) {
        return localeCookie;
      }

      // 2. Check user preferences from database
      if (options?.userId && options?.tenantId) {
        const knex = await getConnection(options.tenantId);
        const userPref = await knex('user_preferences')
          .where({
            user_id: options.userId,
            setting_name: 'locale',
            tenant: options.tenantId
          })
          .first();

        if (userPref?.setting_value) {
          // setting_value is JSONB, so it could be a string or need parsing
          const locale = typeof userPref.setting_value === 'string'
            ? userPref.setting_value.replace(/"/g, '') // Remove quotes if stored as JSON string
            : userPref.setting_value;

          if (isSupportedLocale(locale)) {
            return locale;
          }
        }
      }

      // 3. Check client default locale
      if (options?.clientId && options?.tenantId) {
        const knex = await getConnection(options.tenantId);
        const client = await knex('clients')
          .where({
            client_id: options.clientId,
            tenant: options.tenantId
          })
          .first();

        const clientLocale = client?.properties?.defaultLocale;
        if (clientLocale && isSupportedLocale(clientLocale)) {
          return clientLocale;
        }
      }

      // 4. Check tenant default locale (for client portal)
      if (options?.tenantId) {
        const knex = await getConnection(options.tenantId);
        const tenantSettings = await knex('tenant_settings')
          .where({ tenant: options.tenantId })
          .first();

        const clientPortalLocale = tenantSettings?.settings?.clientPortal?.defaultLocale;
        if (clientPortalLocale && isSupportedLocale(clientPortalLocale)) {
          return clientPortalLocale;
        }

        // Check tenant-wide default locale
        const tenantDefaultLocale = tenantSettings?.settings?.defaultLocale;
        if (tenantDefaultLocale && isSupportedLocale(tenantDefaultLocale)) {
          return tenantDefaultLocale;
        }
      }

      // 5. Check Accept-Language header
      const headerStore = await headers();
      const acceptLanguage = headerStore.get('accept-language');
      if (acceptLanguage) {
        const preferredLocales = acceptLanguage
          .split(',')
          .map((lang) => lang.split(';')[0].trim());
        return getBestMatchingLocale(preferredLocales);
      }

      // 6. Fall back to default locale
      return LOCALE_CONFIG.defaultLocale as SupportedLocale;
    } catch (error) {
      console.error('Error detecting server locale:', error);
      return LOCALE_CONFIG.defaultLocale as SupportedLocale;
    }
  },
);

/**
 * Get server-side translation function
 * Cached per locale for performance
 */
export const getServerTranslation = cache(
  async (
    locale?: SupportedLocale,
    namespace = 'common',
  ): Promise<{
    t: TFunction;
    i18n: typeof i18next;
  }> => {
    const resolvedLocale = locale || (await getServerLocale());
    const i18n = await initI18next(resolvedLocale);

    return {
      t: i18n.getFixedT(resolvedLocale, namespace),
      i18n,
    };
  },
);

/**
 * Save user's locale preference to cookie
 */
export async function setUserLocale(locale: SupportedLocale) {
  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_CONFIG.cookie.name, locale, {
    maxAge: LOCALE_CONFIG.cookie.maxAge,
    sameSite: LOCALE_CONFIG.cookie.sameSite,
    secure: LOCALE_CONFIG.cookie.secure,
    path: '/',
  });
}

/**
 * Update user's locale preference in database
 */
export async function updateUserLocalePreference(
  userId: string,
  locale: SupportedLocale,
  tenantId: string,
) {
  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const knex = await getConnection(tenantId);

  // Check if preference exists
  const existing = await knex('user_preferences')
    .where({
      user_id: userId,
      setting_name: 'locale',
      tenant: tenantId
    })
    .first();

  if (existing) {
    // Update existing preference
    await knex('user_preferences')
      .where({
        user_id: userId,
        setting_name: 'locale',
        tenant: tenantId
      })
      .update({
        setting_value: JSON.stringify(locale),
        updated_at: knex.fn.now()
      });
  } else {
    // Insert new preference
    await knex('user_preferences').insert({
      user_id: userId,
      tenant: tenantId,
      setting_name: 'locale',
      setting_value: JSON.stringify(locale),
      updated_at: knex.fn.now()
    });
  }
}

/**
 * Update tenant's default locale for client portal
 */
export async function updateTenantDefaultLocale(
  tenantId: string,
  locale: SupportedLocale,
  enabledLocales?: SupportedLocale[],
) {
  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const knex = await getConnection(tenantId);

  // Get existing settings
  const existingRecord = await knex('tenant_settings')
    .where({ tenant: tenantId })
    .first();

  const existingSettings = existingRecord?.settings || {};

  // Build updated settings with clientPortal locale configuration
  const updatedSettings = {
    ...existingSettings,
    clientPortal: {
      ...(existingSettings.clientPortal || {}),
      defaultLocale: locale,
      enabledLocales: enabledLocales || LOCALE_CONFIG.supportedLocales,
    },
  };

  if (existingRecord) {
    await knex('tenant_settings')
      .where({ tenant: tenantId })
      .update({
        settings: updatedSettings,
        updated_at: knex.fn.now()
      });
  } else {
    await knex('tenant_settings').insert({
      tenant: tenantId,
      settings: updatedSettings,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });
  }
}

/**
 * Get available locales for a tenant (including custom translations)
 */
export async function getTenantAvailableLocales(
  tenantId: string,
): Promise<SupportedLocale[]> {
  // For now, return all supported locales
  // In the future, this could check for tenant-specific translation overrides
  return [...LOCALE_CONFIG.supportedLocales];
}

/**
 * Format a date according to the locale
 */
export function formatDate(
  date: Date | string,
  locale: SupportedLocale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, options).format(dateObj);
}

/**
 * Format a number according to the locale
 */
export function formatNumber(
  value: number,
  locale: SupportedLocale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Format currency according to the locale
 */
export function formatCurrency(
  value: number,
  locale: SupportedLocale,
  currency: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    ...options,
  }).format(value);
}