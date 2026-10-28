/**
 * Co-managed write admission: the resolver behind the `tenantDb` choke point.
 *
 * `@alga-psa/db` decides WHETHER a tenant needs a decision (only
 * `tenants.product_code = 'co_managed'` does, once per process) and caches the
 * answer; this module decides WHAT the answer is, and builds the refusal so the
 * database layer never imports licensing.
 *
 * Rules (CM L0c plan sections 4 and 11):
 * - `FORCE_CAPABILITIES=co-managed:off` (or a malformed value, which forces off)
 *   admits every write, so the kill switch needs no deploy.
 * - The state read is lock-free. The lock-ordered path stays with the write-admission
 *   PROVIDER and `withCoManagedOperationalTransaction`; this never takes `FOR UPDATE`.
 * - The real lifecycle answers (`read_only`, `terminated`, `pending_acceptance`) belong
 *   to L7a, which passes its reader to `installCoManagedWriteAdmission`. Until then the
 *   default reader says `independent`, so installing this refuses nothing.
 *
 * Dependency-light on purpose: workers (email-service, workflow-worker, temporal) import
 * this subpath directly and must boot when the co-managed package does not resolve.
 */
import type { Knex } from 'knex';
import { registerWriteAdmissionResolver, type WriteAdmissionResolver } from '@alga-psa/db';
import { forcedValue } from '@alga-psa/core/capability';
import { CoManagedLifecycleError, type CoManagedOperationalState } from './co-managed-lifecycle-error';

export type CoManagedLifecycleReader = (db: Knex | Knex.Transaction, tenant: string) => Promise<CoManagedOperationalState>;

const INDEPENDENT: CoManagedOperationalState = { state: 'independent', canWrite: true, graceEndsAt: null };

/** True when the operator has switched the co-managed capability off. */
export function isCoManagedKillSwitchEngaged(): boolean {
  const forced = forcedValue(typeof process !== 'undefined' ? process.env.FORCE_CAPABILITIES : undefined, 'co-managed');
  return forced === 'off' || forced === 'malformed';
}

export function createCoManagedWriteAdmissionResolver(
  readState: CoManagedLifecycleReader = async () => INDEPENDENT,
): WriteAdmissionResolver {
  return async (db, tenant) => {
    if (isCoManagedKillSwitchEngaged()) return { canWrite: true };
    const lifecycle = await readState(db, tenant);
    if (lifecycle.canWrite) return { canWrite: true };
    return { canWrite: false, denial: new CoManagedLifecycleError(lifecycle) };
  };
}

/** Register the co-managed resolver with `@alga-psa/db`. Safe to call more than once. */
export function installCoManagedWriteAdmission(options: { readState?: CoManagedLifecycleReader } = {}): void {
  registerWriteAdmissionResolver(createCoManagedWriteAdmissionResolver(options.readState));
}
