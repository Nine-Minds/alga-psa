import { serves, type CapabilityKey } from '@alga-psa/core/capability';

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
 * declares the same roles in `CAPABILITY_ROLES`; a unit test pins the two together). The
 * capability's admission seeds the role for the tenant it admits; a tenant that is not served
 * must not see it in a role editor, for the reason above.
 */
export const ROLE_CAPABILITIES: Readonly<Record<string, CapabilityKey>> = {
  'msp:Seat Technician': 'co-managed-seat',
};

type RoleIdentity = { role_name: string; msp: boolean; client: boolean };

const roleKey = (role: RoleIdentity): string => `${role.msp ? 'msp' : 'client'}:${role.role_name}`;

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

/** Drops capability roles the tenant is not served for. One gate call per capability present,
 * and none at all when the tenant has no capability role. */
export async function filterRolesByServedCapabilities<T extends RoleIdentity>(
  tenant: string,
  rows: readonly T[],
): Promise<T[]> {
  const needed = rows.flatMap(row => ROLE_CAPABILITIES[roleKey(row)] ?? []);
  if (needed.length === 0) return [...rows];
  const served = await servedCapabilities(tenant, needed);
  return rows.filter(row => {
    const capability = ROLE_CAPABILITIES[roleKey(row)];
    return capability === undefined || served.has(capability);
  });
}

/** The capability roles this tenant must not see, for callers that filter in SQL (pagination
 * and counts must agree with the visible rows). Empty when every capability is served. */
export async function unservedRoles(tenant: string): Promise<RoleIdentity[]> {
  const served = await servedCapabilities(tenant, Object.values(ROLE_CAPABILITIES));
  return Object.entries(ROLE_CAPABILITIES)
    .filter(([, capability]) => !served.has(capability))
    .map(([key]) => {
      const [scope, ...name] = key.split(':');
      return { role_name: name.join(':'), msp: scope === 'msp', client: scope === 'client' };
    });
}
