/**
 * Co-managed lifecycle admission: provider dispatch, plus the relationship-backed provider.
 *
 * The dispatchers read no table. With no provider registered every workspace is
 * `independent` and writable, and no SQL is issued. `coManagedLifecycleProvider` is the
 * provider that reads the relationship tables; the co-managed capability module registers
 * it (and the write-admission provider) when it is imported at server and worker boot.
 */
import type { Knex } from 'knex';
import { admitWrite, tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedEntitlementState } from './co-managed-entitlements';

export {
  CoManagedLifecycleError,
  isCoManagedLifecycleError,
  coManagedRefusalMessageKey,
  type CoManagedOperationalState,
} from './co-managed-lifecycle-error';
import { CoManagedLifecycleError, type CoManagedOperationalState } from './co-managed-lifecycle-error';

/** Write-admission operation name used for operational writes. */
export const CO_MANAGED_OPERATIONAL_WRITE = 'co-managed-operational-write';

const INDEPENDENT: CoManagedOperationalState = { state: 'independent', canWrite: true, graceEndsAt: null };

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

export interface CoManagedLifecycleProvider {
  /** Reads the state under the owning domain's lock order. Receives the caller's transaction. */
  readState(trx: Knex.Transaction, tenant: string): Promise<CoManagedOperationalState>;
  /** Lock-free request gate: has the customer not yet accepted co-management? */
  isAwaitingAcceptance?(db: Knex, tenant: string): Promise<boolean>;
  /** The answer if this process already knows it (no I/O), else undefined. */
  peekAwaitingAcceptance?(tenant: string): boolean | undefined;
}

declare global {
  // eslint-disable-next-line no-var
  var __algaCoManagedLifecycleProvider: CoManagedLifecycleProvider | undefined;
}

export function registerCoManagedLifecycleProvider(provider: CoManagedLifecycleProvider): void {
  globalThis.__algaCoManagedLifecycleProvider = provider;
}

export function resetCoManagedLifecycleProvider(): void {
  globalThis.__algaCoManagedLifecycleProvider = undefined;
}

/**
 * Request admission, not write authorization: is this a co-managed workspace
 * whose relationship the customer has not accepted yet? No provider ⇒ false.
 */
export async function isCoManagedAwaitingAcceptance(db: Knex, tenant: string): Promise<boolean> {
  const provider = globalThis.__algaCoManagedLifecycleProvider;
  if (!provider?.isAwaitingAcceptance || !tenant) return false;
  return provider.isAwaitingAcceptance(db, tenant);
}

/**
 * Same question for request gates that must not touch the database when the
 * answer is cached: the connection is requested lazily, only on a cache miss.
 * (Acquiring the admin connection runs a writability probe, so a caller that
 * resolved it up front would pay a statement on every request.)
 */
export async function isCoManagedAwaitingAcceptanceLazily(
  getDb: () => Promise<Knex>, tenant: string,
): Promise<boolean> {
  const provider = globalThis.__algaCoManagedLifecycleProvider;
  if (!provider?.isAwaitingAcceptance || !tenant) return false;
  const known = provider.peekAwaitingAcceptance?.(tenant);
  if (known !== undefined) return known;
  return provider.isAwaitingAcceptance(await getDb(), tenant);
}

/** The refusal a request gate raises for isCoManagedAwaitingAcceptance. */
export function coManagedAcceptancePendingError(): CoManagedLifecycleError {
  return new CoManagedLifecycleError({ state: 'pending_acceptance', canWrite: false, graceEndsAt: null });
}

/** For lifecycle displays and intake scheduling. A successful probe does not
 * authorize a later write: use the transaction guard at the write boundary.
 * No provider ⇒ `independent`, with no transaction opened. */
export async function getCoManagedOperationalState(db: Knex, tenant: string): Promise<CoManagedOperationalState> {
  const provider = globalThis.__algaCoManagedLifecycleProvider;
  if (!provider) return INDEPENDENT;
  return withTransaction(db, trx => provider.readState(trx, tenant));
}

/** Call before locking or changing operational rows, and keep this transaction
 * through the write. Dispatches through write admission: no provider ⇒ admit, no SQL. */
export async function assertCoManagedOperationalWrite(trx: Knex.Transaction, tenant: string): Promise<void> {
  await admitWrite(trx, { tenant, operation: CO_MANAGED_OPERATIONAL_WRITE });
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

/** Read under the same lock order as acceptance, allocation, and termination:
 * sponsor entitlement, sponsor tenant, customer relationship, customer tenant.
 * The caller retains these locks until its operational write commits. This is
 * lifecycle admission, not resource authorization or a release-flag check. */
async function readState(trx: Knex.Transaction, tenant: string): Promise<CoManagedOperationalState> {
  if (!tenant) throw new Error('A tenant is required for lifecycle admission');
  const customer = tenantDb(trx, tenant);
  const workspace = await customer.table('tenants').first('product_code');
  if (!workspace) throw new CoManagedWorkspaceNotFoundError();
  if (workspace.product_code !== 'co_managed') return INDEPENDENT;

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
    return INDEPENDENT;
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

// Only stable negative answers can be cached across requests. Pending state can
// become active in another process at any time; never retain it, including when
// a read started before acceptance and finishes after the commit.
const notAwaitingAcceptance = new Set<string>();

/** Forget this process's answer after a lifecycle transition commits. */
export function invalidateCoManagedAwaitingAcceptance(tenant: string): void {
  notAwaitingAcceptance.delete(tenant);
}

/** Test seam: forget every cached awaiting-acceptance answer. */
export function resetCoManagedAwaitingAcceptanceCache(): void {
  notAwaitingAcceptance.clear();
}

function peekAwaitingAcceptance(tenant: string): boolean | undefined {
  return notAwaitingAcceptance.has(tenant) ? false : undefined;
}

async function isAwaitingAcceptance(db: Knex, tenant: string): Promise<boolean> {
  if (notAwaitingAcceptance.has(tenant)) return false;
  const customer = tenantDb(db, tenant);
  const workspace = await customer.table('tenants').first('product_code');
  if (!workspace) return false;
  if (workspace.product_code !== 'co_managed') {
    notAwaitingAcceptance.add(tenant);
    return false;
  }
  const relationship = await customer.table('co_management_relationships').whereNull('ended_at').first('state');
  if (!relationship) return false;
  if (relationship.state === 'active' || relationship.state === 'terminated') {
    notAwaitingAcceptance.add(tenant);
    return false;
  }
  return true;
}

/** The relationship-backed provider. Register with `registerCoManagedLifecycleProvider`. */
export const coManagedLifecycleProvider: CoManagedLifecycleProvider = { readState, isAwaitingAcceptance, peekAwaitingAcceptance };
