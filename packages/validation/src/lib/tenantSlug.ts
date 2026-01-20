/**
 * Tenant slug utilities
 *
 * Moved from shared/utils/tenantSlug.ts to break circular dependency:
 * auth -> shared -> integrations -> users -> auth
 */

const TENANT_ID_HEX_LENGTH = 32;
const TENANT_SLUG_LENGTH = 12;
const TENANT_SLUG_REGEX = /^[a-f0-9]{12}$/;

function normalizeTenantId(tenantId: string): string {
  if (!tenantId) {
    throw new Error('Tenant ID is required to build a portal slug');
  }

  const normalized = tenantId.replace(/-/g, '').toLowerCase();
  if (normalized.length !== TENANT_ID_HEX_LENGTH) {
    throw new Error(`Tenant ID must be a UUID with ${TENANT_ID_HEX_LENGTH} hex characters`);
  }
  return normalized;
}

export function buildTenantPortalSlug(tenantId: string): string {
  const normalized = normalizeTenantId(tenantId);
  return `${normalized.slice(0, 6)}${normalized.slice(-6)}`;
}

export function isValidTenantSlug(slug: string | null | undefined): slug is string {
  if (!slug) {
    return false;
  }
  return TENANT_SLUG_REGEX.test(slug.trim().toLowerCase());
}

export function getSlugParts(slug: string): { prefix: string; suffix: string } {
  if (!isValidTenantSlug(slug)) {
    throw new Error('Invalid tenant slug');
  }
  const normalized = slug.trim().toLowerCase();
  return {
    prefix: normalized.slice(0, 6),
    suffix: normalized.slice(-6),
  };
}

export { TENANT_SLUG_REGEX };
