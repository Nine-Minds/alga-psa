import {
  deletePortalDomain,
  updatePortalDomain,
  upsertPortalDomain,
} from '@/models/PortalDomainModel';
import { clearPortalDomainSeen } from '@/lib/portal-domains/portalDomainSeen';
import {
  buildSsoRedirectUriState,
  resolveSsoProvidersForTenant,
  describeMissingRedirectUris,
  evaluateSsoRedirectUriGate,
  readSsoRedirectUriState,
  withSsoRedirectUriState,
} from '@/lib/portal-domains/ssoRedirectUris';

import type {
  PortalDomainProvisioner,
  ReconcileInput,
  RegisterInput,
  RegisterResult,
} from './types';

const PORTAL_DOMAIN_SERVICE_PORT = 3000;

/**
 * The server's primary host, derived from NEXTAUTH_URL. Used both as the
 * informational proxy target and to reject a vanity domain that collides with
 * the primary host (which the middleware would never redirect).
 */
function getAppHost(): string | null {
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (!nextAuthUrl) {
    return null;
  }
  try {
    return new URL(nextAuthUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Direct provisioner (CE, and EE in appliance mode) — trust-on-submit. There is no
 * DNS verification, certificate issuance, or Istio routing: the operator owns
 * DNS, TLS, and routing through their own reverse proxy. Registering a domain
 * marks it `active` immediately; disabling deletes the row.
 */
export const directProvisioner: PortalDomainProvisioner = {
  async register(input: RegisterInput): Promise<RegisterResult> {
    const { knex, tenant, domain, surface, existing } = input;
    // Every provider that can sign in on the domain (platform env + the tenant's own IdPs).
    const ssoProviders = await resolveSsoProvidersForTenant(tenant);

    const appHost = getAppHost();
    if (appHost && domain === appHost) {
      throw new Error(
        "Choose a domain other than this server's primary host. The custom portal domain must be a different hostname that your reverse proxy forwards here."
      );
    }

    const ssoState = buildSsoRedirectUriState({
      domain,
      surface,
      providers: ssoProviders,
      previous: existing && existing.domain === domain ? readSsoRedirectUriState(existing.verificationDetails) : null,
    });
    const verificationDetails = withSsoRedirectUriState(
      {
        requested_domain: domain,
        proxy_target_host: appHost,
        proxy_target_port: PORTAL_DOMAIN_SERVICE_PORT,
        forward_host_header: true,
      },
      ssoState
    );
    // MSP surfaces are not activated until the SSO redirect URIs are confirmed (D3).
    const gate = evaluateSsoRedirectUriGate(surface, verificationDetails);

    await upsertPortalDomain(knex, tenant, {
      domain,
      surface,
      matchSurface: existing?.surface,
      status: gate.ok ? 'active' : 'pending_redirect_uri',
      statusMessage: gate.ok
        ? `Active. Ensure ${domain} resolves to this server and that your reverse proxy ` +
          'terminates TLS and forwards the original Host header to it.'
        : describeMissingRedirectUris(gate.missing),
      verificationDetails,
      lastCheckedAt: new Date().toISOString(),
      certificateSecretName: null,
      lastSyncedResourceVersion: null,
    });

    return { enqueued: false };
  },

  // No asynchronous provisioning to poll. The only waiting state is
  // `pending_redirect_uri`: re-evaluate the gate (e.g. after the operator confirmed).
  async refresh(input: ReconcileInput): Promise<void> {
    const { knex, tenant, existing } = input;
    if (existing.status !== 'pending_redirect_uri') {
      return;
    }
    const gate = evaluateSsoRedirectUriGate(existing.surface, existing.verificationDetails);
    if (!gate.ok) {
      return;
    }
    await updatePortalDomain(knex, tenant, { id: existing.id }, {
      status: 'active',
      statusMessage:
        `Active. Ensure ${existing.domain} resolves to this server and that your reverse proxy ` +
        'terminates TLS and forwards the original Host header to it.',
      lastCheckedAt: new Date().toISOString(),
    });
  },

  // No transient/failed states exist in direct mode (register goes straight to
  // `active`), so there is nothing to retry. The action's retry guard never lets
  // this run; it is a defensive no-op.
  async retry(_input: ReconcileInput): Promise<void> {
    return;
  },

  async disable(input: ReconcileInput): Promise<void> {
    const { knex, tenant, existing } = input;
    // Delete the row outright — there are no K8s/cert resources to tear down, and
    // outstanding one-time-tokens cascade away (portal_domain_session_otts FK).
    await deletePortalDomain(knex, tenant, { id: existing.id });
    // Clear the last-seen marker so re-adding the domain starts from a clean slate.
    await clearPortalDomainSeen(existing.domain);
  },
};
