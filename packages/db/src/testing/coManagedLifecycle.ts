/**
 * Ready-made doubles for the co-managed lifecycle surface of
 * `@alga-psa/licensing`.
 *
 * Lifecycle admission is now called from shared write paths -- storage,
 * scheduling, time entries, appointments -- so any suite that partially mocks
 * `@alga-psa/licensing` loses `getCoManagedOperationalState` and dies with
 * `No "getCoManagedOperationalState" export is defined on the
 * "@alga-psa/licensing" mock`. Enumerating the surface in each suite is the
 * same mistake one level up; spread this instead.
 *
 *   vi.mock('@alga-psa/licensing', async (importOriginal) => ({
 *     ...(await importOriginal<object>()),
 *     ...coManagedLifecycleMock(),
 *   }));
 *
 * The default state is an independent workspace: writable, not co-managed. A
 * suite that is about co-management passes the state it means.
 */

export interface CoManagedOperationalStateLike {
  state: 'independent' | 'active' | 'grace' | 'pending_acceptance' | 'read_only' | 'terminated';
  canWrite: boolean;
  graceEndsAt: string | null;
}

/** Writable, not co-managed -- lifecycle admission is a no-op. */
export const INDEPENDENT_OPERATIONAL_STATE: CoManagedOperationalStateLike = {
  state: 'independent', canWrite: true, graceEndsAt: null,
};

export interface CoManagedLifecycleMockOptions {
  state?: CoManagedOperationalStateLike;
  /** Supply vitest's `vi.fn` to get spies; plain functions otherwise. */
  fn?: <T>(implementation: T) => T;
}

/**
 * The lifecycle exports a partial `@alga-psa/licensing` mock must carry.
 * Keep this list in step with what shared write paths actually call.
 */
export function coManagedLifecycleMock(options: CoManagedLifecycleMockOptions = {}) {
  const state = options.state ?? INDEPENDENT_OPERATIONAL_STATE;
  const wrap = options.fn ?? (<T>(implementation: T) => implementation);
  return {
    getCoManagedOperationalState: wrap(async () => state),
    assertCoManagedOperationalWrite: wrap(async () => undefined),
    // Runs the callback in whatever transaction it was handed, so a caller that
    // already opened one keeps it and the callback still sees a transaction.
    withCoManagedOperationalTransaction: wrap(
      async (db: any, _tenant: string, callback: (trx: any) => unknown) => callback(db),
    ),
    isCoManagedLifecycleError: wrap(() => false),
  };
}
