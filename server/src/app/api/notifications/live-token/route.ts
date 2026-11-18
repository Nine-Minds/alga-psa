import { NextResponse } from 'next/server';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { getHocuspocusJwtSecret } from '@/lib/hocuspocusJwt';
import { issueNotificationLiveToken } from '@/lib/notifications/notificationLiveToken';

const headers = { 'Cache-Control': 'no-store, private' };

export async function GET() {
  try {
    // A machine principal must never mint a browser room token.
    if (getApiKeyUserOverride()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });

    // getSession() already enforces revocation, owner and user_type; the signer
    // needs no database access of its own.
    const session = await getSession();
    const user = session?.user;
    const sessionExpiresAt = session?.expires ? new Date(session.expires).getTime() : NaN;
    if (!session?.session_id || !user?.tenant || !user.id || !['internal', 'client'].includes(user.user_type ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    }

    const result = issueNotificationLiveToken(
      { tenant: user.tenant, userId: user.id, sessionId: session.session_id, userType: user.user_type as 'internal' | 'client' },
      { secret: await getHocuspocusJwtSecret(), sessionExpiresAt },
    );
    return result
      // Relative lifetime from the server clock: browsers must not compare the
      // absolute expiresAt with their own (possibly skewed) clock.
      ? NextResponse.json({ ...result, expiresInMs: result.expiresAt - Date.now() }, { headers })
      : NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  } catch {
    return NextResponse.json({ error: 'Unable to open notification stream' }, { status: 503, headers });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
