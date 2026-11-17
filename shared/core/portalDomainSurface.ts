/**
 * Portal-domain "surface" rules (alga-2026-0002799).
 *
 * A tenant's custom domain serves the client portal (`client_portal`, the original and
 * default behaviour), the MSP/technician app (`msp`), or both (`both`, with the portal
 * or the MSP app chosen by path prefix).
 *
 * Intentionally dependency-free: imported by the Edge middleware, server actions,
 * NextAuth, and the Temporal worker alike.
 */

export const PORTAL_DOMAIN_SURFACES = ['client_portal', 'msp', 'both'] as const;
export type PortalDomainSurface = (typeof PORTAL_DOMAIN_SURFACES)[number];
export const DEFAULT_PORTAL_DOMAIN_SURFACE: PortalDomainSurface = 'client_portal';

/** The app a request path or a notification recipient belongs to. */
export type AppSurface = 'client_portal' | 'msp';

export function isPortalDomainSurface(value: unknown): value is PortalDomainSurface {
  return typeof value === 'string' && (PORTAL_DOMAIN_SURFACES as readonly string[]).includes(value);
}

/** Unknown/missing values collapse to the legacy `client_portal` behaviour. */
export function normalizePortalDomainSurface(value: unknown): PortalDomainSurface {
  return isPortalDomainSurface(value) ? value : DEFAULT_PORTAL_DOMAIN_SURFACE;
}

/** Does a domain with `domainSurface` serve the `wanted` app? `both` serves both. */
export function portalDomainServes(domainSurface: unknown, wanted: AppSurface): boolean {
  const surface = normalizePortalDomainSurface(domainSurface);
  return surface === 'both' || surface === wanted;
}

/**
 * D6: with `surface=both`, the app is chosen by path prefix. Returns null for paths that
 * belong to neither app (APIs, static assets, shared auth endpoints, ...).
 */
export function surfaceForPath(pathname: string): AppSurface | null {
  const matches = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (matches('/msp') || matches('/auth/msp') || pathname === '/auth/signin') {
    return 'msp';
  }
  if (matches('/client-portal') || matches('/auth/client-portal')) {
    return 'client_portal';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session handoff (alga-2026-0002996)
// ---------------------------------------------------------------------------

/**
 * A custom domain a signed-in user may be handed off to: active AND serving the app the
 * return path belongs to. A domain that does not serve the surface would land the user on
 * the middleware surface gate instead of the page they asked for.
 */
export function isPortalDomainHandoffTarget(
  portalDomain: { status: string; surface?: unknown },
  wanted: AppSurface
): boolean {
  return portalDomain.status === 'active' && portalDomainServes(portalDomain.surface, wanted);
}

/** The path prefix that bounds a surface for handoff return paths. */
const HANDOFF_SURFACE_PREFIX: Record<AppSurface, string> = {
  client_portal: '/client-portal',
  msp: '/msp',
};

/** Default landing page after a handoff, by surface. */
export const HANDOFF_DEFAULT_RETURN_PATH: Record<AppSurface, string> = {
  client_portal: '/client-portal/dashboard',
  msp: '/msp/dashboard',
};

/**
 * Validates a handoff return path. Returns the normalised relative path (path + query +
 * hash) when it is a same-origin relative path inside the surface, otherwise null.
 *
 * Rejected: anything not starting with a single '/', protocol-relative or backslash forms
 * (`//host`, `/\host`), control characters, paths whose parsed origin differs from the
 * request origin, and paths outside the surface's prefix (including dot-segment escapes,
 * which URL parsing resolves before the prefix check).
 */
export function normalizeHandoffReturnPath(raw: unknown, surface: AppSurface): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) {
    return null;
  }
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return null;
  }

  const probeOrigin = 'http://handoff.invalid';
  let parsed: URL;
  try {
    parsed = new URL(raw, probeOrigin);
  } catch {
    return null;
  }
  if (parsed.origin !== probeOrigin) {
    return null;
  }

  const prefix = HANDOFF_SURFACE_PREFIX[surface];
  if (parsed.pathname !== prefix && !parsed.pathname.startsWith(`${prefix}/`)) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** The surface a user type signs in to: client users the portal, everyone else the MSP app. */
export function surfaceForUserType(userType: string | null | undefined): AppSurface {
  return userType === 'client' ? 'client_portal' : 'msp';
}
