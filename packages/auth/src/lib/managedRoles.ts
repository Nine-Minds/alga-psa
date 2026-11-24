import type { CapabilityKey } from '@alga-psa/core/capability';

/**
 * Client-safe facts about capability-owned ("managed") roles: a role whose `roles.managed_by`
 * names a capability is controlled by that capability alone. The server-side guard lives in
 * `@alga-psa/db` (`managedRoleOwnership`); the visibility rules that need the capability gate are
 * in `./permissionCapabilities`.
 */

/**
 * Owner marker (`roles.managed_by`) to the capability whose tenants may inspect the role. A
 * capability-owned role is owned (read-only) wherever it exists, but it is shown only where the
 * capability is served: an ended arrangement or a kill switch leaves the row in place.
 */
export const MANAGED_ROLE_CAPABILITIES: Readonly<Record<string, CapabilityKey>> = {
  'co-managed-seat': 'co-managed-seat',
};

/** Where an admin goes to manage what a capability-owned role's holders can reach. */
export const MANAGED_ROLE_MANAGE_PATHS: Readonly<Record<string, string>> = {
  'co-managed-seat': '/msp/co-managed',
};


export interface ManagedRoleMarker {
  /** The owning capability's marker, or null/absent for an ordinary role. */
  managed_by?: string | null;
}

/** True for a role a capability owns: it is never editable or assignable by general administration. */
export const isManagedRole = (role: ManagedRoleMarker): boolean => typeof role.managed_by === 'string' && role.managed_by !== '';
