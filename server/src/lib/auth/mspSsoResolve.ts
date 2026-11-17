import { createHash } from 'node:crypto';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { getTenantIdBySlug, isValidTenantSlug } from '@alga-psa/db';
import {
  MSP_SSO_RESOLUTION_TTL_SECONDS,
  createSignedMspSsoDiscoveryCookie,
  createSignedMspSsoResolutionCookie,
  discoverMspSsoProviderOptions,
  extractDomainFromEmail,
  getMspSsoSigningSecret,
  hasAppFallbackProviderCredentials,
  isValidResolverCallbackUrl,
  normalizeResolverEmail,
  parseAndVerifyMspSsoDiscoveryCookie,
  parseResolverProvider,
  resolveMspSsoCredentialSource,
  type MspSsoDiscoveryPayload,
  type MspSsoProviderId,
} from '@alga-psa/auth/lib/sso/mspSsoResolution';
import { createPendingRememberContextCookie } from '@alga-psa/auth/lib/mspRememberedEmail';

/**
 * MSP SSO resolution: the single implementation behind `POST /api/auth/msp/sso/resolve`
 * (sign-in on the host the user is on) and `GET /api/auth/msp/sso/start` (sign-in begun on
 * a custom domain and carried out on the canonical host). It validates the request, picks
 * the credential source and signs the host-only cookies NextAuth reads when it builds the
 * provider configuration for the OAuth round trip.
 */

const resolverRateLimiter = new RateLimiterMemory({
  points: 8,
  duration: 60,
  blockDuration: 5 * 60,
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MspSsoResolveInput {
  provider: unknown;
  email: unknown;
  publicWorkstation?: boolean;
  callbackUrl?: unknown;
  tenantSlug?: unknown;
  /** Raw value of the discovery cookie, when the request carried one. */
  discoveryCookieValue?: string;
  /**
   * Discovery already computed server-side. Used when the discovery cookie lives on another
   * host (a custom domain) and so cannot reach the canonical host.
   */
  discovery?: MspSsoDiscoveryPayload | null;
  ip: string;
}

export type MspSsoResolveResult =
  | { ok: false }
  | {
      ok: true;
      provider: MspSsoProviderId;
      email: string;
      source: 'tenant' | 'app';
      scopeTenantId?: string;
      resolutionCookieValue: string;
      pendingRememberContextCookieValue: string;
    };

/** Anti-enumeration rule: every failure collapses to the same `{ ok: false }`. */
export async function resolveMspSso(input: MspSsoResolveInput): Promise<MspSsoResolveResult> {
  const provider = parseResolverProvider(input.provider);
  const email = typeof input.email === 'string' ? normalizeResolverEmail(input.email) : '';
  const publicWorkstation = input.publicWorkstation === true;
  const callbackUrl = typeof input.callbackUrl === 'string' ? input.callbackUrl.trim() : undefined;

  const rawTenantSlug = input.tenantSlug;
  const tenantSlug =
    typeof rawTenantSlug === 'string' && rawTenantSlug.trim() ? rawTenantSlug.trim().toLowerCase() : undefined;
  // A slug that was supplied but is bad fails the same way as everything else.
  if (rawTenantSlug !== undefined && rawTenantSlug !== null && rawTenantSlug !== '' && !tenantSlug) {
    return { ok: false };
  }

  if (!provider || !email || !EMAIL_PATTERN.test(email) || !isValidResolverCallbackUrl(callbackUrl)) {
    return { ok: false };
  }

  const emailHashBucket = createHash('sha256').update(email).digest('hex').slice(0, 16);
  try {
    await resolverRateLimiter.consume(`${input.ip}:${emailHashBucket}`);
  } catch {
    return { ok: false };
  }

  const signingSecret = await getMspSsoSigningSecret();
  if (!signingSecret) {
    console.warn('[msp-sso-resolve] NEXTAUTH_SECRET not configured; unable to issue resolution cookie');
    return { ok: false };
  }

  const discoveryContext =
    input.discovery ??
    parseAndVerifyMspSsoDiscoveryCookie({
      value: input.discoveryCookieValue,
      secret: signingSecret,
    });

  // Scoped sign-in: the slug names the only tenant whose user may be signed
  // in. Resolve it here, server-side, and sign it into the cookie.
  let scopeTenantId: string | undefined;
  if (tenantSlug) {
    if (!isValidTenantSlug(tenantSlug)) {
      return { ok: false };
    }
    scopeTenantId = (await getTenantIdBySlug(tenantSlug)) ?? undefined;
    if (!scopeTenantId) {
      return { ok: false };
    }
  }

  // Anti-enumeration rule: lookup outcomes only affect internal source selection, never external messaging.
  const outcome = await resolveMspSsoCredentialSource({
    provider,
    email,
    discovery: discoveryContext,
  });
  if (
    scopeTenantId &&
    outcome.resolved &&
    outcome.source === 'tenant' &&
    outcome.tenantId !== scopeTenantId
  ) {
    // The email's domain belongs to another tenant's IdP. A sign-in scoped to
    // this tenant must never run through it; use the app-level provider if
    // one exists, otherwise fail like any other unavailable source.
    if (await hasAppFallbackProviderCredentials(provider)) {
      outcome.source = 'app';
      outcome.tenantId = undefined;
    } else {
      outcome.resolved = false;
    }
  }
  if (!outcome.resolved || !outcome.source) {
    console.info('[msp-sso-resolve] no available credential source', {
      provider,
      discovery: discoveryContext ? 'present' : 'missing-or-invalid',
    });
    return { ok: false };
  }

  const cookie = createSignedMspSsoResolutionCookie({
    provider,
    source: outcome.source,
    tenantId: outcome.tenantId,
    scopeTenantId,
    secret: signingSecret,
    ttlSeconds: MSP_SSO_RESOLUTION_TTL_SECONDS,
  });
  const pendingRememberContext = createPendingRememberContextCookie({
    email,
    publicWorkstation,
    secret: signingSecret,
  });

  console.info('[msp-sso-resolve] credential source selected', {
    provider,
    source: outcome.source,
  });

  return {
    ok: true,
    provider,
    email,
    source: outcome.source,
    scopeTenantId,
    resolutionCookieValue: cookie.value,
    pendingRememberContextCookieValue: pendingRememberContext.value,
  };
}

export function getRequestIpFromHeaders(headers: { get(name: string): string | null }): string {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

/**
 * The discovery context `POST /api/auth/msp/sso/discover` would have stored in the host-only
 * discovery cookie for this email. A sign-in begun on a custom domain has that cookie on the
 * custom host, out of reach of the canonical host, so the canonical host derives it again.
 */
export async function buildMspSsoDiscoveryFromEmail(email: unknown): Promise<MspSsoDiscoveryPayload | null> {
  const normalized = typeof email === 'string' ? normalizeResolverEmail(email) : '';
  const domain = normalized ? extractDomainFromEmail(normalized) : null;
  const secret = await getMspSsoSigningSecret();
  if (!domain || !secret) {
    return null;
  }
  const discovery = await discoverMspSsoProviderOptions(normalized);
  return createSignedMspSsoDiscoveryCookie({
    source: discovery?.source ?? 'app',
    tenantId: discovery?.tenantId,
    domain,
    providers: discovery?.providers ?? [],
    secret,
  }).payload;
}
