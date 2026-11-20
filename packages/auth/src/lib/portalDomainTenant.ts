import logger from '@alga-psa/core/logger';

/** Hostname candidates for a host that may carry a port: as given, then without the port. */
function hostCandidates(normalized: string): string[] {
  return normalized.includes(':') ? [normalized, normalized.replace(/:\d+$/, '')] : [normalized];
}

/**
 * Tenant that owns an active portal domain, or null. The one place a vanity host
 * becomes a tenant: credentials sign-in and password reset both call it.
 */
export async function resolveTenantFromPortalDomain(portalDomain: string): Promise<string | null> {
  const normalized = portalDomain.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  try {
    const { getAdminConnection } = await import('@alga-psa/db/admin');
    const { getPortalDomainByHostname } = await import('./PortalDomainModel');
    const knex = await getAdminConnection();

    for (const candidate of hostCandidates(normalized)) {
      const record = await getPortalDomainByHostname(knex, candidate);
      if (record?.status === 'active') {
        return record.tenant;
      }
    }

    logger.warn('[portalDomainTenant] No active portal domain for host', { portalDomain: normalized });
    return null;
  } catch (error) {
    logger.warn('[portalDomainTenant] Failed to resolve tenant from portal domain', {
      portalDomain: normalized,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * The host a tenant's client-portal links should use: one of its active
 * client-portal domains, `preferred` when it is one of them. Null when the
 * tenant has none.
 */
export async function getActiveClientPortalDomainForTenant(
  tenant: string,
  preferred?: string | null
): Promise<string | null> {
  try {
    const { getAdminConnection } = await import('@alga-psa/db/admin');
    const { tenantDb } = await import('@alga-psa/db');
    const { PORTAL_DOMAIN_TABLE } = await import('./PortalDomainModel');
    const knex = await getAdminConnection();
    const rows = await tenantDb(knex, tenant)
      .table<{ domain: string; status: string; surface: string; created_at: Date }>(PORTAL_DOMAIN_TABLE)
      .where({ status: 'active' })
      .whereIn('surface', ['client_portal', 'both'])
      .orderBy('created_at', 'asc')
      .orderBy('domain', 'asc');
    if (rows.length === 0) {
      return null;
    }
    const wanted = preferred ? hostCandidates(preferred.trim().toLowerCase()) : [];
    const match = rows.find((row) => wanted.includes(row.domain.trim().toLowerCase()));
    return (match ?? rows[0]).domain;
  } catch (error) {
    logger.warn('[portalDomainTenant] Failed to load tenant portal domain', {
      tenant,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}
