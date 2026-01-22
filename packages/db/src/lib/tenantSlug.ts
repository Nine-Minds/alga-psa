'use server';

import { getAdminConnection } from './admin';

/**
 * Validates that a string matches the expected tenant slug format (12 hex characters).
 */
export function isValidTenantSlug(slug: string): boolean {
  return /^[a-f0-9]{12}$/i.test(slug);
}

/**
 * Splits a tenant slug into its prefix and suffix parts.
 */
export function getSlugParts(slug: string): { prefix: string; suffix: string } {
  return {
    prefix: slug.slice(0, 6).toLowerCase(),
    suffix: slug.slice(6, 12).toLowerCase(),
  };
}

/**
 * Builds a tenant portal slug from a tenant UUID.
 */
export function buildTenantPortalSlug(tenantId: string): string {
  const cleanId = tenantId.replace(/-/g, '');
  return (cleanId.slice(0, 6) + cleanId.slice(-6)).toLowerCase();
}

/**
 * Resolves a tenant slug to a tenant UUID.
 * Returns null if the slug is invalid or no matching tenant is found.
 */
export async function getTenantIdBySlug(slug: string): Promise<string | null> {
  if (!isValidTenantSlug(slug)) {
    console.warn('[tenantSlug] Invalid tenant slug received', { slug });
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
      console.error('[tenantSlug] Multiple tenants matched slug', {
        slug,
        tenantIds: matches.map((match) => match.tenant),
      });
      return null;
    }

    console.warn('[tenantSlug] No tenant found for slug', { slug });
    return null;
  } catch (error) {
    console.error('[tenantSlug] Failed to resolve tenant by slug', {
      slug,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

/**
 * Gets the tenant slug for a given tenant UUID.
 */
export async function getTenantSlugForTenant(tenantId: string): Promise<string> {
  return buildTenantPortalSlug(tenantId);
}
