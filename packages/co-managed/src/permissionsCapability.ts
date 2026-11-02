/**
 * The co-managed side of the permission/capability pairing. The catalog tags the
 * `co_management` permissions `capabilities: ['co-managed']`; the role editor hides them from
 * tenants the capability does not serve (`@alga-psa/auth/lib/permissionCapabilities`). Both
 * sides are pinned to the catalog by tests, so this file is the domain's statement of the pairing.
 */
import type { CapabilityKey } from '@alga-psa/core/capability';

export const CO_MANAGED_CAPABILITY: CapabilityKey = 'co-managed';
export const CO_MANAGED_PERMISSION_RESOURCE = 'co_management';
export const CO_MANAGED_PERMISSION_ACTIONS = ['read', 'manage'] as const;

/** The capability a permission resource is gated on, or null when ungated. */
export function permissionResourceCapability(resource: string): CapabilityKey | null {
  return resource === CO_MANAGED_PERMISSION_RESOURCE ? CO_MANAGED_CAPABILITY : null;
}
