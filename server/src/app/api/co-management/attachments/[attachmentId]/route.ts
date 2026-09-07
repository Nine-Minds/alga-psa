import { NextRequest, NextResponse } from 'next/server';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { getConnection } from '@alga-psa/db';
import { CoManagedSharedWorkError } from '@alga-psa/co-managed';
import { downloadConversationAttachment } from '@/lib/co-managed/conversationAttachments';

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" };
  try {
    const session = await getSession();
    if (getApiKeyUserOverride() || !session?.session_id || session.user?.user_type !== 'internal' || !session.user.tenant || !session.user.id)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    const query = request.nextUrl.searchParams, { attachmentId } = await params;
    const { attachment, content } = await downloadConversationAttachment(await getConnection(session.user.tenant),
      { kind: 'session', tenant: session.user.tenant, userId: session.user.id, sessionId: session.session_id },
      { kind: 'ticket', tenant: query.get('customerTenant') ?? '', relationshipId: query.get('relationshipId') ?? '', id: query.get('ticketId') ?? '' },
      { attachmentId, storeTenant: query.get('storeTenant') ?? '', threadId: query.get('threadId') ?? '', commentId: query.get('commentId') ?? '' });
    const ascii = attachment.fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
    const encoded = encodeURIComponent(attachment.fileName).replace(/['()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(content as BodyInit, { headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(content.length),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}` } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof CoManagedSharedWorkError ? 'Not found' : 'Unable to download attachment' },
      { status: error instanceof CoManagedSharedWorkError ? 404 : 503, headers });
  }
}
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
