'use server';

import {
  INTERNAL_TENANT_DISCOVERY_PROFILE,
  requestTenantSignInLinks,
} from '../lib/tenantDiscovery';

/**
 * Emails an MSP user one scoped sign-in link per organization where their
 * address has a live internal account. Unauthenticated, so it always answers
 * with the same generic response and is rate limited per mailbox.
 */
export async function requestMspSignInLinksAction(
  email: string,
  callbackUrl?: string,
): Promise<{ success: boolean; message?: string; error?: string }> {
  return requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, email, callbackUrl);
}
