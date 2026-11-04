import { isCapabilityServed } from '@alga-psa/core/capability';

/** The tenant is established by the session or verified invitation token. */
export function isCoManagedInvitationServed(tenant: string): Promise<boolean> {
  return isCapabilityServed('co-managed', tenant);
}
