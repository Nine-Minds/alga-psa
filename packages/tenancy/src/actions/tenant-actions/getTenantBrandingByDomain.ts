'use server';

import { getConnection } from '@alga-psa/db';
import { TenantBranding } from './tenantBrandingActions';
import { unstable_cache } from 'next/cache';
import { LOCALE_CONFIG, SupportedLocale, isSupportedLocale } from '@alga-psa/core/i18n/config';

const DEV_HOSTS = new Set([
  '',
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

interface TenantPortalConfig {
  branding: TenantBranding | null;
  locale: SupportedLocale | null;
}

async function getTenantSettings(tenantId: string) {
  const tenantKnex = await getConnection(tenantId);
  return tenantKnex('tenant_settings')
    .where({ tenant: tenantId })
    .first();
}

async function lookupTenantSettingsByDomain(normalizedDomain: string) {
  if (normalizedDomain.includes('.algapsa.com') || normalizedDomain.includes('.9minds.ai')) {
    const parts = normalizedDomain.split('.');
    if (parts.length >= 3 && parts[1] === 'portal') {
      const tenantPrefix = parts[0];
      const knex = await getConnection();

      const portalDomain = await knex('portal_domains')
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
  const portalDomain = await knex('portal_domains')
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
      return { branding: null, locale: null };
    }

    const { tenantSettings, tenantId } = await lookupTenantSettingsByDomain(normalizedDomain);
    if (!tenantSettings?.settings) {
      if (tenantId) {
        console.log('[getTenantBrandingByDomain] No tenant settings found for tenant:', tenantId);
      }
      return { branding: null, locale: null };
    }

    const branding: TenantBranding | null = tenantSettings.settings.branding || null;

    const rawLocale = tenantSettings.settings.clientPortal?.defaultLocale
      || tenantSettings.settings.defaultLocale
      || null;
    const locale = typeof rawLocale === 'string' && isSupportedLocale(rawLocale)
      ? rawLocale
      : null;

    return {
      branding,
      locale,
    };
  } catch (error) {
    console.error('Error fetching tenant portal config by domain:', error);
    return {
      branding: null,
      locale: null,
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

export async function getTenantBrandingByDomain(domain: string): Promise<TenantBranding | null> {
  const config = await getTenantPortalConfigCached(domain);
  return config.branding;
}

export async function getTenantLocaleByDomain(domain: string): Promise<SupportedLocale | null> {
  const config = await getTenantPortalConfigCached(domain);
  return config.locale ?? (isSupportedLocale(LOCALE_CONFIG.defaultLocale) ? LOCALE_CONFIG.defaultLocale : null);
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
    const tenantSettings = await knex('tenant_settings')
      .where({ tenant: tenantId })
      .first();

    if (!tenantSettings?.settings) {
      console.log('[getTenantBrandingByTenantId] No tenant settings found for tenant:', tenantId);
      return null;
    }

    return tenantSettings.settings.branding || null;
  } catch (error) {
    console.error('[getTenantBrandingByTenantId] Error fetching branding:', error);
    return null;
  }
}
