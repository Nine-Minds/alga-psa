import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/edge-auth';
import { issueMobileOtt } from '@/lib/mobileAuth/mobileAuthService';

function validateRedirectUri(raw: string): URL | null {
  try {
    const url = new URL(raw);
    const scheme = url.protocol.replace(':', '').toLowerCase();

    const allowedSchemes = new Set(['alga', 'exp', 'https']);
    if (!allowedSchemes.has(scheme)) return null;

    const looksLikeAuthCallback =
      (url.host === 'auth' && url.pathname === '/callback') || url.pathname.endsWith('/auth/callback');

    if (!looksLikeAuthCallback) return null;

    return url;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const redirectParam = url.searchParams.get('redirect');
  const state = url.searchParams.get('state');

  if (!redirectParam || !state) {
    return NextResponse.redirect(new URL('/auth/signin', url.origin), { status: 302 });
  }

  const redirectUrl = validateRedirectUri(redirectParam);
  if (!redirectUrl) {
    const signIn = new URL('/auth/signin', url.origin);
    signIn.searchParams.set('error', 'invalid_redirect');
    return NextResponse.redirect(signIn.toString(), { status: 302 });
  }

  const session = await auth();
  const user = session?.user as any;
  const userId = typeof user?.id === 'string' ? user.id : null;
  const tenantId = typeof user?.tenant === 'string' ? user.tenant : null;
  const userType = typeof user?.user_type === 'string' ? user.user_type : null;
  const sessionId = (session as any)?.session_id as string | undefined;

  if (!userId || !tenantId) {
    const signIn = new URL('/auth/signin', url.origin);
    signIn.searchParams.set('callbackUrl', url.toString());
    return NextResponse.redirect(signIn.toString(), { status: 302 });
  }

  if (userType === 'client') {
    redirectUrl.searchParams.set('error', 'client_not_allowed');
    redirectUrl.searchParams.set('state', state);
    return NextResponse.redirect(redirectUrl.toString(), { status: 302 });
  }

  const { ott } = await issueMobileOtt({
    tenantId,
    userId,
    sessionId: sessionId ?? null,
    state,
    metadata: {
      issuedFromHost: req.headers.get('host') ?? null,
      userAgent: req.headers.get('user-agent') ?? null,
    },
  });

  redirectUrl.searchParams.set('ott', ott);
  redirectUrl.searchParams.set('state', state);

  const res = NextResponse.redirect(redirectUrl.toString(), { status: 302 });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
