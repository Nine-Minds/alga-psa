import { NextRequest, NextResponse } from 'next/server';
import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { getConnection } from '@alga-psa/db';
import { CoManagedSharedWorkError } from '@alga-psa/co-managed';
import { conversationAttachmentHeaders as headers, conversationAttachmentResponse } from '@/lib/co-managed/attachmentResponse';
import { downloadConversationAttachment } from '@/lib/co-managed/conversationAttachments';

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    const session = await getSession();
    if (getApiKeyUserOverride() || !session?.session_id || session.user?.user_type !== 'internal' || !session.user.tenant || !session.user.id)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    const query = request.nextUrl.searchParams, { attachmentId } = await params;
    const task = query.has('taskId'), parent = task ? 'taskId' : 'ticketId';
    if (query.getAll(parent).length !== 1 || task && query.has('ticketId')) throw new CoManagedSharedWorkError();
    const { attachment, content } = await downloadConversationAttachment(await getConnection(session.user.tenant),
      { kind: 'session', tenant: session.user.tenant, userId: session.user.id, sessionId: session.session_id },
      { kind: task ? 'project_task' : 'ticket', tenant: query.get('customerTenant') ?? '', relationshipId: query.get('relationshipId') ?? '', id: query.get(parent) ?? '' },
      { attachmentId, storeTenant: query.get('storeTenant') ?? '', threadId: query.get('threadId') ?? '', commentId: query.get('commentId') ?? '' });
    return conversationAttachmentResponse(attachment, content);
  } catch (error) {
    return NextResponse.json({ error: error instanceof CoManagedSharedWorkError ? 'Not found' : 'Unable to download attachment' },
      { status: error instanceof CoManagedSharedWorkError ? 404 : 503, headers });
  }
}
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
