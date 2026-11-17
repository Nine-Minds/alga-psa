import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@alga-psa/db/admin';
import { signIn } from '@alga-psa/auth/nextauth/auth';
import {
  MSP_SSO_RESOLUTION_COOKIE,
  MSP_SSO_RESOLUTION_TTL_SECONDS,
  getMspSsoSigningSecret,
  isSupportedProvider,
} from '@alga-psa/auth/lib/sso/mspSsoResolution';
import {
  CLIENT_PORTAL_SSO_DISCOVERY_COOKIE,
  CLIENT_PORTAL_SSO_RESOLUTION_COOKIE,
} from '@alga-psa/auth/lib/sso/clientPortalSsoResolution';
import {
  MSP_SSO_HANDOFF_COOKIE,
  MSP_SSO_HANDOFF_TTL_SECONDS,
  createSignedMspSsoHandoffCookie,
} from '@alga-psa/auth/lib/sso/mspSsoHandoff';
import {
  buildClearedPendingRememberContextCookie,
  buildPendingRememberContextCookie,
} from '@alga-psa/auth/lib/mspRememberedEmail';
import {
  HANDOFF_DEFAULT_RETURN_PATH,
  isPortalDomainHandoffTarget,
  normalizeHandoffReturnPath,
} from '@alga-psa/shared/core/portalDomainSurface';
import { getPortalDomainByHostname, normalizeHostname } from 'server/src/models/PortalDomainModel';
import {
  buildMspSsoDiscoveryFromEmail,
  getRequestIpFromHeaders,
  resolveMspSso,
} from 'server/src/lib/auth/mspSsoResolve';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Canonical-host entry point for MSP SSO begun on a custom domain (alga-2026-0002996).
 *
 * The OAuth state, PKCE and CSRF cookies and the SSO resolution cookies are host-only, so the
 * whole round trip has to start and end on the canonical host (NEXTAUTH_URL), whose
 * callback URI is the only one a provider app needs. The sign-in page on the custom domain
 * makes one top-level navigation here:
 *
 *   GET /api/auth/msp/sso/start?provider=&email=&domain=&return=
 *
 * Step 1 runs the same resolution as `POST /api/auth/msp/sso/resolve`, records the custom
 * domain and return path in a signed handoff cookie when the domain is an active MSP domain,
 * and continues to step 2 (`step=authorize`), which starts the OAuth request, so the
 * provider sees the canonical redirect_uri. After the provider returns, the `signIn`
 * callback hands the session to the custom domain with a one-time token. A target that is
 * not an active MSP-serving domain simply continues sign-in on the canonical host.
 */

function canonicalOrigin(): string | null {
  try {
    return process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null;
  } catch {
    return null;
  }
}

function cookieBase() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

function clearCookie(response: NextResponse, name: string): void {
  response.cookies.set({ name, value: '', maxAge: 0, ...cookieBase() });
}

/**
 * An active domain serving the MSP app (any tenant: tenant ownership is checked at handoff).
 *
 * `rawDomain` is the browser's `location.host`, so it carries the port when the custom host is
 * served on a non-default one. Domains are stored without a port (the middleware's host-surface
 * lookup matches the bare hostname), so try `host:port` first and then the bare hostname, the
 * same candidates `computeVanityRedirect` and `/api/portal-domain/surface` use. The value
 * returned is the host the browser used (port included), so the handoff lands back on it.
 */
async function lookupMspHandoffDomain(rawDomain: string | null): Promise<string | null> {
  const host = rawDomain ? normalizeHostname(rawDomain) : '';
  if (!host) {
    return null;
  }
  const candidates = host.includes(':') ? [host, host.slice(0, host.lastIndexOf(':'))] : [host];
  try {
    const knex = await getAdminConnection();
    for (const candidate of candidates) {
      const record = await getPortalDomainByHostname(knex, candidate);
      if (record && isPortalDomainHandoffTarget(record, 'msp')) {
        return host;
      }
    }
    return null;
  } catch (error) {
    console.warn('[msp-sso-start] custom domain lookup failed; continuing on the canonical host', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function failureRedirect(origin: string, domain: string | null, returnPath: string): NextResponse {
  const base = domain ? `${new URL(origin).protocol}//${domain}` : origin;
  const url = new URL('/auth/msp/signin', base);
  url.searchParams.set('callbackUrl', returnPath);
  url.searchParams.set('error', 'Configuration');
  const response = NextResponse.redirect(url);
  clearCookie(response, MSP_SSO_RESOLUTION_COOKIE);
  clearCookie(response, MSP_SSO_HANDOFF_COOKIE);
  response.cookies.set(buildClearedPendingRememberContextCookie());
  return response;
}

export async function GET(request: NextRequest): Promise<Response> {
  const origin = canonicalOrigin();
  if (!origin) {
    return NextResponse.json({ error: 'canonical_host_unconfigured' }, { status: 500 });
  }

  const params = request.nextUrl.searchParams;
  const providerParam = params.get('provider');
  const returnPath = normalizeHandoffReturnPath(params.get('return'), 'msp') ?? HANDOFF_DEFAULT_RETURN_PATH.msp;
  const step = params.get('step');

  if (!providerParam || !isSupportedProvider(providerParam)) {
    return failureRedirect(origin, null, returnPath);
  }
  const provider = providerParam;

  if (step === 'authorize') {
    // Step 2: cookies from step 1 are now on this (canonical) host's requests.
    if (process.env.PLAYWRIGHT_FAKE_GOOGLE_OAUTH === 'true' && provider === 'google') {
      const completion = new URL('/api/auth/e2e/google/complete', origin);
      completion.searchParams.set('callbackUrl', returnPath);
      return NextResponse.redirect(completion);
    }

    const tenantHint = params.get('tenant');
    const authorizationParams: Record<string, string> = {
      state: JSON.stringify({
        mode: 'login',
        user_type: 'internal',
        tenant: tenantHint ?? null,
        callback_url: returnPath,
      }),
    };
    if (tenantHint) {
      authorizationParams.tenant_hint = tenantHint;
    }
    // Throws NEXT_REDIRECT to the provider's authorize URL; Next turns that into the response.
    await signIn(provider, { redirectTo: returnPath }, authorizationParams);
    return NextResponse.redirect(new URL(returnPath, origin));
  }

  // Step 1: resolve, remember the custom domain, hop to step 2.
  const targetDomain = await lookupMspHandoffDomain(params.get('domain'));

  const email = params.get('email');
  const result = await resolveMspSso({
    provider,
    email,
    publicWorkstation: params.get('publicWorkstation') === 'true',
    callbackUrl: returnPath,
    tenantSlug: params.get('tenant') ?? undefined,
    discovery: await buildMspSsoDiscoveryFromEmail(email),
    ip: getRequestIpFromHeaders(request.headers),
  });
  if (!result.ok) {
    return failureRedirect(origin, targetDomain, returnPath);
  }

  const next = new URL('/api/auth/msp/sso/start', origin);
  next.searchParams.set('provider', provider);
  next.searchParams.set('return', returnPath);
  next.searchParams.set('step', 'authorize');
  const tenant = params.get('tenant');
  if (tenant) {
    next.searchParams.set('tenant', tenant);
  }
  const response = NextResponse.redirect(next);

  for (const name of [CLIENT_PORTAL_SSO_DISCOVERY_COOKIE, CLIENT_PORTAL_SSO_RESOLUTION_COOKIE]) {
    clearCookie(response, name);
  }
  response.cookies.set({
    name: MSP_SSO_RESOLUTION_COOKIE,
    value: result.resolutionCookieValue,
    maxAge: MSP_SSO_RESOLUTION_TTL_SECONDS,
    ...cookieBase(),
  });
  response.cookies.set(buildPendingRememberContextCookie(result.pendingRememberContextCookieValue));

  const secret = targetDomain ? await getMspSsoSigningSecret() : null;
  if (targetDomain && secret) {
    const handoff = createSignedMspSsoHandoffCookie({ domain: targetDomain, returnPath, secret });
    response.cookies.set({
      name: MSP_SSO_HANDOFF_COOKIE,
      value: handoff.value,
      maxAge: MSP_SSO_HANDOFF_TTL_SECONDS,
      ...cookieBase(),
    });
  } else {
    clearCookie(response, MSP_SSO_HANDOFF_COOKIE);
  }

  return response;
}
