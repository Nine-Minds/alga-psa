'use server';

import logger from '@alga-psa/core/logger';
import { resolveTenantAppBase } from '@alga-psa/tenancy/server';
import { getTenantSlugForTenant } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';

export interface TenantPortalLinkResult {
  url: string;
  source: 'vanity' | 'canonical';
  tenantSlug: string;
}

export type TenantPortalLinkActionResult =
  | { success: true; data: TenantPortalLinkResult }
  | { success: false; error: string };

export const getTenantPortalLoginLink = withAuth(async (
  _user,
  { tenant }
): Promise<TenantPortalLinkActionResult> => {
  const tenantSlug = await getTenantSlugForTenant(tenant);
  try {
    const resolved = await resolveTenantAppBase(tenant, 'client_portal');

    if (resolved.source === 'vanity') {
      return {
        success: true,
        data: {
          url: `${resolved.baseUrl}/auth/client-portal/signin`,
          source: 'vanity',
          tenantSlug,
        },
      };
    }

    const canonicalBase =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      (process.env.HOST ? `https://${process.env.HOST}` : '');

    if (!canonicalBase) {
      return { success: false, error: 'Client portal login links are not configured.' };
    }

    const loginUrl = new URL(
      '/auth/client-portal/signin',
      canonicalBase.endsWith('/') ? canonicalBase : `${canonicalBase}/`
    );
    loginUrl.searchParams.set('tenant', tenantSlug);

    return {
      success: true,
      data: {
        url: loginUrl.toString(),
        source: 'canonical',
        tenantSlug,
      },
    };
  } catch (error) {
    logger.error('[getTenantPortalLoginLink] Failed to build login link', {
      tenant,
      error: error instanceof Error ? error.message : error,
    });
    return { success: false, error: 'Failed to build client portal login link.' };
  }
});
