/**
 * The refusal raised when a general role writer touches a role that a capability owns, and how to
 * recognise it.
 *
 * A capability-owned ("managed") role is marked `roles.managed_by = <owner key>`. Its definition,
 * grants and membership change only through the owner's lifecycle commands; the one server-side
 * guard that decides this lives in `@alga-psa/db` (`managedRoleOwnership`). The error lives here,
 * with no server dependency, so action error mappers that client bundles import can recognise it.
 */

/** What a refused write would have changed. */
export type ManagedRoleOwnershipCode =
  | 'MANAGED_ROLE_DEFINITION'
  | 'MANAGED_ROLE_GRANTS'
  | 'MANAGED_ROLE_MEMBERSHIP'
  | 'MANAGED_ROLE_IDENTITY_RESERVED';

const MANAGED_ROLE_MESSAGES: Record<ManagedRoleOwnershipCode, string> = {
  MANAGED_ROLE_DEFINITION: 'This role is managed by the system. Its name, description and existence cannot be changed here.',
  MANAGED_ROLE_GRANTS: 'This role is managed by the system. Its permissions cannot be changed here.',
  MANAGED_ROLE_MEMBERSHIP: 'This role is managed by the system. It cannot be assigned to or removed from users here.',
  MANAGED_ROLE_IDENTITY_RESERVED: 'This role name is reserved by the system. Choose another name.',
};

export class ManagedRoleOwnershipError extends Error {
  readonly name = 'ManagedRoleOwnershipError';
  readonly statusCode = 409;
  constructor(
    readonly code: ManagedRoleOwnershipCode,
    /** The owning capability's key, e.g. `co-managed-seat`. */
    readonly owner: string,
    readonly roleIds: readonly string[] = [],
  ) {
    super(MANAGED_ROLE_MESSAGES[code]);
  }
}

/** Recognises the error across bundle boundaries, where instanceof can fail. */
export function isManagedRoleOwnershipError(error: unknown): error is ManagedRoleOwnershipError {
  return error instanceof ManagedRoleOwnershipError
    || (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'ManagedRoleOwnershipError');
}

/** The locale key under which an action reports the refusal (msp/settings namespace). */
export const MANAGED_ROLE_ERROR_LOCALE_KEY = 'msp/settings:errors.roles.managedRole';
