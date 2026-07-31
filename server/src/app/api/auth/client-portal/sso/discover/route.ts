import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import {
  CLIENT_PORTAL_SSO_DISCOVERY_COOKIE,
  CLIENT_PORTAL_SSO_DISCOVERY_TTL_SECONDS,
  createSignedClientPortalSsoDiscoveryCookie,
  discoverClientPortalSsoProviders,
  getMspSsoSigningSecret,
  isValidClientPortalResolverCallbackUrl,
  normalizeResolverEmail,
  resolveClientPortalSsoTenantContext,
} from '@alga-psa/auth/lib/sso/clientPortalSsoResolution';

export const dynamic = 'force-dynamic';

const discoveryRateLimiter = new RateLimiterMemory({
  points: 12,
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

function clearDiscoveryCookie(response: NextResponse): void {
  response.cookies.set({
    name: CLIENT_PORTAL_SSO_DISCOVERY_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function buildNeutralDiscoveryResponse(): NextResponse {
  const response = NextResponse.json({ ok: true, providers: [] }, { status: 200 });
  clearDiscoveryCookie(response);
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => null)) as
      | { email?: unknown; tenantSlug?: unknown; portalDomain?: unknown; callbackUrl?: unknown }
      | null;
    const email = typeof body?.email === 'string' ? normalizeResolverEmail(body.email) : '';
    if (!email || !EMAIL_PATTERN.test(email)) {
      return buildNeutralDiscoveryResponse();
    }
    const callbackUrl = typeof body?.callbackUrl === 'string' ? body.callbackUrl.trim() : undefined;
    if (!isValidClientPortalResolverCallbackUrl(callbackUrl)) {
      return buildNeutralDiscoveryResponse();
    }

    const ip = getRequestIp(request);
    const emailHashBucket = createHash('sha256').update(email).digest('hex').slice(0, 16);
    try {
      await discoveryRateLimiter.consume(`${ip}:${emailHashBucket}`);
    } catch {
      return buildNeutralDiscoveryResponse();
    }

    const tenantContext = await resolveClientPortalSsoTenantContext({
      tenantSlug: typeof body?.tenantSlug === 'string' ? body.tenantSlug : undefined,
      portalDomain: typeof body?.portalDomain === 'string' ? body.portalDomain : undefined,
      callbackUrl,
    });

    if (!tenantContext.tenantId) {
      return buildNeutralDiscoveryResponse();
    }

    const providers = await discoverClientPortalSsoProviders(tenantContext.tenantId);
    const signingSecret = await getMspSsoSigningSecret();
    if (!signingSecret) {
      return buildNeutralDiscoveryResponse();
    }

    const cookie = createSignedClientPortalSsoDiscoveryCookie({
      tenantId: tenantContext.tenantId,
      providers,
      callbackUrl,
      secret: signingSecret,
      ttlSeconds: CLIENT_PORTAL_SSO_DISCOVERY_TTL_SECONDS,
    });

    const response = NextResponse.json({ ok: true, providers }, { status: 200 });
    response.cookies.set({
      name: CLIENT_PORTAL_SSO_DISCOVERY_COOKIE,
      value: cookie.value,
      path: '/',
      maxAge: CLIENT_PORTAL_SSO_DISCOVERY_TTL_SECONDS,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    return response;
  } catch {
    return buildNeutralDiscoveryResponse();
  }
}
