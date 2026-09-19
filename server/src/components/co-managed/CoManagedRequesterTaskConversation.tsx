'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { RequesterTaskConversationProvider, type RequesterTaskConversationProps } from '@alga-psa/client-portal/components';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';
import { getRequesterTaskConversationAction, createRequesterTaskCommentAction } from '@/lib/actions/coManagedRequesterTaskActions';
import { conversationText } from './conversationText';

type Screen = Awaited<ReturnType<typeof getRequesterTaskConversationAction>>;
type Request = Parameters<typeof createRequesterTaskCommentAction>[1];
function Boundary(props: RequesterTaskConversationProps) {
  return <CoManagedFeatureBoundary><Conversation {...props} /></CoManagedFeatureBoundary>;
}
export function CoManagedRequesterTaskProvider({ children }: { children: ReactNode }) {
  return <RequesterTaskConversationProvider component={Boundary}>{children}</RequesterTaskConversationProvider>;
}
function Conversation(props: RequesterTaskConversationProps) {
  const { data: session } = useSession();
  const { t } = useTranslation('msp/licensing');
  const [open, setOpen] = useState(false);
  const taskLinkHandled = useRef<string | null>(null);
  useEffect(() => {
    if (session?.user?.user_type !== 'client' || !session.session_id || !session.user.tenant || !session.user.id) return;
    const target = `${props.projectId}:${props.taskId}`;
    if (taskLinkHandled.current === target) return;
    taskLinkHandled.current = target;
    if (new URLSearchParams(window.location.search).get('taskId') === props.taskId) setOpen(true);
  }, [props.projectId, props.taskId, session]);
  if (session?.user?.user_type !== 'client' || !session.session_id || !session.user.tenant || !session.user.id) return null;
  const identity = `${session.session_id}:${session.user.tenant}:${session.user.id}:${props.projectId}:${props.taskId}`;
  return <>
    <Button id={`requester-task-${props.taskId}-conversation`} size="sm" variant="ghost" onClick={() => setOpen(true)}>{t('coManaged.conversation.title')}</Button>
    <Dialog id={`requester-task-${props.taskId}-dialog`} isOpen={open} onClose={() => setOpen(false)} title={t('coManaged.conversation.title')} className="max-w-2xl">
      {open && <Messages key={identity} {...props} tenant={session.user.tenant} userId={session.user.id} />}
    </Dialog>
  </>;
}
function Messages({ tenant, userId, ...target }: RequesterTaskConversationProps & { tenant: string; userId: string }) {
  const { t } = useTranslation('msp/licensing'), { formatDate } = useFormatters();
  const [screen, setScreen] = useState<Screen | null>(null), [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false), [sendError, setSendError] = useState(false), [text, setText] = useState('');
  const [parent, setParent] = useState<{ threadId: string; commentId: string } | undefined>();
  const pending = useRef<Request | null>(null), mounted = useRef(false), sequence = useRef(0), saving = useRef(false);
  const [cursor, setCursor] = useState<Screen['nextBefore']>(null);
  const id = `requester-task-${target.taskId}`;
  async function load(before = cursor) {
    const current = ++sequence.current;
    try {
      const result = await getRequesterTaskConversationAction(target, before ?? undefined);
      if (!mounted.current || current !== sequence.current) return;
      if (result.actor.tenant !== tenant || result.actor.userId !== userId || result.target.taskId !== target.taskId || result.target.projectId !== target.projectId) throw new Error('Identity changed');
      setScreen(result); setLoadError(false); setCursor(before);
    } catch { if (mounted.current && current === sequence.current) { setScreen(null); setLoadError(true); } }
  }
  useEffect(() => { mounted.current = true; void load(null); return () => { mounted.current = false; sequence.current++; }; }, []);
  async function send() {
    if (saving.current || !screen?.canWrite) return;
    saving.current = true; setBusy(true); setSendError(false);
    const request = pending.current ?? { operationId: crypto.randomUUID(), text, ...(parent ? { parent } : {}) };
    pending.current = request;
    try {
      await createRequesterTaskCommentAction(target, request);
      if (!mounted.current) return;
      pending.current = null; setText(''); setParent(undefined); await load(null);
    } catch { if (mounted.current) { setSendError(true); await load(); } }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="my-3 space-y-3 rounded border p-3" aria-label={t('coManaged.conversation.title')}>
    <p className="text-sm">{t('coManaged.conversation.audienceHelp.requester')}</p>
    {loadError && <p role="alert">{t('coManaged.conversation.loadError')}</p>}
    <Button id={`${id}-refresh`} size="sm" variant="ghost" disabled={busy} onClick={() => void load(null)}>{t('coManaged.ticket.reload')}</Button>
    {screen && !screen.items.length && <p>{t('coManaged.conversation.empty')}</p>}
    {screen?.items.map(item => <article key={item.commentId} className="space-y-1 border-t pt-2">
      <p className="text-sm font-medium">{item.authorName || t('coManaged.conversation.restrictedAuthor')}{item.organizationName ? ` · ${item.organizationName}` : ''}</p>
      <time className="text-xs" dateTime={item.createdAt}>{formatDate(item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>
      <p className="whitespace-pre-wrap break-words text-sm">{item.deleted ? t('coManaged.conversation.deleted') : conversationText(item.note, item.markdown)}</p>
      {item.attachments.length > 0 && <ul>{item.attachments.map(file => <li key={file.attachmentId}>
        <a className="text-sm underline" download href={`/api/client-portal/conversation-attachments/${encodeURIComponent(file.attachmentId)}?${new URLSearchParams({ ...target, threadId: item.threadId, commentId: item.commentId })}`}>{file.fileName}</a>
      </li>)}</ul>}
      {item.canReply && <Button id={`${id}-${item.commentId}-reply`} size="sm" variant="ghost" disabled={busy || Boolean(pending.current)}
        onClick={() => setParent({ threadId: item.threadId, commentId: item.commentId })}>{t('coManaged.conversation.reply')}</Button>}
    </article>)}
    {screen?.nextBefore && <Button id={`${id}-older`} size="sm" variant="ghost" disabled={busy} onClick={() => void load(screen.nextBefore)}>{t('coManaged.conversation.older')}</Button>}
    {screen?.canWrite && <form onSubmit={event => { event.preventDefault(); void send(); }} className="space-y-2">
      <label htmlFor={`${id}-message`}>{t(parent ? 'coManaged.conversation.reply' : 'coManaged.conversation.new')}</label>
      <textarea id={`${id}-message`} className="block w-full rounded border p-2" value={text} maxLength={100000} disabled={busy || Boolean(pending.current)} onChange={event => setText(event.target.value)} />
      {sendError && <p role="alert">{t('coManaged.conversation.unknownOutcome')}</p>}
      <Button id={`${id}-send`} type="submit" disabled={busy || !text.trim()}>{t('coManaged.conversation.send')}</Button>
      {parent && !pending.current && <Button id={`${id}-new`} variant="ghost" disabled={busy} onClick={() => setParent(undefined)}>{t('coManaged.conversation.new')}</Button>}
    </form>}
  </section>;
}
