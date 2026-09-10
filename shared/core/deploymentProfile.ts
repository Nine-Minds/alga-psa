/**
 * Deployment profile -> capabilities.
 *
 * The hosted-vs-appliance divergence is expressed once, here. A single
 * `DEPLOYMENT_PROFILE` input is resolved into a typed capabilities object; the
 * rest of the codebase reads named capabilities (e.g. `caps.portalDomain.provisioner`,
 * `caps.trustForwardedHost`) and never branches on the raw profile directly.
 * Individual capabilities can also be switched on without adopting a profile
 * (`TRUST_FORWARDED_HOST`), so a self-hosted Community Edition install never has
 * to declare itself an appliance.
 *
 * This module is intentionally dependency-free so it is safe to import from the
 * Edge-runtime middleware, server actions, and the workflow worker alike.
 */

export type DeploymentProfile = 'hosted' | 'appliance';

export type PortalDomainProvisionerKind = 'temporal' | 'direct';

export interface DeploymentCapabilities {
  /** How custom portal domains are provisioned in this deployment. */
  portalDomain: {
    provisioner: PortalDomainProvisionerKind;
  };
  /**
   * Whether the `X-Forwarded-Host` header may be trusted as the request host
   * (only true behind a trusted reverse proxy). Trusting a forwarded host header
   * is a host-injection consideration, so it is off by default and opt-in via
   * the appliance profile or `TRUST_FORWARDED_HOST=true`.
   */
  trustForwardedHost: boolean;
  /**
   * Whether Microsoft 365 mailbox OAuth runs against Alga's shared multi-tenant
   * app registration (hosted cloud) rather than a customer-owned, normally
   * single-tenant app registration (appliance).
   */
  microsoftOAuth: {
    sharedApp: boolean;
  };
}

const HOSTED_CAPABILITIES: DeploymentCapabilities = {
  portalDomain: { provisioner: 'temporal' },
  trustForwardedHost: false,
  microsoftOAuth: { sharedApp: true },
};

const APPLIANCE_CAPABILITIES: DeploymentCapabilities = {
  portalDomain: { provisioner: 'direct' },
  trustForwardedHost: true,
  microsoftOAuth: { sharedApp: false },
};

/**
 * Parse the `DEPLOYMENT_PROFILE` value. Anything other than the exact (case-
 * insensitive) string `appliance` resolves to the safe default `hosted` — so an
 * unset, empty, or unknown value never accidentally turns on appliance behavior.
 */
export function parseDeploymentProfile(raw: string | undefined | null): DeploymentProfile {
  return (raw ?? '').trim().toLowerCase() === 'appliance' ? 'appliance' : 'hosted';
}

function isAffirmative(raw: string | undefined | null): boolean {
  return ['true', '1', 'yes'].includes((raw ?? '').trim().toLowerCase());
}

/**
 * Resolve the deployment capabilities from the environment (defaults to
 * `process.env`). Pure and side-effect free so it can be unit-tested with an
 * injected env and called from any runtime. `TRUST_FORWARDED_HOST` is opt-in
 * only: it can switch forwarded-host trust on for a hosted-profile install but
 * never off for an appliance.
 */
export function resolveDeploymentCapabilities(
  env: Record<string, string | undefined> = process.env
): DeploymentCapabilities {
  const base = parseDeploymentProfile(env.DEPLOYMENT_PROFILE) === 'appliance'
    ? APPLIANCE_CAPABILITIES
    : HOSTED_CAPABILITIES;

  if (base.trustForwardedHost || !isAffirmative(env.TRUST_FORWARDED_HOST)) {
    return base;
  }
  return { ...base, trustForwardedHost: true };
}
