import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedEntitlementState } from './co-managed-entitlements';

export {
  CoManagedLifecycleError,
  isCoManagedLifecycleError,
  type CoManagedOperationalState,
} from './co-managed-lifecycle-error';
import { CoManagedLifecycleError, type CoManagedOperationalState } from './co-managed-lifecycle-error';

/** Lifecycle admission ran against a tenant that has no workspace row. Nothing
 * exists to admit, so callers with an HTTP contract answer "not found" rather
 * than reporting a server fault. */
export class CoManagedWorkspaceNotFoundError extends Error {
  constructor() {
    super('The workspace does not exist');
    this.name = 'CoManagedWorkspaceNotFoundError';
  }
}

/** Matches the explicit error contract, not a shared JS constructor: worker
 * adapters and API services can load separately compiled copies of this package. */
export function isCoManagedWorkspaceNotFoundError(error: unknown): error is CoManagedWorkspaceNotFoundError {
  return Boolean(error && typeof error === 'object' && (error as Error).name === 'CoManagedWorkspaceNotFoundError');
}

/** Read under the same lock order as acceptance, allocation, and termination:
 * sponsor entitlement, sponsor tenant, customer relationship, customer tenant.
 * The caller retains these locks until its operational write commits. This is
 * lifecycle admission, not resource authorization or a release-flag check. */
async function readState(trx: Knex.Transaction, tenant: string): Promise<CoManagedOperationalState> {
  if (!tenant) throw new Error('A tenant is required for lifecycle admission');
  const customer = tenantDb(trx, tenant);
  const workspace = await customer.table('tenants').first('product_code');
  if (!workspace) throw new CoManagedWorkspaceNotFoundError();
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
    if (!current) throw new CoManagedWorkspaceNotFoundError();
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

// A tenant is created co-managed or not and only ever leaves that product
// (independent upgrade), so a tenant seen as anything else stays that way.
const notCoManagedTenants = new Set<string>();

/**
 * Request admission, not write authorization: is this a co-managed workspace
 * whose relationship the customer has not accepted yet? Until then the
 * workspace may only be reviewed and accepted, so request gates (server
 * actions, the REST API) refuse everything else. It takes none of the
 * admission locks; writes still use assertCoManagedOperationalWrite.
 */
export async function isCoManagedAwaitingAcceptance(db: Knex, tenant: string): Promise<boolean> {
  if (!tenant || notCoManagedTenants.has(tenant)) return false;
  const customer = tenantDb(db, tenant);
  const workspace = await customer.table('tenants').first('product_code');
  if (!workspace) return false;
  if (workspace.product_code !== 'co_managed') {
    notCoManagedTenants.add(tenant);
    return false;
  }
  const relationship = await customer.table('co_management_relationships').whereNull('ended_at').first('state');
  return Boolean(relationship && relationship.state !== 'active' && relationship.state !== 'terminated');
}

/** The refusal a request gate raises for isCoManagedAwaitingAcceptance. */
export function coManagedAcceptancePendingError(): CoManagedLifecycleError {
  return new CoManagedLifecycleError({ state: 'pending_acceptance', canWrite: false, graceEndsAt: null });
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
