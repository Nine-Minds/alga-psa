import logger from '@alga-psa/core/logger';
import { getPortalDomainStatusForTenant } from './portalDomainStatus';

function parseHttpOrigin(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The single public origin of a tenant's client portal, for links in
 * client-facing emails and notifications. A tenant has one portal origin; the
 * path decides what opens.
 *
 * Order: the tenant's custom domain (only when its status is `active`, i.e. it
 * is verified and has a certificate) -> NEXT_PUBLIC_BASE_URL -> NEXTAUTH_URL ->
 * `https://$HOST` -> null. Null means "no link": callers omit the link rather
 * than send an internal or localhost URL.
 */
export async function getTenantPortalBaseUrl(tenantId: string): Promise<string | null> {
  try {
    const portalDomain = await getPortalDomainStatusForTenant(tenantId);
    if (portalDomain.status === 'active' && portalDomain.domain) {
      const origin = parseHttpOrigin(`https://${portalDomain.domain}`);
      if (origin) return origin;
    } else if (portalDomain.domain) {
      logger.warn('[tenancy/tenantPortalUrl] Custom portal domain is not active; using the base URL', {
        tenantId,
        status: portalDomain.status,
      });
    }
  } catch (error) {
    logger.warn('[tenancy/tenantPortalUrl] Failed to resolve custom portal domain; using the base URL', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const candidates = [
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.NEXTAUTH_URL,
    process.env.HOST ? `https://${process.env.HOST}` : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const origin = parseHttpOrigin(candidate);
    if (origin) return origin;
    logger.warn('[tenancy/tenantPortalUrl] Ignoring invalid public base URL', { tenantId, candidate });
  }
  return null;
}

/** Absolute client-portal URL for `path`, or null when no public origin exists. */
export async function buildTenantPortalUrl(
  tenantId: string,
  path: string,
  params?: Record<string, string | null | undefined>,
): Promise<string | null> {
  const origin = await getTenantPortalBaseUrl(tenantId);
  if (!origin) return null;

  const url = new URL(path.startsWith('/') ? path : `/${path}`, origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
