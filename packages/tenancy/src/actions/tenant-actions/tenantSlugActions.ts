'use server';

// Re-export from @alga-psa/db for backward compatibility
// The actual implementation is in @alga-psa/db/lib/tenantSlug to avoid circular dependencies
export {
  getTenantIdBySlug,
  getTenantSlugForTenant,
  buildTenantPortalSlug,
  isValidTenantSlug,
  getSlugParts
} from '@alga-psa/db';
