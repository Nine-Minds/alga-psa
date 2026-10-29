import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { CoManagedSharedResource } from './sharedWork';
import { readCoManagedResourceGrant } from './sharedWork';

/** Effective source disclosure only, inside an already admitted transaction.
 * Callers separately enforce active trust, identity and operation permissions.
 * This is the same grant layer `evaluateCoManagedAccess` consumes: it reuses
 * `readCoManagedResourceGrant`, so there is one definition of "granted". */
export async function hasEffectiveSharedGrant(trx: Knex.Transaction, resource: CoManagedSharedResource): Promise<boolean> {
  const relationship = await tenantDb(trx, resource.tenant).table('co_management_relationships')
    .where('relationship_id', resource.relationshipId).first('visibility_mode');
  if (!relationship) return false;
  return Boolean(await readCoManagedResourceGrant(trx, resource, relationship.visibility_mode));
}
