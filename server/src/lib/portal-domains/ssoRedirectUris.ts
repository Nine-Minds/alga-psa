import {
  evaluateSsoRedirectUriGate,
  getRequiredSsoRedirectUris,
  portalDomainServes,
  readSsoRedirectUriState,
  type PortalDomainSurface,
  type SsoRedirectUriState,
} from '@alga-psa/shared/core/portalDomainSurface';

type Env = Record<string, string | undefined>;

/**
 * Platform-level SSO providers NextAuth is configured with (mirrors the env checks in
 * packages/auth nextAuthOptions). Tenant-specific providers (per-tenant Keycloak/IdP
 * settings) are NOT covered - see the report: that is a known gap.
 */
export function detectConfiguredSsoProviders(env: Env = process.env): string[] {
  const providers: string[] = [];
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) providers.push('google');
  if (env.MICROSOFT_OAUTH_CLIENT_ID && env.MICROSOFT_OAUTH_CLIENT_SECRET) providers.push('azure-ad');
  if (env.KEYCLOAK_CLIENT_ID && env.KEYCLOAK_URL) providers.push('keycloak');
  return providers;
}

/**
 * STUB for automating redirect-URI registration. Provider consoles (Google Cloud,
 * Entra) have no API we drive from here, so nothing is registered automatically. The
 * only automatic confirmation is an operator-declared one: when
 * PORTAL_DOMAIN_SSO_REDIRECT_URIS_PREREGISTERED=true the operator asserts that the
 * redirect URIs for custom domains are registered out of band (wildcard / managed by
 * their own tooling), and every required URI counts as confirmed.
 */
export function confirmViaAutomation(required: string[], env: Env = process.env): string[] {
  return env.PORTAL_DOMAIN_SSO_REDIRECT_URIS_PREREGISTERED === 'true' ? [...required] : [];
}

/**
 * Compute the redirect-URI state stored in verification_details.sso_redirect_uris for a
 * (domain, surface). Returns null for surfaces that don't serve the MSP app (nothing to
 * register: client portal SSO authenticates on the canonical host). Confirmations from a
 * previous state are kept only for URIs that are still required (so a domain change
 * invalidates them).
 */
export function buildSsoRedirectUriState(args: {
  domain: string;
  surface: PortalDomainSurface;
  previous?: SsoRedirectUriState | null;
  env?: Env;
}): SsoRedirectUriState | null {
  const env = args.env ?? process.env;
  if (!portalDomainServes(args.surface, 'msp')) {
    return null;
  }

  const providers = detectConfiguredSsoProviders(env);
  const required = getRequiredSsoRedirectUris(args.domain, providers);
  if (required.length === 0) {
    return { required, confirmed: [], source: 'not_required' };
  }

  const kept = (args.previous?.confirmed ?? []).filter((uri) => required.includes(uri));
  const automated = confirmViaAutomation(required, env);
  const confirmed = [...new Set([...kept, ...automated])];
  return {
    required,
    confirmed,
    source: automated.length > 0 ? 'automation' : args.previous?.source === 'operator' && kept.length > 0 ? 'operator' : undefined,
    ...(confirmed.length > 0 && args.previous?.confirmed_at ? { confirmed_at: args.previous.confirmed_at } : {}),
  };
}

/** Operator/admin attests that every required URI is registered. */
export function confirmAllRequired(state: SsoRedirectUriState, now: Date = new Date()): SsoRedirectUriState {
  return { ...state, confirmed: [...state.required], source: 'operator', confirmed_at: now.toISOString() };
}

export function withSsoRedirectUriState(
  details: Record<string, unknown> | null | undefined,
  state: SsoRedirectUriState | null
): Record<string, unknown> {
  const { sso_redirect_uris: _discarded, ...rest } = details ?? {};
  return state ? { ...rest, sso_redirect_uris: state } : rest;
}

export function describeMissingRedirectUris(missing: string[]): string {
  return missing.length > 0
    ? `Waiting for SSO redirect URIs to be registered with your identity provider(s): ${missing.join(', ')}`
    : 'Waiting for confirmation that SSO redirect URIs are registered for this domain.';
}

export { evaluateSsoRedirectUriGate, readSsoRedirectUriState };
