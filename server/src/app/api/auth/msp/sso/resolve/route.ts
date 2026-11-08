import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { getTenantIdBySlug, isValidTenantSlug } from '@alga-psa/db';
import {
  MSP_SSO_DISCOVERY_COOKIE,
  MSP_SSO_GENERIC_FAILURE_MESSAGE,
  MSP_SSO_RESOLUTION_COOKIE,
  MSP_SSO_RESOLUTION_TTL_SECONDS,
  createSignedMspSsoResolutionCookie,
  getMspSsoSigningSecret,
  hasAppFallbackProviderCredentials,
  isValidResolverCallbackUrl,
  normalizeResolverEmail,
  parseAndVerifyMspSsoDiscoveryCookie,
  parseResolverProvider,
  resolveMspSsoCredentialSource,
} from '@alga-psa/auth/lib/sso/mspSsoResolution';
import {
  CLIENT_PORTAL_SSO_DISCOVERY_COOKIE,
  CLIENT_PORTAL_SSO_RESOLUTION_COOKIE,
} from '@alga-psa/auth/lib/sso/clientPortalSsoResolution';
import {
  buildClearedPendingRememberContextCookie,
  buildPendingRememberContextCookie,
  createPendingRememberContextCookie,
} from '@alga-psa/auth/lib/mspRememberedEmail';

export const dynamic = 'force-dynamic';

const resolverRateLimiter = new RateLimiterMemory({
  points: 8,
  duration: 60,
  blockDuration: 5 * 60,
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getRequestIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

function buildGenericFailureResponse(): NextResponse {
  // Anti-enumeration rule: every failure path must return the exact same response shape/message.
  const response = NextResponse.json(
    { ok: false, message: MSP_SSO_GENERIC_FAILURE_MESSAGE },
    { status: 200 }
  );
  response.cookies.set({
    name: MSP_SSO_RESOLUTION_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  response.cookies.set(buildClearedPendingRememberContextCookie());
  return response;
}

function clearClientPortalSsoCookies(response: NextResponse): void {
  for (const cookieName of [
    CLIENT_PORTAL_SSO_DISCOVERY_COOKIE,
    CLIENT_PORTAL_SSO_RESOLUTION_COOKIE,
  ]) {
    response.cookies.set({
      name: cookieName,
      value: '',
      path: '/',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => null)) as
      | { provider?: unknown; email?: unknown; publicWorkstation?: unknown; callbackUrl?: unknown; tenantSlug?: unknown }
      | null;

    const provider = parseResolverProvider(body?.provider);
    const email = typeof body?.email === 'string' ? normalizeResolverEmail(body.email) : '';
    const publicWorkstation = body?.publicWorkstation === true;
    const callbackUrl =
      typeof body?.callbackUrl === 'string' ? body.callbackUrl.trim() : undefined;

    const rawTenantSlug = body?.tenantSlug;
    const tenantSlug =
      typeof rawTenantSlug === 'string' && rawTenantSlug.trim() ? rawTenantSlug.trim().toLowerCase() : undefined;
    // A slug that was supplied but is bad fails the same way as everything else.
    if (rawTenantSlug !== undefined && rawTenantSlug !== null && rawTenantSlug !== '' && !tenantSlug) {
      return buildGenericFailureResponse();
    }

    if (
      !provider ||
      !email ||
      !EMAIL_PATTERN.test(email) ||
      !isValidResolverCallbackUrl(callbackUrl)
    ) {
      return buildGenericFailureResponse();
    }

    const ip = getRequestIp(request);
    const emailHashBucket = createHash('sha256').update(email).digest('hex').slice(0, 16);
    const limiterKey = `${ip}:${emailHashBucket}`;

    try {
      await resolverRateLimiter.consume(limiterKey);
    } catch {
      return buildGenericFailureResponse();
    }

    const signingSecret = await getMspSsoSigningSecret();
    if (!signingSecret) {
      console.warn('[msp-sso-resolve] NEXTAUTH_SECRET not configured; unable to issue resolution cookie');
      return buildGenericFailureResponse();
    }

    const discoveryCookieValue = request.cookies.get(MSP_SSO_DISCOVERY_COOKIE)?.value;
    const discoveryContext = parseAndVerifyMspSsoDiscoveryCookie({
      value: discoveryCookieValue,
      secret: signingSecret,
    });

    // Scoped sign-in: the slug names the only tenant whose user may be signed
    // in. Resolve it here, server-side, and sign it into the cookie.
    let scopeTenantId: string | undefined;
    if (tenantSlug) {
      if (!isValidTenantSlug(tenantSlug)) {
        return buildGenericFailureResponse();
      }
      scopeTenantId = (await getTenantIdBySlug(tenantSlug)) ?? undefined;
      if (!scopeTenantId) {
        return buildGenericFailureResponse();
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
      return buildGenericFailureResponse();
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

    const response = NextResponse.json({ ok: true }, { status: 200 });
    clearClientPortalSsoCookies(response);
    response.cookies.set({
      name: MSP_SSO_RESOLUTION_COOKIE,
      value: cookie.value,
      path: '/',
      maxAge: MSP_SSO_RESOLUTION_TTL_SECONDS,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    response.cookies.set(buildPendingRememberContextCookie(pendingRememberContext.value));

    console.info('[msp-sso-resolve] credential source selected', {
      provider,
      source: outcome.source,
    });

    return response;
  } catch (error) {
    console.error('[msp-sso-resolve] unexpected failure', {
      message: error instanceof Error ? error.message : String(error),
    });
    return buildGenericFailureResponse();
  }
}
