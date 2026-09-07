import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedEntitlementState } from './co-managed-entitlements';

export type CoManagedOperationalState =
  | { state: 'independent'; canWrite: true; graceEndsAt: null }
  | { state: 'active' | 'grace'; canWrite: true; graceEndsAt: string | null }
  | { state: 'pending_acceptance' | 'terminated' | 'read_only'; canWrite: false; graceEndsAt: string | null };

export class CoManagedLifecycleError extends Error {
  readonly code: 'CO_MANAGED_NOT_ACTIVE' | 'CO_MANAGED_READ_ONLY';

  constructor(public readonly lifecycle: CoManagedOperationalState) {
    super(lifecycle.state === 'pending_acceptance'
      ? 'The customer administrator must accept co-management before this workspace can be used.'
      : 'This co-managed workspace is read-only. Sign-in, reading, export, and license recovery remain available.');
    this.name = 'CoManagedLifecycleError';
    this.code = lifecycle.state === 'pending_acceptance' ? 'CO_MANAGED_NOT_ACTIVE' : 'CO_MANAGED_READ_ONLY';
  }
}

/** Worker adapters can load a separately compiled copy of this package. Match
 * the explicit error contract rather than relying on a shared JS constructor. */
export function isCoManagedLifecycleError(error: unknown): error is CoManagedLifecycleError & { lifecycle: Extract<CoManagedOperationalState, { canWrite: false }> } {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Partial<CoManagedLifecycleError>;
  const state = candidate.lifecycle;
  return candidate.name === 'CoManagedLifecycleError' && Boolean(state && state.canWrite === false &&
    ['pending_acceptance', 'terminated', 'read_only'].includes(state.state) &&
    (state.graceEndsAt === null || typeof state.graceEndsAt === 'string') &&
    candidate.code === (state.state === 'pending_acceptance' ? 'CO_MANAGED_NOT_ACTIVE' : 'CO_MANAGED_READ_ONLY'));
}

/** Read under the same lock order as acceptance, allocation, and termination:
 * sponsor entitlement, sponsor tenant, customer relationship, customer tenant.
 * The caller retains these locks until its operational write commits. This is
 * lifecycle admission, not resource authorization or a release-flag check. */
async function readState(trx: Knex.Transaction, tenant: string): Promise<CoManagedOperationalState> {
  if (!tenant) throw new Error('A tenant is required for lifecycle admission');
  const customer = tenantDb(trx, tenant);
  const workspace = await customer.table('tenants').first('product_code');
  if (!workspace) throw new Error('The workspace does not exist');
  if (workspace.product_code !== 'co_managed') return { state: 'independent', canWrite: true, graceEndsAt: null };

  // A terminated relationship is retained for export and historical identity.
  // It must never turn an orphaned co-managed product into an independent PSA.
  const found = await customer.table('co_management_relationships').whereNull('ended_at').first();
  if (!found) return { state: 'terminated', canWrite: false, graceEndsAt: null };
  const sponsor = tenantDb(trx, found.sponsor_tenant);
  await sponsor.table('co_managed_entitlements').forUpdate().first();
  await sponsor.table('tenants').forShare().first('tenant');
  const relationship = await customer.table('co_management_relationships')
    .where('relationship_id', found.relationship_id).forShare().first();
  const current = await customer.table('tenants').forShare().first('product_code');
  // An independent upgrade can win while we wait. Its complete transaction
  // must detach the relationship before the product becomes writable as PSA.
  if (current?.product_code !== 'co_managed') {
    if (!current) throw new Error('The workspace does not exist');
    if (relationship && !relationship.ended_at) throw new Error('The workspace upgrade has not detached co-management');
    return { state: 'independent', canWrite: true, graceEndsAt: null };
  }
  if (!relationship || relationship.ended_at || relationship.state === 'terminated' ||
      relationship.sponsor_tenant !== found.sponsor_tenant) {
    return { state: 'terminated', canWrite: false, graceEndsAt: null };
  }
  if (relationship.state !== 'active') return { state: 'pending_acceptance', canWrite: false, graceEndsAt: null };
  const allocation = await sponsor.table('co_managed_allocations').where({
    customer_tenant: tenant, relationship_id: relationship.relationship_id, state: 'active',
  }).first('allocation_id');
  if (!allocation) return { state: 'read_only', canWrite: false, graceEndsAt: null };
  const entitlement = await getCoManagedEntitlementState(trx, found.sponsor_tenant);
  if (entitlement.isReadOnly) return { state: 'read_only', canWrite: false, graceEndsAt: entitlement.graceEndsAt };
  return { state: entitlement.graceEndsAt ? 'grace' : 'active', canWrite: true, graceEndsAt: entitlement.graceEndsAt };
}

/** For lifecycle displays and intake scheduling. A successful probe does not
 * authorize a later write: use the transaction guard at the write boundary. */
export async function getCoManagedOperationalState(db: Knex, tenant: string): Promise<CoManagedOperationalState> {
  return withTransaction(db, trx => readState(trx, tenant));
}

/** Call before locking or changing operational rows, and keep this transaction
 * through the write. Bootstrap, initial invitation redemption, acceptance,
 * authentication, export, and paid upgrade have their own narrow authorization;
 * they must not call this operational guard or gain a general bypass option. */
export async function assertCoManagedOperationalWrite(trx: Knex.Transaction, tenant: string): Promise<void> {
  if (!trx.isTransaction) throw new Error('Operational lifecycle admission requires an open transaction');
  const state = await readState(trx, tenant);
  if (!state.canWrite) throw new CoManagedLifecycleError(state);
}

/** Keep the standard after-commit hooks when opening an operational transaction. */
export async function withCoManagedOperationalTransaction<T>(
  db: Knex, tenant: string, work: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return withTransaction(db, async trx => {
    await assertCoManagedOperationalWrite(trx, tenant);
    return work(trx);
  });
}
