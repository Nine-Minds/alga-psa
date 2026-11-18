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
// SSO redirect URIs (D3)
// ---------------------------------------------------------------------------

export const SSO_REDIRECT_URI_PROVIDERS = ['google', 'azure-ad', 'keycloak'] as const;
export type SsoRedirectUriProvider = (typeof SSO_REDIRECT_URI_PROVIDERS)[number];

/** Callback URIs the identity provider(s) must allow for NextAuth on `domain`. */
export function getRequiredSsoRedirectUris(
  domain: string,
  providers: readonly string[],
  protocol: 'https' | 'http' = 'https'
): string[] {
  const host = domain.trim().toLowerCase();
  return [...new Set(providers)]
    .sort()
    .map((provider) => `${protocol}://${host}/api/auth/callback/${provider}`);
}

/**
 * Persisted under portal_domains.verification_details.sso_redirect_uris.
 *  - required:  URIs that must be registered with the IdP(s) for the MSP surface to log in via SSO
 *  - confirmed: URIs confirmed as registered (by automation or an operator)
 *  - source:    who confirmed ("not_required" = no SSO providers are configured)
 */
export interface SsoRedirectUriState {
  required: string[];
  confirmed: string[];
  source?: 'not_required' | 'operator' | 'automation';
  confirmed_at?: string;
}

export function readSsoRedirectUriState(
  verificationDetails: Record<string, unknown> | null | undefined
): SsoRedirectUriState | null {
  const raw = verificationDetails?.sso_redirect_uris;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const asStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  return {
    required: asStrings(candidate.required),
    confirmed: asStrings(candidate.confirmed),
    source: candidate.source as SsoRedirectUriState['source'],
    confirmed_at: typeof candidate.confirmed_at === 'string' ? candidate.confirmed_at : undefined,
  };
}

export interface RedirectUriGateResult {
  /** True when the domain may be activated. */
  ok: boolean;
  /** Required URIs that are not confirmed (empty when ok). */
  missing: string[];
}

/**
 * Gate for activating a domain. Only surfaces serving the MSP app are gated; the
 * client-portal-only flow keeps authenticating on the canonical host via the handoff.
 * A domain whose state was never computed (no `sso_redirect_uris`) is NOT ok for an MSP
 * surface: we never activate on the absence of information.
 */
export function evaluateSsoRedirectUriGate(
  surface: unknown,
  verificationDetails: Record<string, unknown> | null | undefined
): RedirectUriGateResult {
  if (!portalDomainServes(surface, 'msp')) {
    return { ok: true, missing: [] };
  }
  const state = readSsoRedirectUriState(verificationDetails);
  if (!state) {
    return { ok: false, missing: [] };
  }
  const missing = state.required.filter((uri) => !state.confirmed.includes(uri));
  return { ok: missing.length === 0, missing };
}
