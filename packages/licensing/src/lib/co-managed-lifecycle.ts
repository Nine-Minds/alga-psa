/**
 * Co-managed lifecycle admission: signatures and provider dispatch only.
 *
 * This module reads no table. With no provider registered every workspace is
 * `independent` and writable, and no SQL is issued. The domain that owns the
 * relationship data registers a state reader (and, for write admission, a
 * `@alga-psa/db` write-admission provider); this card registers neither.
 */
import type { Knex } from 'knex';
import { admitWrite, withTransaction } from '@alga-psa/db';

export {
  CoManagedLifecycleError,
  isCoManagedLifecycleError,
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
