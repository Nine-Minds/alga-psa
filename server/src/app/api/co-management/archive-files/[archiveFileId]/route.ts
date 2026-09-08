import { NextRequest, NextResponse } from 'next/server';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { getConnection } from '@alga-psa/db';
import { downloadCoManagedArchiveFile, CoManagedSharedWorkError } from '@alga-psa/co-managed';
import { conversationAttachmentHeaders as headers, conversationAttachmentResponse } from '@/lib/co-managed/attachmentResponse';

export async function GET(request: NextRequest, { params }: { params: Promise<{ archiveFileId: string }> }) {
  try {
    const session = await getSession();
    if (getApiKeyUserOverride() || !session?.session_id || session.user?.user_type !== 'internal' || !session.user.tenant || !session.user.id)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    const query = request.nextUrl.searchParams, { archiveFileId } = await params;
    const { attachment, content } = await downloadCoManagedArchiveFile(await getConnection(session.user.tenant),
      { kind: 'session', tenant: session.user.tenant, userId: session.user.id, sessionId: session.session_id },
      { kind: 'ticket', tenant: query.get('customerTenant') ?? '', relationshipId: query.get('relationshipId') ?? '', id: query.get('ticketId') ?? '' }, archiveFileId);
    return conversationAttachmentResponse(attachment, content);
  } catch (error) {
    return NextResponse.json({ error: error instanceof CoManagedSharedWorkError ? 'Not found' : 'Unable to download attachment' },
      { status: error instanceof CoManagedSharedWorkError ? 404 : 503, headers });
  }
}
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
