import { serves, type CapabilityKey } from '@alga-psa/core/capability';
import { isManagedRole, MANAGED_ROLE_CAPABILITIES, type ManagedRoleMarker } from './managedRoles';

export { isManagedRole, MANAGED_ROLE_CAPABILITIES, MANAGED_ROLE_MANAGE_PATHS, type ManagedRoleMarker } from './managedRoles';

/**
 * Permission resources that exist only for a release capability (the catalog tags the same
 * entries with `capabilities`; a unit test pins the two together). A tenant that is not
 * served for the capability must not see the permission in a role editor, even when stale
 * rows remain after a sponsorship ended or the kill switch was thrown: nothing deletes them.
 */
export const PERMISSION_RESOURCE_CAPABILITIES: Readonly<Record<string, CapabilityKey>> = {
  co_management: 'co-managed',
};

/**
 * Roles that exist only for a release capability, by `scope:role_name` (the permission catalog
 * declares the same roles in `CAPABILITY_ROLES`; a unit test pins the two together). This is the
 * role's catalog identity; at runtime a tenant's role is recognised by its owner marker
 * (`roles.managed_by`, see `MANAGED_ROLE_CAPABILITIES`), never by this name.
 */
export const ROLE_CAPABILITIES: Readonly<Record<string, CapabilityKey>> = {
  'msp:Seat Technician': 'co-managed-seat',
};

/** Which of `needed` this tenant is served for, answered by the same `serves` resolver (and
 * participation cache) as every other adapter. Fails closed: a throwing gate serves nothing. */
export async function servedCapabilities(
  tenant: string,
  needed: readonly CapabilityKey[] = [...new Set(Object.values(PERMISSION_RESOURCE_CAPABILITIES))],
): Promise<ReadonlySet<CapabilityKey>> {
  const served = new Set<CapabilityKey>();
  await Promise.all([...new Set(needed)].map(async capability => {
    try {
      if ((await serves(capability, tenant)).served) served.add(capability);
    } catch {
      // closed
    }
  }));
  return served;
}

/** Drops rows whose capability the tenant is not served for. One gate call per capability,
 * and none at all when no row is capability-gated. */
export async function filterPermissionsByServedCapabilities<T extends { resource: string }>(
  tenant: string,
  rows: readonly T[],
): Promise<T[]> {
  if (!rows.some(row => row.resource in PERMISSION_RESOURCE_CAPABILITIES)) return [...rows];
  const served = await servedCapabilities(tenant);
  return rows.filter(row => {
    const capability = PERMISSION_RESOURCE_CAPABILITIES[row.resource];
    return capability === undefined || served.has(capability);
  });
}

/** The gated resources this tenant must not see, for callers that filter in SQL (pagination
 * and counts must agree with the visible rows). Empty when every capability is served. */
export async function unservedPermissionResources(tenant: string): Promise<string[]> {
  const served = await servedCapabilities(tenant);
  return Object.entries(PERMISSION_RESOURCE_CAPABILITIES)
    .filter(([, capability]) => !served.has(capability))
    .map(([resource]) => resource);
}

/**
 * Editable lists and manual pickers (role editor list, role assignment, invitations, bulk role
 * change): a capability-owned role is never offered, whether or not its capability is served.
 */
export function omitManagedRoles<T extends ManagedRoleMarker>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isManagedRole(row));
}

/**
 * Read-only inspection surfaces (role detail, permissions matrix, a technician's assigned role):
 * a capability-owned role appears, marked by its `managed_by`, only for a tenant served for its
 * capability; for any other tenant it is hidden from ordinary role discovery. One gate call per
 * capability present, and none when no row is capability-owned.
 */
export async function filterRolesByServedCapabilities<T extends ManagedRoleMarker>(
  tenant: string,
  rows: readonly T[],
): Promise<T[]> {
  const needed = rows.flatMap((row) => (isManagedRole(row) ? MANAGED_ROLE_CAPABILITIES[row.managed_by as string] ?? [] : []));
  if (!rows.some(isManagedRole)) return [...rows];
  const served = await servedCapabilities(tenant, needed);
  return rows.filter((row) => {
    if (!isManagedRole(row)) return true;
    const capability = MANAGED_ROLE_CAPABILITIES[row.managed_by as string];
    // An owner this build does not know is never shown.
    return capability !== undefined && served.has(capability);
  });
}

/** The owner markers this tenant must not see, for callers that filter in SQL (pagination and
 * counts must agree with the visible rows). Empty when every capability is served. */
export async function unservedManagedOwners(tenant: string): Promise<string[]> {
  const served = await servedCapabilities(tenant, Object.values(MANAGED_ROLE_CAPABILITIES));
  return Object.entries(MANAGED_ROLE_CAPABILITIES)
    .filter(([, capability]) => !served.has(capability))
    .map(([owner]) => owner);
}
