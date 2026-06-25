import {
  deletePortalDomain,
  upsertPortalDomain,
} from '@/models/PortalDomainModel';

import type {
  PortalDomainProvisioner,
  ReconcileInput,
  RegisterInput,
  RegisterResult,
} from './types';

const PORTAL_DOMAIN_SERVICE_PORT = 3000;

/**
 * The appliance's primary host, derived from NEXTAUTH_URL. Used both as the
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
 * Appliance provisioner — trust-on-submit. There is no DNS verification, no
 * certificate issuance, and no Istio routing on the appliance: the operator owns
 * DNS, TLS, and routing through their own reverse proxy. Registering a domain
 * marks it `active` immediately; disabling deletes the row.
 */
export const directProvisioner: PortalDomainProvisioner = {
  async register(input: RegisterInput): Promise<RegisterResult> {
    const { knex, tenant, domain } = input;

    const appHost = getAppHost();
    if (appHost && domain === appHost) {
      throw new Error(
        "Choose a domain other than this appliance's primary host. The custom portal domain must be a different hostname that your reverse proxy forwards here."
      );
    }

    await upsertPortalDomain(knex, tenant, {
      domain,
      status: 'active',
      statusMessage:
        `Active. Ensure ${domain} resolves to this appliance and that your reverse proxy ` +
        'terminates TLS and forwards the original Host header to it.',
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

  // Nothing to poll: the appliance has no asynchronous provisioning. Idempotent no-op.
  async refresh(_input: ReconcileInput): Promise<void> {
    return;
  },

  // No transient/failed states exist on the appliance (register goes straight to
  // `active`), so there is nothing to retry. The action's retry guard never lets
  // this run; it is a defensive no-op.
  async retry(_input: ReconcileInput): Promise<void> {
    return;
  },

  async disable(input: ReconcileInput): Promise<void> {
    const { knex, tenant } = input;
    // Delete the row outright — there are no K8s/cert resources to tear down, and
    // outstanding one-time-tokens cascade away (portal_domain_session_otts FK).
    await deletePortalDomain(knex, tenant);
  },
};
