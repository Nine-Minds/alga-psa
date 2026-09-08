import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { countCoManagedCommittedSeats } from '@alga-psa/licensing';
import { hasCoManagedLocalPermission } from './localPermission';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { closeCoManagedRelationship } from './relationshipClosure';
import { finalizeCoManagedArchive } from './archiveFinalization';
import { coManagedArchiveManifestHash } from './archiveManifest';
import type { CoManagedPolicyTarget } from './policy';

export interface CoManagedIndependentUpgradeRequest { operationId: string; expectedRevision: number }
export interface CoManagedIndependentEntitlement {
  source: 'tenant_license' | 'stripe'; reference: string; seats: number | null; validUntil: Date;
}
export interface CoManagedIndependentUpgradeReceipt {
  operationId: string; customerTenant: string; relationshipId: string; closureOperationId: string;
  productCode: 'psa'; seats: number | null; upgradedAt: string;
}
export class CoManagedIndependentUpgradeError extends Error {
  constructor(public readonly code: 'INVALID_UPGRADE' | 'UPGRADE_CHANGED' | 'PAID_ENTITLEMENT_REQUIRED' | 'INSUFFICIENT_PSA_SEATS') {
    super(code); this.name = 'CoManagedIndependentUpgradeError';
  }
}
const receipt = (row: any): CoManagedIndependentUpgradeReceipt => ({ operationId: row.operation_id, customerTenant: row.tenant,
  relationshipId: row.relationship_id, closureOperationId: row.closure_operation_id, productCode: 'psa', seats: row.seats,
  upgradedAt: new Date(row.upgraded_at).toISOString() });

/** Internal upgrade coordinator. The concrete adapter must retain the customer's
 * own paid entitlement and seed PSA capabilities in this transaction; it must
 * never perform a provider purchase or alter the MSP subscription here. */
export async function upgradeCoManagedRelationship(db: Knex, inputActor: CoManagedSessionActor,
  inputTarget: CoManagedPolicyTarget, input: CoManagedIndependentUpgradeRequest,
  preparePsa: (trx: Knex.Transaction, tenant: string) => Promise<CoManagedIndependentEntitlement>): Promise<CoManagedIndependentUpgradeReceipt> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!inputTarget || !input || ![inputTarget.customerTenant, inputTarget.relationshipId, input.operationId].every(isCoManagedUuid) ||
      !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision >= 2147483647 ||
      typeof preparePsa !== 'function') throw new CoManagedIndependentUpgradeError('INVALID_UPGRADE');
  const target = { customerTenant: inputTarget.customerTenant, relationshipId: inputTarget.relationshipId };
  const request = { operationId: input.operationId, expectedRevision: input.expectedRevision };
  if (actor.tenant !== target.customerTenant) throw new CoManagedSharedWorkError();
  const fingerprint = createHash('sha256').update(JSON.stringify({ actor: { tenant: actor.tenant, userId: actor.userId }, target, request })).digest('hex');
  return withTransaction(db, async trx => {
    const customer = tenantDb(trx, target.customerTenant);
    const found = await customer.table('co_management_relationships').where('relationship_id', target.relationshipId).first('sponsor_tenant');
    if (!found || found.sponsor_tenant === actor.tenant) throw new CoManagedSharedWorkError();
    const sponsor = tenantDb(trx, found.sponsor_tenant);
    // Same lock order as operational admission, capacity changes and closure.
    await sponsor.table('co_managed_entitlements').forUpdate().first();
    await sponsor.table('tenants').forShare().first('tenant');
    const relationship = await customer.table('co_management_relationships').where('relationship_id', target.relationshipId).forUpdate().first();
    const owner = await customer.table('tenants').forUpdate().first('product_code');
    if (!owner || !relationship || relationship.sponsor_tenant !== found.sponsor_tenant) throw new CoManagedSharedWorkError();
    await lockCoManagedSessionIdentity(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'co_management', 'manage', true)) throw new CoManagedSharedWorkError();
    await assertCoManagedSessionUnexpired(trx, actor);
    const previous = await customer.table('co_managed_independent_upgrades').where('operation_id', request.operationId).first();
    if (previous) {
      if (previous.request_fingerprint !== fingerprint || owner.product_code !== 'psa') throw new CoManagedIndependentUpgradeError('UPGRADE_CHANGED');
      await assertCoManagedSessionUnexpired(trx, actor);
      return receipt(previous);
    }
    if (owner.product_code !== 'co_managed' || relationship.revision !== request.expectedRevision ||
        !['active', 'terminated'].includes(relationship.state)) throw new CoManagedIndependentUpgradeError('UPGRADE_CHANGED');

    // Paid entitlement is verified by the runtime adapter under these retained
    // locks, including for license-paused and already-departed customers.
    const entitlement = await preparePsa(trx, target.customerTenant);
    const paid = { source: entitlement.source, reference: entitlement.reference, seats: entitlement.seats,
      validUntil: new Date(entitlement.validUntil) };
    if (!['tenant_license', 'stripe'].includes(paid.source) || typeof paid.reference !== 'string' || !paid.reference ||
        !Number.isFinite(paid.validUntil.getTime()) ||
        (paid.seats !== null && (!Number.isSafeInteger(paid.seats) || paid.seats < 1 || paid.seats > 2147483647)))
      throw new CoManagedIndependentUpgradeError('PAID_ENTITLEMENT_REQUIRED');
    if (paid.seats !== null && await countCoManagedCommittedSeats(trx, target.customerTenant) > paid.seats)
      throw new CoManagedIndependentUpgradeError('INSUFFICIENT_PSA_SEATS');

    let closureOperationId: string;
    if (relationship.state === 'active' && !relationship.ended_at) {
      const closed = await closeCoManagedRelationship(trx, actor, target, { ...request, reason: 'independent_upgrade' }, finalizeCoManagedArchive);
      closureOperationId = closed.operationId;
    } else if (relationship.state === 'terminated' && relationship.ended_at) {
      // Departure already fixed its cutoff. Never reopen trust or revisit sources.
      const closed = await sponsor.table('co_managed_relationship_closures').where({ customer_tenant: target.customerTenant, relationship_id: target.relationshipId }).forShare().first();
      const seal = closed && await sponsor.table('co_managed_archive_manifests').where({ operation_id: closed.operation_id,
        customer_tenant: target.customerTenant, relationship_id: target.relationshipId }).forShare().first();
      if (!closed || !seal || closed.applied_revision !== relationship.revision ||
          new Date(closed.cutoff_at).getTime() !== new Date(seal.cutoff_at).getTime() ||
          coManagedArchiveManifestHash(seal, seal.manifest) !== seal.content_hash ||
          await sponsor.table('co_managed_allocations').where({ customer_tenant: target.customerTenant, relationship_id: target.relationshipId }).whereNot('state', 'released').first())
        throw new CoManagedIndependentUpgradeError('UPGRADE_CHANGED');
      closureOperationId = closed.operation_id;
    } else throw new CoManagedIndependentUpgradeError('UPGRADE_CHANGED');

    const now = new Date((await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at);
    if (paid.validUntil.getTime() <= now.getTime()) throw new CoManagedIndependentUpgradeError('PAID_ENTITLEMENT_REQUIRED');
    if (await customer.table('tenants').where('product_code', 'co_managed').update({ product_code: 'psa', plan: 'pro',
      billing_source: paid.source === 'stripe' ? 'stripe' : 'manual', licensed_user_count: paid.seats }) !== 1)
      throw new CoManagedIndependentUpgradeError('UPGRADE_CHANGED');
    const row = { tenant: target.customerTenant, operation_id: request.operationId, relationship_id: target.relationshipId,
      sponsor_tenant: found.sponsor_tenant, closure_operation_id: closureOperationId, actor_user_id: actor.userId,
      request_fingerprint: fingerprint, entitlement_source: paid.source, entitlement_reference: paid.reference, seats: paid.seats,
      entitlement_valid_until: paid.validUntil, upgraded_at: now };
    await customer.table('co_managed_independent_upgrades').insert(row);
    await assertCoManagedSessionUnexpired(trx, actor);
    if (!await trx.select(trx.raw('1')).whereRaw('?::timestamptz > clock_timestamp()', [paid.validUntil]).first())
      throw new CoManagedIndependentUpgradeError('PAID_ENTITLEMENT_REQUIRED');
    return receipt(row);
  });
}
