import { NextResponse } from 'next/server';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { getConnection } from '@alga-psa/db';
import { issueNotificationLiveToken } from '@/lib/notifications/notificationLiveToken';

export async function GET() {
  const headers = { 'Cache-Control': 'no-store, private' };
  try {
    if (getApiKeyUserOverride()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    const session = await getSession();
    const user = session?.user;
    if (!session?.session_id || !user?.tenant || !user.id || !['internal', 'client'].includes(user.user_type ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    }
    const result = await issueNotificationLiveToken(await getConnection(user.tenant), { tenant: user.tenant, userId: user.id,
      sessionId: session.session_id, userType: user.user_type as 'internal' | 'client' });
    return result ? NextResponse.json(result, { headers }) : NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  } catch {
    return NextResponse.json({ error: 'Unable to open notification stream' }, { status: 503, headers });
  }
}
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
