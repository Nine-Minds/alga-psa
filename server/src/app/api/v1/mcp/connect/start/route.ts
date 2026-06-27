/**
 * "Connect with Microsoft/Google" — start (EE). Admin-authed: returns the
 * provider authorize URL and sets the signed, path-scoped state cookie that the
 * callback requires. Implementation loaded via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Configured base URL (must match what the IdP whitelists), mirroring the email OAuth initiate route. */
async function resolveBaseUrl(req: NextRequest): Promise<string> {
  const sp = await getSecretProviderInstance();
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    (await sp.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
    process.env.NEXTAUTH_URL ||
    (await sp.getAppSecret('NEXTAUTH_URL')) ||
    req.nextUrl.origin ||
    'http://localhost:3000'
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const { authenticateMcpAdmin, buildConnectAuthUrl } = await import('@product/mcp/entry');
  const admin = await authenticateMcpAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { provider?: string };
  if (body.provider !== 'microsoft' && body.provider !== 'google') {
    return NextResponse.json({ error: 'provider must be "microsoft" or "google".' }, { status: 400 });
  }

  try {
    const baseUrl = await resolveBaseUrl(req);
    const { authUrl, stateCookie } = await buildConnectAuthUrl({
      provider: body.provider,
      tenant: admin.tenant,
      userId: admin.userId ?? '',
      baseUrl,
    });
    const res = NextResponse.json({ authUrl });
    res.cookies.set({
      name: stateCookie.name,
      value: stateCookie.value,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      // 'lax' so the cookie survives the top-level IdP -> callback redirect.
      sameSite: 'lax',
      path: '/api/v1/mcp/connect',
      maxAge: stateCookie.maxAgeSeconds,
    });
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to start connect.' }, { status: 400 });
  }
}
