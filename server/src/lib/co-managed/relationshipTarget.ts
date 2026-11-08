import { tenantDb } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid } from '@alga-psa/co-managed';
import type { Knex } from 'knex';

export interface CoManagedRelationshipTarget { customerTenant: string; relationshipId: string; side: 'customer' | 'sponsor' }

/**
 * Browsers address a relationship by its id only; the owning customer tenant is
 * resolved here from the signed-in workspace's own rows. A customer finds the
 * relationship in its own tenant; a sponsor finds it through the provisioning
 * operation it started. Anything else is the same opaque refusal as a denial.
 * The result is a locator, not an authorization: every reader still runs the
 * single access evaluator.
 */
export async function resolveCoManagedRelationshipTarget(knex: Knex, tenant: string, relationshipId: string): Promise<CoManagedRelationshipTarget> {
  if (!isCoManagedUuid(relationshipId)) throw new CoManagedSharedWorkError();
  const home = tenantDb(knex, tenant);
  if (await home.table('co_management_relationships').where({ relationship_id: relationshipId }).first('relationship_id')) {
    return { customerTenant: tenant, relationshipId, side: 'customer' };
  }
  const operation = await home.table('co_managed_provisioning_operations').where({ relationship_id: relationshipId }).first('customer_tenant');
  if (!operation?.customer_tenant) throw new CoManagedSharedWorkError();
  return { customerTenant: operation.customer_tenant as string, relationshipId, side: 'sponsor' };
}
