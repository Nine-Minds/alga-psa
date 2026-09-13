import { NextRequest, NextResponse } from 'next/server';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { getConnection } from '@alga-psa/db';
import { downloadNamedConversationAttachment, CoManagedSharedWorkError } from '@alga-psa/co-managed';
import { TicketConversationError } from '@alga-psa/shared/lib/tickets/namedConversations';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { conversationAttachmentHeaders as headers, conversationAttachmentResponse } from '@/lib/co-managed/attachmentResponse';

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    const session = await getSession();
    if (getApiKeyUserOverride() || !session?.session_id || session.user?.user_type !== 'internal' || !session.user.tenant || !session.user.id)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    const query = request.nextUrl.searchParams, { attachmentId } = await params;
    const relationshipId = query.get('relationshipId');
    const result = await downloadNamedConversationAttachment(await getConnection(session.user.tenant),
      { kind: 'session', tenant: session.user.tenant, userId: session.user.id, sessionId: session.session_id },
      { tenant: query.get('ticketTenant') ?? '', ticketId: query.get('ticketId') ?? '', ...(relationshipId ? { relationshipId } : {}) },
      { storeTenant: query.get('storeTenant') ?? '', conversationId: query.get('conversationId') ?? '' },
      { attachmentId, threadId: query.get('threadId') ?? '', commentId: query.get('commentId') ?? '' }, async path => {
        const provider = await StorageProviderFactory.createProvider();
        return provider.download(path);
      });
    return conversationAttachmentResponse(result.attachment, result.content);
  } catch (error) {
    const denied = error instanceof TicketConversationError || error instanceof CoManagedSharedWorkError;
    return NextResponse.json({ error: denied ? 'Not found' : 'Unable to download attachment' }, { status: denied ? 404 : 503, headers });
  }
}
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
