/**
 * Server-side i18n utilities for Next.js App Router
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import i18next, { TFunction } from 'i18next';
import { cache } from 'react';
import { cookies, headers } from 'next/headers.js';
import {
  LOCALE_CONFIG,
  I18N_CONFIG,
  SupportedLocale,
  getBestMatchingLocale,
  isSupportedLocale,
} from './config';
import { tenantDb } from '@alga-psa/db';
import { getConnection } from '@alga-psa/db/tenant';

/**
 * Resolve the absolute path to the locales directory.
 *
 * Server components can run with `process.cwd()` pointing at different roots
 * depending on whether the dev server starts from `server/`, `ee/server/`, or
 * the monorepo root. We avoid HTTP fetch loaders so SSR doesn't depend on the
 * dev port — historically `i18next-http-backend` defaulted to `localhost:3000`,
 * which silently failed when the dev server ran on a different port and
 * surfaced as raw translation keys in the UI.
 *
 * Env overrides (in priority order): `I18N_LOCALES_DIR`, `ALGA_LOCALES_DIR`.
 */
function getLocalesDir(): string {
  const override = process.env.I18N_LOCALES_DIR || process.env.ALGA_LOCALES_DIR;
  if (override) return override;

  const candidates = [
    path.resolve(process.cwd(), 'public/locales'),            // server/ as cwd
    path.resolve(process.cwd(), '../server/public/locales'),  // ee/server/ as cwd
    path.resolve(process.cwd(), 'server/public/locales'),     // monorepo root as cwd
  ];

  for (const dir of candidates) {
    try {
      if (existsSync(dir)) return dir;
    } catch {
      // ignore and try next candidate
    }
  }

  return path.resolve(process.cwd(), 'public/locales');
}

async function loadNamespaceFromDisk(
  locale: SupportedLocale,
  namespace: string,
): Promise<Record<string, unknown> | null> {
  const filePath = path.join(getLocalesDir(), locale, `${namespace}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Initialize i18next for server-side rendering by reading locale JSON
 * directly from disk. Loads each requested namespace plus the fallback locale
 * so missing keys still resolve.
 */
async function initI18next(locale: SupportedLocale, namespaces: string[] = []) {
  const instance = i18next.createInstance();

  const requestedNamespaces = Array.from(
    new Set<string>([...(I18N_CONFIG.ns ?? ['common']), ...namespaces])
  );

  await instance.init({
    ...I18N_CONFIG,
    ns: requestedNamespaces,
    lng: locale,
    // Resources are added below; disable backend to avoid extra fetching.
    initImmediate: false,
  });

  const fallback =
    typeof I18N_CONFIG.fallbackLng === 'string' ? I18N_CONFIG.fallbackLng : LOCALE_CONFIG.defaultLocale;
  const localesToLoad = locale === fallback ? [locale] : [locale, fallback as SupportedLocale];

  await Promise.all(
    localesToLoad.flatMap((lng) =>
      requestedNamespaces.map(async (ns) => {
        const data = await loadNamespaceFromDisk(lng, ns);
        if (data) {
          instance.addResourceBundle(lng, ns, data, true, true);
        }
      })
    )
  );

  return instance;
}

/**
 * Optional injected resolver. When set, `getServerLocale()` (called without
 * explicit options) defers to this function so server-side rendering uses the
 * same DB-prefs-aware chain as the client (user pref → client → tenant →
 * default). The resolver lives outside `@alga-psa/ui` to avoid a circular
 * dependency on `@alga-psa/tenancy`; the server app registers it from its
 * Next.js `instrumentation.ts` hook via `registerServerLocaleResolver`.
 */
type ServerLocaleResolver = () => Promise<SupportedLocale | null | undefined>;
let registeredServerLocaleResolver: ServerLocaleResolver | null = null;

export function registerServerLocaleResolver(
  resolver: ServerLocaleResolver | null,
): void {
  registeredServerLocaleResolver = resolver;
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
      // 0. When called without explicit options, defer to the registered
      // hierarchical resolver if the host app provided one. This keeps
      // server- and client-rendered translations in agreement and prevents a
      // stale `locale` cookie from overriding the user's stored DB
      // preference.
      if (!options && registeredServerLocaleResolver) {
        try {
          const resolved = await registeredServerLocaleResolver();
          if (resolved && isSupportedLocale(resolved)) {
            return resolved;
          }
        } catch (error) {
          console.error('Server locale resolver failed:', error);
          // fall through to the legacy cookie/Accept-Language chain below
        }
      }

      // 1. Check cookie (user's explicit device-level choice). Only consulted
      // when explicit options are passed or no resolver returned a value.
      const cookieStore = await cookies();
      const localeCookie = cookieStore.get(LOCALE_CONFIG.cookie.name)?.value;
      if (localeCookie && isSupportedLocale(localeCookie)) {
        return localeCookie;
      }

      // 2. Check user preferences from database
      if (options?.userId && options?.tenantId) {
        const knex = await getConnection(options.tenantId);
        const userPref = await tenantDb(knex, options.tenantId).table('user_preferences')
          .where({
            user_id: options.userId,
            setting_name: 'locale',
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
        const client = await tenantDb(knex, options.tenantId).table('clients')
          .where({
            client_id: options.clientId
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
        const tenantSettings = await tenantDb(knex, options.tenantId).table('tenant_settings')
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
    const i18n = await initI18next(resolvedLocale, [namespace]);

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
  const existing = await tenantDb(knex, tenantId).table('user_preferences')
    .where({
      user_id: userId,
      setting_name: 'locale'
    })
    .first();

  if (existing) {
    // Update existing preference
    await tenantDb(knex, tenantId).table('user_preferences')
      .where({
        user_id: userId,
        setting_name: 'locale'
      })
      .update({
        setting_value: JSON.stringify(locale),
        updated_at: knex.fn.now()
      });
  } else {
    // Insert new preference
    await tenantDb(knex, tenantId).table('user_preferences').insert({
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
  const existingRecord = await tenantDb(knex, tenantId).table('tenant_settings')
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
    await tenantDb(knex, tenantId).table('tenant_settings')
      .update({
        settings: updatedSettings,
        updated_at: knex.fn.now()
      });
  } else {
    await tenantDb(knex, tenantId).table('tenant_settings').insert({
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
