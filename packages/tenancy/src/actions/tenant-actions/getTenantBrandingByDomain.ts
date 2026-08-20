'use server';

import { getConnection, getTenantIdBySlug, tenantDb } from '@alga-psa/db';
import { TenantBranding } from './tenantBrandingActions';
import { unstable_cache } from 'next/cache';
import { LOCALE_CONFIG, SupportedLocale, isSupportedLocale, normalizeLocale } from '@alga-psa/core/i18n/config';
import { isEnterprise } from '@alga-psa/core/features';
import { scopeBrandingToEdition } from '../../lib/generateBrandingStyles';
import { DEFAULT_TENANT_THEME, normalizeTenantTheme, type TenantTheme } from '../../lib/tenantTheme';
import type { Knex } from 'knex';

const DEV_HOSTS = new Set([
  '',
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

export interface TenantPortalConfig {
  branding: TenantBranding | null;
  locale: SupportedLocale | null;
  theme: TenantTheme;
}

const tenantSettingsQuery = (knex: Knex, tenant: string) =>
  tenantDb(knex, tenant).table('tenant_settings');

const PORTAL_DOMAIN_TENANT_DISCOVERY = 'tenant-discovery';

async function getTenantSettings(tenantId: string) {
  const tenantKnex = await getConnection(tenantId);
  return tenantSettingsQuery(tenantKnex, tenantId)
    .first();
}

async function lookupTenantSettingsByDomain(normalizedDomain: string) {
  if (normalizedDomain.includes('.algapsa.com') || normalizedDomain.includes('.9minds.ai')) {
    const parts = normalizedDomain.split('.');
    if (parts.length >= 3 && parts[1] === 'portal') {
      const tenantPrefix = parts[0];
      const knex = await getConnection();

      const portalDomain = await tenantDb(knex, PORTAL_DOMAIN_TENANT_DISCOVERY)
        .unscoped('portal_domains', 'tenant discovery from client portal subdomain')
        .where('canonical_host', 'like', `${tenantPrefix}.portal.%`)
        .andWhere('status', 'active')
        .first();

      if (!portalDomain) {
        console.log('[getTenantBrandingByDomain] No portal found for subdomain:', tenantPrefix);
        return { tenantSettings: null, tenantId: null };
      }

      const tenantSettings = await getTenantSettings(portalDomain.tenant);
      return { tenantSettings, tenantId: portalDomain.tenant };
    }

    return { tenantSettings: null, tenantId: null };
  }

  const knex = await getConnection();
  const portalDomain = await tenantDb(knex, PORTAL_DOMAIN_TENANT_DISCOVERY)
    .unscoped('portal_domains', 'tenant discovery from client portal custom domain')
    .whereRaw('lower(domain) = ?', [normalizedDomain])
    .first();

  console.log('[getTenantBrandingByDomain] Portal domain query result:', portalDomain);

  if (!portalDomain) {
    console.log('[getTenantBrandingByDomain] No portal domain found for:', normalizedDomain);
    return { tenantSettings: null, tenantId: null };
  }

  if (portalDomain.status !== 'active') {
    console.log('[getTenantBrandingByDomain] Portal domain not active. Status:', portalDomain.status);
  }

  const tenantSettings = await getTenantSettings(portalDomain.tenant);
  return { tenantSettings, tenantId: portalDomain.tenant };
}

async function fetchTenantPortalConfig(domain: string): Promise<TenantPortalConfig> {
  console.log('[getTenantBrandingByDomain] Input domain:', domain);

  try {
    const normalizedDomain = domain
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/:\d+$/, '')
      .replace(/\/$/, '');

    console.log('[getTenantBrandingByDomain] Normalized domain:', normalizedDomain);

    if (DEV_HOSTS.has(normalizedDomain) || normalizedDomain.endsWith('.localhost')) {
      console.log('[getTenantBrandingByDomain] Skipping portal config lookup for dev host');
      return { branding: null, locale: null, theme: DEFAULT_TENANT_THEME };
    }

    const { tenantSettings, tenantId } = await lookupTenantSettingsByDomain(normalizedDomain);
    if (!tenantSettings?.settings) {
      if (tenantId) {
        console.log('[getTenantBrandingByDomain] No tenant settings found for tenant:', tenantId);
      }
      return { branding: null, locale: null, theme: DEFAULT_TENANT_THEME };
    }

    const branding = scopeBrandingToEdition(
      tenantSettings.settings.branding || null,
      isEnterprise,
    );

    const locale = normalizeLocale(tenantSettings.settings.clientPortal?.defaultLocale)
      ?? normalizeLocale(tenantSettings.settings.defaultLocale);

    return {
      branding,
      locale,
      theme: isEnterprise
        ? normalizeTenantTheme(tenantSettings.settings.theme)
        : DEFAULT_TENANT_THEME,
    };
  } catch (error) {
    console.error('Error fetching tenant portal config by domain:', error);
    return {
      branding: null,
      locale: null,
      theme: DEFAULT_TENANT_THEME,
    };
  }
}

const getTenantPortalConfigCached = unstable_cache(
  fetchTenantPortalConfig,
  ['tenant-portal-config-by-domain'],
  {
    revalidate: 300,
    tags: ['tenant-portal-config'],
  }
);

async function fetchTenantPortalConfigBySlug(slug: string): Promise<TenantPortalConfig> {
  try {
    const tenantId = await getTenantIdBySlug(slug.toLowerCase());
    if (!tenantId) {
      return { branding: null, locale: null, theme: DEFAULT_TENANT_THEME };
    }

    const tenantSettings = await getTenantSettings(tenantId);
    if (!tenantSettings?.settings) {
      return { branding: null, locale: null, theme: DEFAULT_TENANT_THEME };
    }

    return {
      branding: scopeBrandingToEdition(
        tenantSettings.settings.branding || null,
        isEnterprise,
      ),
      locale: normalizeLocale(tenantSettings.settings.clientPortal?.defaultLocale)
        ?? normalizeLocale(tenantSettings.settings.defaultLocale),
      theme: isEnterprise
        ? normalizeTenantTheme(tenantSettings.settings.theme)
        : DEFAULT_TENANT_THEME,
    };
  } catch (error) {
    console.error('[getTenantPortalConfigBySlug] Error fetching portal config:', error);
    return { branding: null, locale: null, theme: DEFAULT_TENANT_THEME };
  }
}

const getTenantPortalConfigBySlugCached = unstable_cache(
  fetchTenantPortalConfigBySlug,
  ['tenant-portal-config-by-slug'],
  {
    revalidate: 300,
    tags: ['tenant-portal-config'],
  },
);

export async function getTenantPortalConfigBySlug(slug: string): Promise<TenantPortalConfig> {
  return getTenantPortalConfigBySlugCached(slug);
}

export async function getTenantBrandingByDomain(domain: string): Promise<TenantBranding | null> {
  const config = await getTenantPortalConfigCached(domain);
  return config.branding;
}

export async function getTenantThemeByDomain(domain: string): Promise<TenantTheme> {
  const config = await getTenantPortalConfigCached(domain);
  return config.theme ?? DEFAULT_TENANT_THEME;
}

export async function getTenantBrandingBySlug(slug: string): Promise<TenantBranding | null> {
  const config = await getTenantPortalConfigBySlugCached(slug);
  return config.branding;
}

export async function getTenantThemeBySlug(slug: string): Promise<TenantTheme> {
  const config = await getTenantPortalConfigBySlugCached(slug);
  return config.theme ?? DEFAULT_TENANT_THEME;
}

export async function getTenantLocaleByDomain(domain: string): Promise<SupportedLocale | null> {
  const config = await getTenantPortalConfigCached(domain);
  return config.locale ?? (isSupportedLocale(LOCALE_CONFIG.defaultLocale) ? LOCALE_CONFIG.defaultLocale : null);
}

/**
 * Portal locale for a tenant identified by its public slug rather than a vanity
 * host. Tenants without a custom domain reach the sign-in page as
 * `?tenant=<slug>` — that identifies the tenant just as well as a Host header,
 * so the configured portal language has to resolve from it too.
 */
export async function getTenantLocaleBySlug(slug: string): Promise<SupportedLocale | null> {
  const tenantId = await getTenantIdBySlug(slug);
  return tenantId ? getTenantLocaleByTenantId(tenantId) : null;
}

/** Same settings the domain lookup reads, for a tenant already identified. */
export async function getTenantLocaleByTenantId(tenantId: string): Promise<SupportedLocale | null> {
  try {
    const tenantSettings = await getTenantSettings(tenantId);
    return normalizeLocale(tenantSettings?.settings?.clientPortal?.defaultLocale)
      ?? normalizeLocale(tenantSettings?.settings?.defaultLocale);
  } catch (error) {
    console.error('[getTenantLocaleByTenantId] Error fetching locale:', error);
    return null;
  }
}

export async function invalidateDomainBrandingCache(_domain: string): Promise<void> {
  const { revalidateTag } = await import('next/cache');
  revalidateTag('tenant-portal-config', 'max');
}

/**
 * Get tenant branding by tenant ID (from session)
 * This avoids the need for host headers and domain lookups
 */
export async function getTenantBrandingByTenantId(tenantId: string): Promise<TenantBranding | null> {
  try {
    const knex = await getConnection(tenantId);
    const tenantSettings = await tenantSettingsQuery(knex, tenantId)
      .first();

    if (!tenantSettings?.settings) {
      console.log('[getTenantBrandingByTenantId] No tenant settings found for tenant:', tenantId);
      return null;
    }

    return scopeBrandingToEdition(tenantSettings.settings.branding || null, isEnterprise);
  } catch (error) {
    console.error('[getTenantBrandingByTenantId] Error fetching branding:', error);
    return null;
  }
}
