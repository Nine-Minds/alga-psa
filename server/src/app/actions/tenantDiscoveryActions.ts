'use server';

import {
  CLIENT_TENANT_DISCOVERY_PROFILE,
  INTERNAL_TENANT_DISCOVERY_PROFILE,
  requestTenantSignInLinks,
  type TenantDiscoveryDeps,
  type TenantDiscoveryResponse,
} from '@alga-psa/auth/lib/tenantDiscovery';
import { sendTenantRecoveryEmail } from '@alga-psa/email';
import { resolveTenantAppBase } from '@alga-psa/tenancy/server';

// Composition root for tenant discovery. The engine lives in @alga-psa/auth,
// but the base-URL resolver (@alga-psa/tenancy) and the mailer (@alga-psa/email)
// both depend on auth, so only a layer above all three can bind them.
const tenantDiscoveryDeps: TenantDiscoveryDeps = {
  resolveAppBase: resolveTenantAppBase,
  sendRecoveryEmail: sendTenantRecoveryEmail,
};

/**
 * Emails an MSP user one scoped sign-in link per organization where their
 * address has a live internal account. Unauthenticated, so it always answers
 * with the same generic response and is rate limited per mailbox.
 */
export async function requestMspSignInLinksAction(
  email: string,
  callbackUrl?: string,
): Promise<TenantDiscoveryResponse> {
  return requestTenantSignInLinks(INTERNAL_TENANT_DISCOVERY_PROFILE, tenantDiscoveryDeps, email, callbackUrl);
}

/**
 * Requests tenant login links for a client-portal email address.
 * Returns a generic success message to prevent account enumeration.
 * Discovery, the contact gate (the client profile's precondition), the
 * per-email rate limit and the email all live in the shared engine.
 */
export async function requestClientPortalLoginLinksAction(
  email: string,
  callbackUrl?: string,
): Promise<TenantDiscoveryResponse> {
  return requestTenantSignInLinks(CLIENT_TENANT_DISCOVERY_PROFILE, tenantDiscoveryDeps, email, callbackUrl);
}
