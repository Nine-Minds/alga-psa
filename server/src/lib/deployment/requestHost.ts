import type { DeploymentCapabilities } from './deploymentProfile';

export interface RequestHost {
  /** Hostname only (port stripped) — used for vanity-vs-canonical comparison. */
  hostname: string;
  /** The host value as received (may include a port) — used for the portalDomain param. */
  hostHeader: string;
}

/**
 * Resolve the effective request host. Normally this is the `Host` header, but
 * behind a trusted reverse proxy (the appliance) the proxy may rewrite `Host`
 * and pass the original hostname in `X-Forwarded-Host`. We only honor that
 * header when the deployment opts in via `caps.trustForwardedHost` — trusting a
 * forwarded host header is a host-injection consideration.
 *
 * Edge-safe: pure header reads, no I/O.
 */
export function resolveRequestHost(
  request: { headers: { get(name: string): string | null } },
  caps: DeploymentCapabilities
): RequestHost {
  const rawHost = request.headers.get('host') || '';

  if (caps.trustForwardedHost) {
    const forwarded = request.headers.get('x-forwarded-host');
    if (forwarded) {
      // X-Forwarded-Host may be a comma-separated list; the first entry is the
      // original client-facing host.
      const first = forwarded.split(',')[0].trim();
      if (first) {
        return { hostname: first.split(':')[0], hostHeader: first };
      }
    }
  }

  return { hostname: rawHost.split(':')[0], hostHeader: rawHost };
}
