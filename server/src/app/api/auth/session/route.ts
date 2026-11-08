import { NextResponse } from 'next/server';
import { auth } from '../[...nextauth]/auth';
import { getSessionCookieName } from '@alga-psa/auth/session';

export async function GET(request: Request) {
  try {
    // Full auth handler runs revocation checks so terminated sessions are removed promptly
    const session = await auth();
    if (!session?.user) {
      const requestIdCandidate = request.headers.get('x-request-id') || request.headers.get('x-correlation-id') || '';
      const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(requestIdCandidate) ? requestIdCandidate : 'unavailable';
      const cookieHeader = request.headers.get('cookie') ?? '';
      const cookiePresent = cookieHeader.split(';').some((cookie) => cookie.trim().startsWith(`${getSessionCookieName()}=`));
      console.warn('[auth] session_endpoint_empty', {
        reason: cookiePresent ? 'cookie_present_session_decode_expiry_or_durable_rejection' : 'cookie_absent',
        requestId,
      });
    }
    return NextResponse.json(session ?? {});
  } catch (e) {
    return NextResponse.json({ error: 'failed_to_get_session' }, { status: 500 });
  }
}
