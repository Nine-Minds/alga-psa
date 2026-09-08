'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { TicketConversationAttachmentsProvider, type TicketConversationAttachmentsProps } from '@alga-psa/tickets/components';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getPortalConversationAttachmentsAction } from '@/lib/actions/coManagedPortalAttachmentActions';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';
import type { PortalAttachmentTarget } from '@/lib/co-managed/portalAttachments';

type Screen = Awaited<ReturnType<typeof getPortalConversationAttachmentsAction>>;
function PortalAttachmentBoundary(props: TicketConversationAttachmentsProps) {
  return <CoManagedFeatureBoundary><PortalAttachments {...props} /></CoManagedFeatureBoundary>;
}
export function CoManagedPortalAttachmentsProvider({ children }: { children: ReactNode }) {
  return <TicketConversationAttachmentsProvider component={PortalAttachmentBoundary}>{children}</TicketConversationAttachmentsProvider>;
}
function PortalAttachments({ ticketId, comment }: TicketConversationAttachmentsProps) {
  const { data: session } = useSession();
  const identity = `${session?.session_id}:${session?.user?.tenant}:${session?.user?.id}:${ticketId}:${comment.thread_id}:${comment.comment_id}:${comment.conversation_id}`;
  if (session?.user?.user_type !== 'client' || !session.user.tenant || !session.user.id || !comment.thread_id || !comment.comment_id || comment.deleted_at) return null;
  return <AttachmentList key={identity} tenant={session.user.tenant} userId={session.user.id}
    target={{ ticketId, threadId: comment.thread_id, commentId: comment.comment_id,
      ...(comment.conversation_id ? { conversationId: comment.conversation_id } : {}) }} />;
}
function AttachmentList({ tenant, userId, target }: { tenant: string; userId: string; target: PortalAttachmentTarget }) {
  const { t } = useTranslation('msp/licensing');
  const [state, setState] = useState<Screen | null>(null), [error, setError] = useState(false);
  const destination = useRef({ ...target }), generation = useRef(0), mounted = useRef(false), loading = useRef(false), queued = useRef(false);
  const id = `portal-comment-${target.commentId}-attachments`;
  async function refresh() {
    if (loading.current) { queued.current = true; return; }
    loading.current = true; const current = ++generation.current;
    try {
      const value = await getPortalConversationAttachmentsAction(destination.current);
      if (!mounted.current || generation.current !== current) return;
      if (value.actor.tenant !== tenant || value.actor.userId !== userId || value.attachments.some(file =>
        file.storeTenant !== tenant || file.threadId !== target.threadId || file.commentId !== target.commentId || file.audience !== 'requester')) throw new Error('Attachment identity changed');
      setState(value); setError(false);
    } catch { if (mounted.current && generation.current === current) { setState(null); setError(true); } }
    finally { if (mounted.current && generation.current === current) {
      loading.current = false;
      if (queued.current) { queued.current = false; void refresh(); }
    } }
  }
  useEffect(() => {
    mounted.current = true; void refresh();
    const timer = setInterval(() => { void refresh(); }, 30000);
    return () => { mounted.current = false; generation.current++; loading.current = false; queued.current = false; clearInterval(timer); };
  }, []);
  if (!error && !state?.attachments.length) return null;
  return <section aria-labelledby={`${id}-title`} className="space-y-1">
    <h4 id={`${id}-title`} className="text-sm font-medium">{t('coManaged.attachments.title')}</h4>
    {error && <div className="flex items-center gap-2"><p role="status" className="text-sm">{t('coManaged.attachments.loadError')}</p>
      <Button id={`${id}-reload`} size="sm" variant="ghost" onClick={() => void refresh()}>{t('coManaged.ticket.reload')}</Button></div>}
    {state && <ul>{state.attachments.map(file => {
      const query = new URLSearchParams(Object.entries(destination.current).filter((entry): entry is [string, string] => entry[1] !== undefined));
      return <li key={file.attachmentId}><a id={`${id}-${file.attachmentId}-download`} className="break-words text-sm text-[rgb(var(--badge-info-text))] underline"
        href={`/api/client-portal/conversation-attachments/${encodeURIComponent(file.attachmentId)}?${query}`} download>{file.fileName}</a></li>;
    })}</ul>}
  </section>;
}
