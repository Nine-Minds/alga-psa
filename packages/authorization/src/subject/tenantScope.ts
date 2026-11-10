import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AuthorizationRequestCache } from '../kernel/contracts';
import { publishedAssignmentsQuery } from '../bundles/publishedAssignments';

/**
 * What a tenant has configured that can change an authorization decision beyond
 * RBAC and built-in rules. A tenant with neither is on the fast path: no subject
 * has a stored portfolio and no bundle rule can apply, so those loads are skipped.
 */
export interface TenantAuthorizationScope {
  /** At least one active assignment of an active bundle with a published revision. */
  publishedAssignments: boolean;
  /** At least one `user_client_portfolios` row. */
  portfolios: boolean;
}

/** The answer taken when the probe cannot be trusted: everything is loaded. */
export const SLOW_PATH_TENANT_SCOPE: TenantAuthorizationScope = Object.freeze({
  publishedAssignments: true,
  portfolios: true,
});

function cacheKey(tenant: string): string {
  return `authorization:tenant-scope:${tenant}`;
}

/** The probe result this request already holds, or undefined. Never issues a statement. */
export function peekTenantAuthorizationScope(
  cache: AuthorizationRequestCache | undefined,
  tenant: string
): TenantAuthorizationScope | undefined {
  // A cache that cannot be read holds nothing: the caller probes.
  return typeof cache?.get === 'function' ? cache.get<TenantAuthorizationScope>(cacheKey(tenant)) : undefined;
}

/**
 * One statement answers both questions. Cached per request and tenant, so every
 * evaluation in a request after the first costs nothing. A failed probe is not
 * cached and reports the slow path: when unsure, load everything.
 */
export async function probeTenantAuthorizationScope(
  knex: Knex | Knex.Transaction,
  tenant: string,
  cache?: AuthorizationRequestCache
): Promise<TenantAuthorizationScope> {
  const cached = peekTenantAuthorizationScope(cache, tenant);
  if (cached) return cached;
  if (!tenant) return SLOW_PATH_TENANT_SCOPE;

  let scope: TenantAuthorizationScope;
  try {
    const row = await knex.queryBuilder()
      .select(
        knex.raw('exists(?) as "publishedAssignments"', [publishedAssignmentsQuery(knex, tenant).select(knex.raw('1'))]),
        knex.raw('exists(?) as "portfolios"', [tenantDb(knex, tenant).table('user_client_portfolios').select(knex.raw('1'))])
      )
      .first<{ publishedAssignments: boolean; portfolios: boolean }>();
    if (!row || typeof row.publishedAssignments !== 'boolean' || typeof row.portfolios !== 'boolean') {
      return SLOW_PATH_TENANT_SCOPE;
    }
    scope = { publishedAssignments: row.publishedAssignments, portfolios: row.portfolios };
  } catch {
    return SLOW_PATH_TENANT_SCOPE;
  }

  if (typeof cache?.set === 'function') cache.set(cacheKey(tenant), scope);
  return scope;
}
