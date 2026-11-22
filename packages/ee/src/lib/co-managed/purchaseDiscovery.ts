// CE stub: commercial discovery of co-managed seats is an Enterprise-edition surface. The community
// edition is inert whatever the rollout flag or a configured price says.
export type CoManagedPurchaseDiscoveryReason =
  | 'not_internal' | 'tenant_mismatch' | 'surface_closed' | 'no_permission' | 'not_hosted_pro' | 'self_host' | 'edition';

export type CoManagedPurchaseDiscovery = { eligible: true } | { eligible: false; reason: CoManagedPurchaseDiscoveryReason };

export async function resolveCoManagedPurchaseDiscovery(
  _user: { user_type: string; tenant?: string | null }, _tenant: string,
): Promise<CoManagedPurchaseDiscovery> {
  return { eligible: false, reason: 'edition' };
}
