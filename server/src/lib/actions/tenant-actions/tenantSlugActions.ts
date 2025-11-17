'use server';

import logger from '@alga-psa/shared/core/logger';
import { getAdminConnection } from '@shared/db/admin';
import { buildTenantPortalSlug, getSlugParts, isValidTenantSlug } from '@shared/utils/tenantSlug';

export async function getTenantIdBySlug(slug: string): Promise<string | null> {
  if (!isValidTenantSlug(slug)) {
    logger.warn('[tenantSlugActions] Invalid tenant slug received', { slug });
    return null;
  }

  const { prefix, suffix } = getSlugParts(slug);
  try {
    const adminDb = await getAdminConnection();
    const matches = await adminDb<{ tenant: string }>('tenants')
      .select('tenant')
      .whereRaw("left(replace(tenant::text, '-', ''), 6) = ?", [prefix])
      .andWhereRaw("right(replace(tenant::text, '-', ''), 6) = ?", [suffix]);

    if (matches.length === 1) {
      return matches[0].tenant;
    }

    if (matches.length > 1) {
      logger.error('[tenantSlugActions] Multiple tenants matched slug', {
        slug,
        tenantIds: matches.map((match) => match.tenant),
      });
      return null;
    }

    logger.warn('[tenantSlugActions] No tenant found for slug', { slug });
    return null;
  } catch (error) {
    logger.error('[tenantSlugActions] Failed to resolve tenant by slug', {
      slug,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

export async function getTenantSlugForTenant(tenantId: string): Promise<string> {
  return buildTenantPortalSlug(tenantId);
}
