import { NextRequest, NextResponse } from 'next/server';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { getConnection } from '@alga-psa/db';
import { CoManagedSharedWorkError } from '@alga-psa/co-managed';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { downloadPortalConversationAttachment } from '@/lib/co-managed/portalAttachments';
import { conversationAttachmentHeaders as headers, conversationAttachmentResponse } from '@/lib/co-managed/attachmentResponse';

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    const session = await getSession();
    if (getApiKeyUserOverride() || !session?.session_id || session.user?.user_type !== 'client' || !session.user.tenant || !session.user.id)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    const query = request.nextUrl.searchParams, { attachmentId } = await params;
    // The store always comes from the verified requester session, never a URL tenant.
    const result = await downloadPortalConversationAttachment(await getConnection(session.user.tenant),
      { kind: 'session', tenant: session.user.tenant, userId: session.user.id, sessionId: session.session_id },
      { ticketId: query.get('ticketId') ?? '', threadId: query.get('threadId') ?? '', commentId: query.get('commentId') ?? '' }, attachmentId,
      async path => (await StorageProviderFactory.createProvider()).download(path));
    return conversationAttachmentResponse(result.attachment, result.content);
  } catch (error) {
    return NextResponse.json({ error: error instanceof CoManagedSharedWorkError ? 'Not found' : 'Unable to download attachment' },
      { status: error instanceof CoManagedSharedWorkError ? 404 : 503, headers });
  }
}
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
