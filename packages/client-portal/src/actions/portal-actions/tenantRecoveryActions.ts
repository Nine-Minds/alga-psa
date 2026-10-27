'use server';

import {
  CLIENT_TENANT_DISCOVERY_PROFILE,
  requestTenantSignInLinks,
} from '@alga-psa/auth/lib/tenantDiscovery';

/**
 * Requests tenant login links for a given email address.
 * Returns a generic success message to prevent account enumeration.
 * Discovery, the contact gate (the client profile's precondition), the
 * per-email rate limit and the email all live in the shared engine.
 */
export async function requestTenantLoginLinksAction(
  email: string,
  callbackUrl?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  return requestTenantSignInLinks(CLIENT_TENANT_DISCOVERY_PROFILE, email, callbackUrl);
}
