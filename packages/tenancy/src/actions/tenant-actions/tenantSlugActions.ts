'use server';

import { getTenantIdBySlug as _getTenantIdBySlug, getTenantSlugForTenant as _getTenantSlugForTenant } from '@alga-psa/db';

// Re-export async server actions from @alga-psa/db for backward compatibility
// The actual implementation is in @alga-psa/db/lib/tenantSlug to avoid circular dependencies
// Note: Utility functions (buildTenantPortalSlug, isValidTenantSlug, getSlugParts)
// are not re-exported here since 'use server' files can only export async functions.
// Import those directly from '@alga-psa/db' or '@alga-psa/validation'.

export async function getTenantIdBySlug(slug: string): Promise<string | null> {
  return _getTenantIdBySlug(slug);
}

export async function getTenantSlugForTenant(tenantId: string): Promise<string> {
  return _getTenantSlugForTenant(tenantId);
}
