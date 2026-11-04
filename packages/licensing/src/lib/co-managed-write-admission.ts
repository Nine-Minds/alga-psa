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
import { invalidateWriteAdmission, registerWriteAdmissionResolver, type WriteAdmissionResolver } from '@alga-psa/db/writeAdmission';
import { forcedValue } from '@alga-psa/core/capability';
import { CoManagedLifecycleError, type CoManagedOperationalState } from './co-managed-lifecycle-error';

export type CoManagedLifecycleReader = (db: Knex | Knex.Transaction, tenant: string) => Promise<CoManagedOperationalState>;

const INDEPENDENT: CoManagedOperationalState = { state: 'independent', canWrite: true, graceEndsAt: null };

/** Process composition supplied before server bootstrap by an isolated review launcher. */
export interface CoManagedReviewReader {
  tenant: string;
  readState: CoManagedLifecycleReader;
}

declare global {
  // eslint-disable-next-line no-var
  var __algaCoManagedReviewReader: CoManagedReviewReader | undefined;
}

/** Install a review reader for exactly one tenant; all other tenants use the default reader. */
export function installCoManagedReviewAdmission(review: CoManagedReviewReader): void {
  if (!review.tenant || typeof review.readState !== 'function') throw new Error('Invalid co-managed review reader');
  invalidateWriteAdmission(review.tenant);
  installCoManagedWriteAdmission({
    readState: (db, tenant) => tenant === review.tenant ? review.readState(db, tenant) : Promise.resolve(INDEPENDENT),
  });
}

/** True when the operator has switched the co-managed capability off. */
export function isCoManagedKillSwitchEngaged(): boolean {
  const forced = forcedValue(typeof process !== 'undefined' ? process.env.FORCE_CAPABILITIES : undefined, 'co-managed');
  return forced === 'off' || forced === 'malformed';
}

export function createCoManagedWriteAdmissionResolver(
  readState: CoManagedLifecycleReader = async () => INDEPENDENT,
): WriteAdmissionResolver {
  const resolver: WriteAdmissionResolver = async (db, tenant) => {
    if (isCoManagedKillSwitchEngaged()) return { canWrite: true };
    const lifecycle = await readState(db, tenant);
    if (lifecycle.canWrite) return { canWrite: true };
    return { canWrite: false, denial: new CoManagedLifecycleError(lifecycle) };
  };
  resolver.cacheKey = () => isCoManagedKillSwitchEngaged() ? 'off' : 'on';
  return resolver;
}

export interface InstallCoManagedWriteAdmissionOptions {
  /** The real lifecycle reader (L7a). Defaults to "independent", which refuses nothing. */
  readState?: CoManagedLifecycleReader;
  /**
   * DEV/TEST ONLY: force a lifecycle state for specific tenant ids, so a read-only or
   * pending-acceptance tenant can be demonstrated before L7a's reader exists. Ignored (with a
   * warning) when `NODE_ENV === 'production'`; the production resolver is built without it, so
   * it adds no code to the PSA fast path (a PSA tenant never reaches the resolver at all).
   * The tenant must still have `tenants.product_code = 'co_managed'`; see plan section 7.
   */
  devForcedStates?: Readonly<Record<string, CoManagedOperationalState>>;
}

function isProductionRuntime(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
}

/** Wrap a reader so the listed tenants get a fixed state. Never called in production. */
function withDevForcedStates(
  readState: CoManagedLifecycleReader,
  forced: Readonly<Record<string, CoManagedOperationalState>>,
): CoManagedLifecycleReader {
  return (db, tenant) => (Object.prototype.hasOwnProperty.call(forced, tenant) ? Promise.resolve(forced[tenant]) : readState(db, tenant));
}

/**
 * DEV/TEST ONLY: parse `CO_MANAGED_DEV_FORCE_STATE="<tenantId>:read_only,<tenantId>:pending_acceptance"`.
 * Returns undefined in production or when unset. Unknown states are skipped.
 */
export function devForcedStatesFromEnv(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): Record<string, CoManagedOperationalState> | undefined {
  if (env.NODE_ENV === 'production') return undefined;
  const raw = env.CO_MANAGED_DEV_FORCE_STATE;
  if (!raw) return undefined;
  const out: Record<string, CoManagedOperationalState> = {};
  for (const part of raw.split(',')) {
    const [tenant, state] = part.split(':').map((x) => x.trim());
    if (!tenant) continue;
    if (state === 'read_only' || state === 'terminated') out[tenant] = { state, canWrite: false, graceEndsAt: null };
    else if (state === 'pending_acceptance') out[tenant] = { state, canWrite: false, graceEndsAt: null };
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The reader `installCoManagedWriteAdmission` will use: the supplied one, with dev-forced tenants
 * layered on top outside production. In production `devForcedStates` is dropped (warned).
 */
export function resolveInstalledReader(options: InstallCoManagedWriteAdmissionOptions = {}): CoManagedLifecycleReader | undefined {
  const forced = options.devForcedStates;
  if (!forced || Object.keys(forced).length === 0) return options.readState;
  if (isProductionRuntime()) {
    console.warn('[CoManagedWriteAdmission] devForcedStates ignored: NODE_ENV is production');
    return options.readState;
  }
  // A session that still says "psa" for this tenant must not seed the negative set first.
  for (const tenant of Object.keys(forced)) invalidateWriteAdmission(tenant);
  return withDevForcedStates(options.readState ?? (async () => INDEPENDENT), forced);
}

/** Register the co-managed resolver with `@alga-psa/db`. Safe to call more than once. */
export function installCoManagedWriteAdmission(options: InstallCoManagedWriteAdmissionOptions = {}): void {
  registerWriteAdmissionResolver(createCoManagedWriteAdmissionResolver(resolveInstalledReader(options)));
}
