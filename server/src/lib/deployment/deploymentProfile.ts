/**
 * Deployment profile -> capabilities.
 *
 * The hosted-vs-appliance divergence is expressed once, here. A single
 * `DEPLOYMENT_PROFILE` input is resolved into a typed capabilities object; the
 * rest of the codebase reads named capabilities (e.g. `caps.portalDomain.provisioner`,
 * `caps.trustForwardedHost`) and never branches on the raw profile directly.
 *
 * This module is intentionally dependency-free so it is safe to import from the
 * Edge-runtime middleware as well as from server actions.
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
   * (only true behind a trusted reverse proxy, e.g. the appliance). Trusting a
   * forwarded host header is a host-injection consideration, so it is off by
   * default and opt-in via the deployment profile.
   */
  trustForwardedHost: boolean;
}

const HOSTED_CAPABILITIES: DeploymentCapabilities = {
  portalDomain: { provisioner: 'temporal' },
  trustForwardedHost: false,
};

const APPLIANCE_CAPABILITIES: DeploymentCapabilities = {
  portalDomain: { provisioner: 'direct' },
  trustForwardedHost: true,
};

/**
 * Parse the `DEPLOYMENT_PROFILE` value. Anything other than the exact (case-
 * insensitive) string `appliance` resolves to the safe default `hosted` — so an
 * unset, empty, or unknown value never accidentally turns on appliance behavior.
 */
export function parseDeploymentProfile(raw: string | undefined | null): DeploymentProfile {
  return (raw ?? '').trim().toLowerCase() === 'appliance' ? 'appliance' : 'hosted';
}

/**
 * Resolve the deployment capabilities from the environment (defaults to
 * `process.env`). Pure and side-effect free so it can be unit-tested with an
 * injected env and called from any runtime.
 */
export function resolveDeploymentCapabilities(
  env: Record<string, string | undefined> = process.env
): DeploymentCapabilities {
  return parseDeploymentProfile(env.DEPLOYMENT_PROFILE) === 'appliance'
    ? APPLIANCE_CAPABILITIES
    : HOSTED_CAPABILITIES;
}
