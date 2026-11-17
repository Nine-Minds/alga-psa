import {
  deletePortalDomain,
  upsertPortalDomain,
} from '@/models/PortalDomainModel';
import { clearPortalDomainSeen } from '@/lib/portal-domains/portalDomainSeen';

import type {
  PortalDomainProvisioner,
  ReconcileInput,
  RegisterInput,
  RegisterResult,
} from './types';

const PORTAL_DOMAIN_SERVICE_PORT = 3000;

function describeActiveDirectDomain(domain: string): string {
  return (
    `Active. Ensure ${domain} resolves to this server and that your reverse proxy ` +
    'terminates TLS and forwards the original Host header to it.'
  );
}

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
    const appHost = getAppHost();
    if (appHost && domain === appHost) {
      throw new Error(
        "Choose a domain other than this server's primary host. The custom portal domain must be a different hostname that your reverse proxy forwards here."
      );
    }

    // Every surface goes live as soon as it is registered: SSO for the MSP app runs on the
    // canonical host and is handed off, so no provider callback is registered per domain.
    await upsertPortalDomain(knex, tenant, {
      domain,
      surface,
      matchSurface: existing?.surface,
      status: 'active',
      statusMessage: describeActiveDirectDomain(domain),
      verificationDetails: {
        requested_domain: domain,
        proxy_target_host: appHost,
        proxy_target_port: PORTAL_DOMAIN_SERVICE_PORT,
        forward_host_header: true,
      },
      lastCheckedAt: new Date().toISOString(),
      certificateSecretName: null,
      lastSyncedResourceVersion: null,
    });

    return { enqueued: false };
  },

  // No asynchronous provisioning to poll: register goes straight to `active`.
  async refresh(_input: ReconcileInput): Promise<void> {
    return;
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
