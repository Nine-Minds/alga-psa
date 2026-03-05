import { NextRequest, NextResponse } from 'next/server';
import {
  createFakeGoogleAuthorizationCode,
  getFakeGoogleOauthMode,
} from '../oauthHarness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const redirectUri = request.nextUrl.searchParams.get('redirect_uri');
  const state = request.nextUrl.searchParams.get('state');

  if (!redirectUri || !state) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set('state', state);

  if (getFakeGoogleOauthMode(request) === 'cancel') {
    callbackUrl.searchParams.set('error', 'access_denied');
    return NextResponse.redirect(callbackUrl);
  }

  callbackUrl.searchParams.set('code', await createFakeGoogleAuthorizationCode(request));
  return NextResponse.redirect(callbackUrl);
}
