import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState } from '@alga-psa/licensing/lifecycle';
import { resolveSlaPolicy } from '@alga-psa/shared/lib/sla/slaPolicyResolver';
import type { Knex } from 'knex';
import { CoManagedPolicyError, getCoManagedCollaborationPolicy, type CoManagedPolicyTarget } from './policy';
import { hasCoManagedLocalPermission } from './localPermission';
import type { CoManagedHomeActor } from './sharedWorkIdentity';

export interface CoManagedSlaPriorityMapping { customerPriorityId: string; mspPriorityId: string }
export interface CoManagedSlaPolicyScreen {
  canWrite: boolean;
  /** Name of the MSP policy that will govern new obligations; null when none is configured. */
  policyName: string | null;
  customerPriorities: { priority_id: string; priority_name: string }[];
  mspPriorities: { priority_id: string; priority_name: string }[];
  mappings: CoManagedSlaPriorityMapping[];
}
const MAX_MAPPINGS = 200;

/** Mapping is the MSP's own configuration: only the sponsor reads or writes it, and a sponsor is
 * authorised to see the relationship only through the single access evaluator (policy read). */
async function sponsorContext(db: Knex, actor: CoManagedHomeActor, target: CoManagedPolicyTarget) {
  if (actor.tenant === target.customerTenant) throw new CoManagedPolicyError('FORBIDDEN');
  const policy = await getCoManagedCollaborationPolicy(db, actor, target); // throws unless the actor may read
  if (policy.sponsorTenant !== actor.tenant) throw new CoManagedPolicyError('FORBIDDEN');
  const relationship = await tenantDb(db, target.customerTenant).table('co_management_relationships')
    .where('relationship_id', target.relationshipId).first('sponsor_client_id', 'escalation_board_id');
  if (!relationship) throw new CoManagedPolicyError('RESOURCE_NOT_FOUND');
  return relationship as { sponsor_client_id: string; escalation_board_id: string };
}

export async function readCoManagedSlaPolicyScreen(db: Knex, actor: CoManagedHomeActor, target: CoManagedPolicyTarget): Promise<CoManagedSlaPolicyScreen> {
  const relationship = await sponsorContext(db, actor, target);
  const lifecycle = await getCoManagedOperationalState(db, target.customerTenant);
  const canManage = await hasCoManagedLocalPermission(db, actor, 'co_management', 'manage');
  return withTransaction(db, async trx => {
    const owner = tenantDb(trx, actor.tenant), customer = tenantDb(trx, target.customerTenant);
    const policy = await resolveSlaPolicy(trx, actor.tenant, relationship.sponsor_client_id, relationship.escalation_board_id);
    return {
      canWrite: canManage && lifecycle.canWrite, policyName: policy?.policy_name ?? null,
      customerPriorities: await customer.table('priorities').where('item_type', 'ticket').orderBy('order_number').select('priority_id', 'priority_name'),
      mspPriorities: await owner.table('priorities').where('item_type', 'ticket').orderBy('order_number').select('priority_id', 'priority_name'),
      mappings: (await owner.table('co_managed_sla_priority_mappings').where({ customer_tenant: target.customerTenant, relationship_id: target.relationshipId })
        .select('customer_priority_id', 'msp_priority_id')).map((row: any) => ({ customerPriorityId: row.customer_priority_id, mspPriorityId: row.msp_priority_id })),
    };
  });
}

/** Replaces the whole mapping set for one relationship. Open obligations snapshot their target at
 * start, so a change here only affects obligations started afterwards. */
export async function replaceCoManagedSlaPriorityMappings(db: Knex, actor: CoManagedHomeActor, target: CoManagedPolicyTarget,
  mappings: readonly CoManagedSlaPriorityMapping[]): Promise<void> {
  if (!Array.isArray(mappings) || mappings.length > MAX_MAPPINGS) throw new CoManagedPolicyError('INVALID_POLICY');
  const desired = new Map<string, string>();
  for (const row of mappings) {
    if (!row || typeof row.customerPriorityId !== 'string' || typeof row.mspPriorityId !== 'string' || desired.has(row.customerPriorityId)) {
      throw new CoManagedPolicyError('INVALID_POLICY');
    }
    desired.set(row.customerPriorityId, row.mspPriorityId);
  }
  await sponsorContext(db, actor, target);
  if (!(await hasCoManagedLocalPermission(db, actor, 'co_management', 'manage'))) throw new CoManagedPolicyError('PERMISSION_DENIED');
  await withTransaction(db, async trx => {
    await assertCoManagedOperationalWrite(trx, target.customerTenant);
    const owner = tenantDb(trx, actor.tenant), customer = tenantDb(trx, target.customerTenant);
    const ids = [...desired.keys()], mspIds = [...new Set(desired.values())];
    // Both ends must be real ticket priorities in their owning workspace.
    if (ids.length && (await customer.table('priorities').where('item_type', 'ticket').whereIn('priority_id', ids).count({ n: '*' }).first())?.n != ids.length) {
      throw new CoManagedPolicyError('RESOURCE_NOT_FOUND');
    }
    if (mspIds.length && (await owner.table('priorities').where('item_type', 'ticket').whereIn('priority_id', mspIds).count({ n: '*' }).first())?.n != mspIds.length) {
      throw new CoManagedPolicyError('RESOURCE_NOT_FOUND');
    }
    const scope = { customer_tenant: target.customerTenant, relationship_id: target.relationshipId };
    // write-admission: exempt — co-managed SLA mapping state; admitted above by assertCoManagedOperationalWrite in this same transaction (delete + insert below)
    await owner.table('co_managed_sla_priority_mappings').where(scope).delete();
    if (desired.size) await owner.table('co_managed_sla_priority_mappings').insert([...desired].map(([customer_priority_id, msp_priority_id]) =>
      ({ tenant: actor.tenant, ...scope, customer_priority_id, msp_priority_id })));
  });
}
