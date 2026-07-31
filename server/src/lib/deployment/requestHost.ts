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

/**
 * Resolve the effective request protocol from the first X-Forwarded-Proto
 * entry. Unlike forwarded host handling, protocol parsing applies in every
 * deployment profile because every supported deployment terminates TLS at a
 * proxy. Returns null when the header is absent or its first entry is not a
 * plausible URL scheme, allowing callers to retain their own fallback.
 *
 * Edge-safe: pure header reads, no I/O.
 */
export function resolveRequestProto(
  request: { headers: { get(name: string): string | null } }
): string | null {
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase();
  return proto && /^[a-z][a-z0-9+.-]*$/.test(proto) ? proto : null;
}

/**
 * Resolve the effective request origin. Host trust follows resolveRequestHost;
 * protocol parsing follows resolveRequestProto. Invalid header input falls back
 * to the caller-supplied origin instead of throwing.
 *
 * Edge-safe: pure header reads and URL parsing, no I/O.
 */
export function resolveRequestOrigin(
  request: { headers: { get(name: string): string | null } },
  caps: DeploymentCapabilities,
  options: { fallbackProto: string; fallbackHost: string }
): URL {
  const { hostHeader } = resolveRequestHost(request, caps);
  const host = hostHeader || options.fallbackHost;
  const proto = resolveRequestProto(request) ?? options.fallbackProto;

  try {
    return new URL(`${proto}://${host}`);
  } catch {
    return new URL(`${options.fallbackProto}://${options.fallbackHost}`);
  }
}

/**
 * Best-effort detection of a reverse proxy that rewrites `Host` to the canonical
 * app host while still passing the original host in `X-Forwarded-Host`. We can
 * recover from this (resolveRequestHost prefers XFH), but it's worth surfacing: if
 * the proxy ever stops sending XFH the vanity domain silently breaks. Returns the
 * forwarded host when the tell-tale fires, otherwise null.
 *
 * Cannot detect a proxy that rewrites `Host` and sends *no* XFH — that information
 * is simply lost.
 *
 * Edge-safe: pure header reads, no I/O.
 */
export function detectForwardedHostRewrite(
  request: { headers: { get(name: string): string | null } },
  caps: DeploymentCapabilities,
  canonicalHostname: string | null
): { forwardedHost: string } | null {
  if (!caps.trustForwardedHost || !canonicalHostname) {
    return null;
  }
  const xfh = request.headers.get('x-forwarded-host');
  if (!xfh) {
    return null;
  }
  const forwardedHost = xfh.split(',')[0].trim().split(':')[0];
  const rawHost = (request.headers.get('host') || '').split(':')[0];

  if (forwardedHost && forwardedHost !== rawHost && rawHost === canonicalHostname) {
    return { forwardedHost };
  }
  return null;
}
