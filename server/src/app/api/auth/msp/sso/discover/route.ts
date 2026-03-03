import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import {
  MSP_SSO_DISCOVERY_COOKIE,
  MSP_SSO_DISCOVERY_TTL_SECONDS,
  createSignedMspSsoDiscoveryCookie,
  discoverMspSsoProviderOptions,
  extractDomainFromEmail,
  getMspSsoSigningSecret,
  normalizeResolverEmail,
} from '@alga-psa/auth/lib/sso/mspSsoResolution';

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
    name: MSP_SSO_DISCOVERY_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function buildNeutralDiscoveryResponse(options?: { clearCookie?: boolean }): NextResponse {
  const response = NextResponse.json(
    {
      ok: true,
      providers: [],
    },
    { status: 200 }
  );

  if (options?.clearCookie !== false) {
    clearDiscoveryCookie(response);
  }

  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === 'string' ? normalizeResolverEmail(body.email) : '';

    if (!email || !EMAIL_PATTERN.test(email)) {
      return buildNeutralDiscoveryResponse();
    }

    const ip = getRequestIp(request);
    const emailHashBucket = createHash('sha256').update(email).digest('hex').slice(0, 16);
    const limiterKey = `${ip}:${emailHashBucket}`;
    try {
      await discoveryRateLimiter.consume(limiterKey);
    } catch {
      return buildNeutralDiscoveryResponse();
    }

    const domain = extractDomainFromEmail(email);
    if (!domain) {
      return buildNeutralDiscoveryResponse();
    }

    const discovery = await discoverMspSsoProviderOptions(email);
    const providers = discovery?.providers ?? [];

    const signingSecret = await getMspSsoSigningSecret();
    if (!signingSecret) {
      console.warn('[msp-sso-discover] NEXTAUTH_SECRET not configured; unable to issue discovery cookie');
      return buildNeutralDiscoveryResponse();
    }

    const cookie = createSignedMspSsoDiscoveryCookie({
      source: discovery?.source ?? 'app',
      tenantId: discovery?.tenantId,
      domain,
      providers,
      secret: signingSecret,
      ttlSeconds: MSP_SSO_DISCOVERY_TTL_SECONDS,
    });

    const response = NextResponse.json(
      {
        ok: true,
        providers,
      },
      { status: 200 }
    );

    response.cookies.set({
      name: MSP_SSO_DISCOVERY_COOKIE,
      value: cookie.value,
      path: '/',
      maxAge: MSP_SSO_DISCOVERY_TTL_SECONDS,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    console.info('[msp-sso-discover] provider options resolved', {
      source: discovery?.source ?? 'app',
      providerCount: providers.length,
      domain,
      ambiguous: Boolean(discovery?.ambiguous),
    });

    return response;
  } catch (error) {
    console.error('[msp-sso-discover] unexpected failure', {
      message: error instanceof Error ? error.message : String(error),
    });
    return buildNeutralDiscoveryResponse();
  }
}
