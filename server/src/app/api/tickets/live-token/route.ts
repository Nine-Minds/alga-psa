import { NextResponse } from 'next/server';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { getHocuspocusJwtSecret } from '@/lib/hocuspocusJwt';
import { issueTicketChangesLiveToken } from '@/lib/notifications/ticketChangesLiveToken';

export async function GET() {
  try {
    if (getApiKeyUserOverride()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const session = await getSession();
    const user = session?.user;
    const expiresAt = session?.expires ? new Date(session.expires).getTime() : NaN;
    if (!session?.session_id || !user?.tenant || !user.id || user.user_type !== 'internal') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = issueTicketChangesLiveToken({
      tenantId: user.tenant, userId: user.id, sessionId: session.session_id,
      secret: await getHocuspocusJwtSecret(), sessionExpiresAt: expiresAt,
    });
    return result
      ? NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } })
      : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Unable to open ticket change stream' }, { status: 503 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
