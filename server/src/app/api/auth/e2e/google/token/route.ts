import { NextRequest, NextResponse } from 'next/server';
import { createFakeGoogleAccessToken } from '../oauthHarness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const code = formData.get('code');
  const accessToken = createFakeGoogleAccessToken(
    typeof code === 'string' ? code : null,
  );

  if (!accessToken) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  return NextResponse.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'openid email profile',
  });
}
