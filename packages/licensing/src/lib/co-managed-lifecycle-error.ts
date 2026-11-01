/**
 * The co-managed lifecycle error contract with no runtime dependencies, so isomorphic modules (action error
 * mappers bundled into client components) can recognise a lifecycle refusal without pulling the database
 * layer into a browser bundle. `co-managed-lifecycle.ts` re-exports everything here.
 */
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

/** Locale key for the user-facing refusal message, shared by every surface that renders one. */
export function coManagedRefusalMessageKey(
  error: Pick<CoManagedLifecycleError, 'code'>,
): 'common:errors.coManaged.acceptancePending' | 'common:errors.coManaged.readOnly' {
  return error.code === 'CO_MANAGED_NOT_ACTIVE'
    ? 'common:errors.coManaged.acceptancePending'
    : 'common:errors.coManaged.readOnly';
}
