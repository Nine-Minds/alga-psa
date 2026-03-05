import { NextRequest, NextResponse } from 'next/server';
import { parseFakeGoogleAccessToken } from '../oauthHarness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const identity = parseFakeGoogleAccessToken(request.headers.get('authorization'));
  if (!identity) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  return NextResponse.json({
    sub: identity.sub,
    email: identity.email,
    email_verified: true,
    name: identity.name,
    given_name: 'Playwright',
    family_name: 'Google',
    picture: 'https://example.test/fake-google-avatar.png',
  });
}
