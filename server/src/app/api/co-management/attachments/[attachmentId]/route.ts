import { NextRequest, NextResponse } from 'next/server';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { getConnection } from '@alga-psa/db';
import { capabilityRouteGuard } from '@alga-psa/core/capability/server';
import { CoManagedSharedWorkError } from '@alga-psa/co-managed';
import { conversationAttachmentHeaders as headers, conversationAttachmentResponse } from '@/lib/co-managed/attachmentResponse';
import { downloadConversationAttachment } from '@/lib/co-managed/conversationAttachments';

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    const session = await getSession();
    if (getApiKeyUserOverride() || !session?.session_id || session.user?.user_type !== 'internal' || !session.user.tenant || !session.user.id)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    // A sponsor admits; a customer workspace's own staff serve. Either side opens the route, neither is a 404.
    const closed = await capabilityRouteGuard('co-managed', session.user.tenant, 'admits') && await capabilityRouteGuard('co-managed', session.user.tenant, 'serves');
    if (closed) return closed;
    const query = request.nextUrl.searchParams, { attachmentId } = await params;
    // Ticket threads only; L4c registers the task thread kind and its parameter.
    if (query.getAll('ticketId').length !== 1 || query.has('taskId')) throw new CoManagedSharedWorkError();
    const { attachment, content } = await downloadConversationAttachment(await getConnection(session.user.tenant),
      { kind: 'session', tenant: session.user.tenant, userId: session.user.id, sessionId: session.session_id },
      { kind: 'ticket', tenant: query.get('customerTenant') ?? '', relationshipId: query.get('relationshipId') ?? '', id: query.get('ticketId') ?? '' },
      { attachmentId, storeTenant: query.get('storeTenant') ?? '', threadId: query.get('threadId') ?? '', commentId: query.get('commentId') ?? '' });
    return conversationAttachmentResponse(attachment, content);
  } catch (error) {
    return NextResponse.json({ error: error instanceof CoManagedSharedWorkError ? 'Not found' : 'Unable to download attachment' },
      { status: error instanceof CoManagedSharedWorkError ? 404 : 503, headers });
  }
}
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
