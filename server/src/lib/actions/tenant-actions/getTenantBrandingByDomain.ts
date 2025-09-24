'use server';

import { getConnection } from '@/lib/db/db';
import { TenantBranding } from './tenantBrandingActions';
import { unstable_cache } from 'next/cache';

/**
 * Get tenant branding by domain with caching
 */
async function fetchTenantBrandingByDomain(domain: string): Promise<TenantBranding | null> {
  try {
    // Normalize domain (remove protocol, www, trailing slash)
    const normalizedDomain = domain
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');

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
          return null;
        }

        const tenantKnex = await getConnection(portalDomain.tenant);
        const tenantSettings = await tenantKnex('tenant_settings')
          .where({ tenant: portalDomain.tenant })
          .first();

        if (!tenantSettings?.settings?.branding) {
          return null;
        }

        return tenantSettings.settings.branding;
      }
      return null; // No portal found for subdomain
    } else {
      // Custom domain - look it up directly
      const knex = await getConnection();

      const portalDomain = await knex('portal_domains')
        .whereRaw('lower(domain) = ?', [normalizedDomain])
        .andWhere('status', 'active')
        .first();

      if (!portalDomain) {
        return null;
      }

      // Get tenant's branding
      const tenantKnex = await getConnection(portalDomain.tenant);
      const tenantSettings = await tenantKnex('tenant_settings')
        .where({ tenant: portalDomain.tenant })
        .first();

      if (!tenantSettings?.settings?.branding) {
        return null;
      }

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