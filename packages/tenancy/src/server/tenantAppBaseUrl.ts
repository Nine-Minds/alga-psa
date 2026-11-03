import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';
import { portalDomainServes } from '@alga-psa/shared/core/portalDomainSurface';
import type { AppSurface } from '@alga-psa/shared/core/portalDomainSurface';
import { listPortalDomains } from '../lib/PortalDomainModel';

export type { AppSurface };

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * The canonical (non-vanity) public origin, resolved the same way the portal login link
 * and invoice link code do. Empty string when nothing is configured.
 */
function getCanonicalBaseUrl(): string {
  const configured =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.HOST ? `https://${process.env.HOST}` : '');
  return trimTrailingSlashes(configured);
}

export interface TenantAppBase {
  /** Origin, no trailing slash. '' when neither a custom domain nor a canonical base exists. */
  baseUrl: string;
  source: 'vanity' | 'canonical';
}

/**
 * Like {@link getTenantAppBaseUrl} but also reports whether the origin is the tenant's
 * custom domain, for callers that build different paths/params per source (e.g. the
 * portal login link adds `?tenant=<slug>` only on the canonical host). `options.knex`
 * lets unauthenticated flows reuse an admin connection.
 */
export async function resolveTenantAppBase(
  tenant: string,
  surface: AppSurface,
  options: { knex?: Knex } = {}
): Promise<TenantAppBase> {
  try {
    const knex = options.knex ?? (await createTenantKnex(tenant)).knex;
    const domains = await listPortalDomains(knex, tenant);
    const serving = domains.filter(
      (candidate) =>
        candidate.status === 'active' &&
        Boolean(candidate.domain) &&
        portalDomainServes(candidate.surface, surface)
    );
    const match = serving.find((candidate) => candidate.surface === surface) ?? serving[0];
    if (match) {
      return { baseUrl: `https://${match.domain}`, source: 'vanity' };
    }
  } catch (error) {
    logger.warn('[getTenantAppBaseUrl] Failed to resolve custom domain; using canonical base URL', {
      tenant,
      surface,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { baseUrl: getCanonicalBaseUrl(), source: 'canonical' };
}

/**
 * Origin (no trailing slash) for links sent to a tenant's recipients of the given app.
 *
 * Returns `https://<domain>` when the tenant has an ACTIVE custom domain whose surface
 * serves `surface` (a dedicated-surface domain wins over a `both` domain); otherwise the
 * canonical base (NEXTAUTH_URL, then NEXT_PUBLIC_BASE_URL, then https://HOST). Returns ''
 * if neither exists so callers can keep their own last-resort default. Never throws:
 * any lookup failure falls back to canonical.
 *
 * Billing/invoice emails deliberately do not use this (see invoiceEmailLinkContext).
 */
export async function getTenantAppBaseUrl(tenant: string, surface: AppSurface): Promise<string> {
  return (await resolveTenantAppBase(tenant, surface)).baseUrl;
}
