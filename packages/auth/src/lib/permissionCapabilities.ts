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

/** Capabilities this tenant is served for, answered by the same `serves` resolver (and
 * participation cache) as every other adapter. Fails closed: a throwing gate serves nothing. */
export async function servedCapabilities(tenant: string): Promise<ReadonlySet<CapabilityKey>> {
  const needed = [...new Set(Object.values(PERMISSION_RESOURCE_CAPABILITIES))];
  const served = new Set<CapabilityKey>();
  await Promise.all(needed.map(async capability => {
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
