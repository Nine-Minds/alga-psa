import type { Knex } from 'knex';
import { countActiveServicePrincipals, resolveServicePrincipalLimit } from './entitlements';

export interface ServicePrincipalUsage {
  limit: number;
  used: number;
  remaining: number;
}

/** R7.1. Seats are never involved; archived and inactive principals do not count. */
export async function getServicePrincipalUsage(
  knex: Knex | Knex.Transaction,
  tenant: string,
): Promise<ServicePrincipalUsage> {
  const [limit, used] = await Promise.all([
    resolveServicePrincipalLimit(knex, tenant),
    countActiveServicePrincipals(knex, tenant),
  ]);
  return { limit, used, remaining: Math.max(0, limit - used) };
}
