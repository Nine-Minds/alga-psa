'use server';

import { getConnection } from '@/lib/db/db';
import { TenantBranding } from './tenantBrandingActions';
import { unstable_cache } from 'next/cache';

/**
 * Get tenant branding by domain with caching
 */
async function fetchTenantBrandingByDomain(domain: string): Promise<TenantBranding | null> {
  console.log('[getTenantBrandingByDomain] Input domain:', domain);

  try {
    // Normalize domain (remove protocol, www, port, trailing slash)
    const normalizedDomain = domain
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/:\d+$/, '') // Remove port number
      .replace(/\/$/, '');

    console.log('[getTenantBrandingByDomain] Normalized domain:', normalizedDomain);

    // For default domains, extract tenant from subdomain
    if (normalizedDomain.includes('.algapsa.com') || normalizedDomain.includes('.9minds.ai')) {
      // Extract subdomain (e.g., 'abc123.portal' from 'abc123.portal.algapsa.com')
      const parts = normalizedDomain.split('.');
      if (parts.length >= 3 && parts[1] === 'portal') {
        const tenantPrefix = parts[0];

        // Get default connection to query portal_domains
        const knex = await getConnection();

        // Find tenant by canonical_host pattern
        const portalDomain = await knex('portal_domains')
          .where('canonical_host', 'like', `${tenantPrefix}.portal.%`)
          .andWhere('status', 'active')
          .first();

        if (!portalDomain) {
          console.log('[getTenantBrandingByDomain] No portal found for subdomain:', tenantPrefix);
          return null;
        }

        const tenantKnex = await getConnection(portalDomain.tenant);
        const tenantSettings = await tenantKnex('tenant_settings')
          .where({ tenant: portalDomain.tenant })
          .first();

        if (!tenantSettings?.settings?.branding) {
          console.log('[getTenantBrandingByDomain] No branding settings found for tenant:', portalDomain.tenant);
          return null;
        }

        console.log('[getTenantBrandingByDomain] Found branding for tenant:', portalDomain.tenant);
        return tenantSettings.settings.branding;
      }
      return null; // No portal found for subdomain
    } else {
      // Custom domain - look it up directly
      console.log('[getTenantBrandingByDomain] Looking up custom domain:', normalizedDomain);
      const knex = await getConnection();

      // First check all portal domains to debug
      const allDomains = await knex('portal_domains').select('domain', 'status', 'tenant');
      console.log('[getTenantBrandingByDomain] All portal domains in DB:', allDomains);

      const portalDomain = await knex('portal_domains')
        .whereRaw('lower(domain) = ?', [normalizedDomain])
        .first();

      console.log('[getTenantBrandingByDomain] Portal domain query result:', portalDomain);

      if (!portalDomain) {
        console.log('[getTenantBrandingByDomain] No portal domain found for:', normalizedDomain);
        return null;
      }

      // Check status
      if (portalDomain.status !== 'active') {
        console.log('[getTenantBrandingByDomain] Portal domain not active. Status:', portalDomain.status);
        // For pending domains, still try to show branding
      }

      // Get tenant's branding
      const tenantKnex = await getConnection(portalDomain.tenant);
      const tenantSettings = await tenantKnex('tenant_settings')
        .where({ tenant: portalDomain.tenant })
        .first();

      if (!tenantSettings?.settings?.branding) {
        console.log('[getTenantBrandingByDomain] No branding settings found for tenant:', portalDomain.tenant);
        return null;
      }

      console.log('[getTenantBrandingByDomain] Found branding for custom domain:', normalizedDomain);
      return tenantSettings.settings.branding;
    }
  } catch (error) {
    console.error('Error fetching tenant branding by domain:', error);
    return null;
  }
}

// Cache the branding data for 5 minutes per domain
export const getTenantBrandingByDomain = unstable_cache(
  fetchTenantBrandingByDomain,
  ['tenant-branding-by-domain'],
  {
    revalidate: 300, // 5 minutes
    tags: ['tenant-branding'],
  }
);

/**
 * Clear cached branding for a specific domain (domain param reserved for future use)
 */
export async function invalidateDomainBrandingCache(_domain: string): Promise<void> {
  const { revalidateTag } = await import('next/cache');
  revalidateTag('tenant-branding');
}