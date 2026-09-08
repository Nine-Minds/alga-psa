import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { hasCoManagedLocalPermission } from './localPermission';
import { closeCoManagedRelationship } from './relationshipClosure';
import { finalizeCoManagedArchive } from './archiveFinalization';

/** Discovery never accepts a foreign tenant from the browser. MSP selectors are
 * provisioning operations owned by the authenticated home workspace. */
async function resolveDepartureTarget(db: Knex, actor: CoManagedSessionActor, provisioningOperationId?: string) {
  const own = tenantDb(db, actor.tenant);
  const owner = await own.table('tenants').first('product_code');
  if (owner?.product_code === 'co_managed' && provisioningOperationId === undefined) {
    const relationship = await own.table('co_management_relationships').whereIn('state', ['active', 'terminated'])
      .first('relationship_id', 'sponsor_tenant');
    if (relationship) return { side: 'customer' as const, customerTenant: actor.tenant,
      relationshipId: relationship.relationship_id as string, sponsorTenant: relationship.sponsor_tenant as string };
  }
  if (owner?.product_code === 'psa' && isCoManagedUuid(provisioningOperationId)) {
    const operation = await own.table('co_managed_provisioning_operations').where('operation_id', provisioningOperationId)
      .first('customer_tenant', 'relationship_id');
    if (operation) return { side: 'sponsor' as const, customerTenant: operation.customer_tenant as string,
      relationshipId: operation.relationship_id as string, sponsorTenant: actor.tenant };
  }
  throw new CoManagedSharedWorkError();
}

/** Advisory review remains available after license lapse and closure. Mutation
 * always independently rechecks current authority and the reviewed revision. */
export async function getCoManagedDepartureScreen(db: Knex, inputActor: CoManagedSessionActor, provisioningOperationId?: string) {
  const actor = snapshotCoManagedSessionActor(inputActor);
  return withTransaction(db, async trx => {
    const target = await resolveDepartureTarget(trx, actor, provisioningOperationId);
    const relationship = await tenantDb(trx, target.customerTenant).table('co_management_relationships')
      .where({ relationship_id: target.relationshipId, sponsor_tenant: target.sponsorTenant }).forShare()
      .first('state', 'revision', 'ended_at');
    if (!relationship || !['active', 'terminated'].includes(relationship.state)) throw new CoManagedSharedWorkError();
    await lockCoManagedSessionIdentity(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'co_management', 'manage', true)) throw new CoManagedSharedWorkError();
    const counterpart = await tenantDb(trx, target.side === 'customer' ? target.sponsorTenant : target.customerTenant)
      .table('tenants').first('client_name');
    await assertCoManagedSessionUnexpired(trx, actor);
    return { side: target.side, relationshipId: target.relationshipId, revision: Number(relationship.revision),
      counterpartName: (counterpart?.client_name ?? '') as string,
      departed: relationship.state === 'terminated', closedAt: relationship.ended_at ? new Date(relationship.ended_at).toISOString() : null };
  });
}

export interface CoManagedDepartureRequest {
  provisioningOperationId?: string;
  operationId: string;
  expectedRevision: number;
  relationshipId: string;
}

export async function departCoManagedRelationship(db: Knex, inputActor: CoManagedSessionActor, input: CoManagedDepartureRequest) {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!input || !isCoManagedUuid(input.relationshipId)) throw new CoManagedSharedWorkError();
  const request = { provisioningOperationId: input.provisioningOperationId, operationId: input.operationId,
    expectedRevision: input.expectedRevision, relationshipId: input.relationshipId };
  const target = await resolveDepartureTarget(db, actor, request.provisioningOperationId);
  if (target.relationshipId !== request.relationshipId) throw new CoManagedSharedWorkError();
  return closeCoManagedRelationship(db, actor, target, { operationId: request.operationId,
    expectedRevision: request.expectedRevision, reason: 'departure' }, finalizeCoManagedArchive);
}
