'use server';

import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';
import { getPortalDomain } from '@alga-psa/client-portal/models/PortalDomainModel';
import { getTenantSlugForTenant } from '@alga-psa/tenancy/actions';

export interface TenantPortalLinkResult {
  url: string;
  source: 'vanity' | 'canonical';
  tenantSlug: string;
}

export async function getTenantPortalLoginLink(): Promise<TenantPortalLinkResult> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant context is required to build portal login link');
  }

  const tenantSlug = await getTenantSlugForTenant(tenant);
  try {
    const portalDomain = await getPortalDomain(knex, tenant);

    if (portalDomain && portalDomain.status === 'active' && portalDomain.domain) {
      return {
        url: `https://${portalDomain.domain}/auth/client-portal/signin`,
        source: 'vanity',
        tenantSlug,
      };
    }

    const canonicalBase =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      (process.env.HOST ? `https://${process.env.HOST}` : '');

    if (!canonicalBase) {
      throw new Error('NEXTAUTH_URL (or NEXT_PUBLIC_BASE_URL) must be configured to compute canonical login links');
    }

    const loginUrl = new URL(
      '/auth/client-portal/signin',
      canonicalBase.endsWith('/') ? canonicalBase : `${canonicalBase}/`
    );
    loginUrl.searchParams.set('tenant', tenantSlug);

    return {
      url: loginUrl.toString(),
      source: 'canonical',
      tenantSlug,
    };
  } catch (error) {
    logger.error('[getTenantPortalLoginLink] Failed to build login link', {
      tenant,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}
