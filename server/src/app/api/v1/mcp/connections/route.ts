/**
 * A user's own connected MCP clients (EE). The interactive MCP OAuth flow issues
 * tokens that act as the signed-in user; this lets that user see and disconnect
 * the clients (e.g. Claude) they've authorized. User-session authed (not admin).
 * Implementation loaded via the @product/mcp seam.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isEnterpriseEdition } from '@/lib/features';
import { getCurrentUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { listConnectedClients } = await import('@product/mcp/entry');
  return NextResponse.json({ data: await listConnectedClients(user.tenant, user.user_id) });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) return NextResponse.json({ error: 'Enterprise feature' }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const grantId = req.nextUrl.searchParams.get('grantId') ?? undefined;
  if (!grantId) return NextResponse.json({ error: '"grantId" is required.' }, { status: 400 });
  const { revokeGrant } = await import('@product/mcp/entry');
  const revoked = await revokeGrant({ tenant: user.tenant, userId: user.user_id, grantId });
  return NextResponse.json({ ok: true, revoked });
}
