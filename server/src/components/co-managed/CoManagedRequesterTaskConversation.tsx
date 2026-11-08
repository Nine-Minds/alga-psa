'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { isClientUserType } from '@alga-psa/types';
import { RequesterTaskConversationProvider, type RequesterTaskConversationProps } from '@alga-psa/client-portal/components';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { getRequesterTaskConversationAction, createRequesterTaskCommentAction, getRequesterSharedTaskIdsAction } from '@/lib/actions/coManagedRequesterTaskActions';
import { conversationText } from './conversationText';
import { newCoManagedOperationId } from './coManagedOperationId';

type Screen = Awaited<ReturnType<typeof getRequesterTaskConversationAction>>;
type Request = Parameters<typeof createRequesterTaskCommentAction>[1];
// The gate lives in the package's RequesterTaskConversation wrapper: useCapability('co-managed') SERVES plus the
// server's shared-work answer; the server actions re-check both on every call.
export function CoManagedRequesterTaskProvider({ children }: { children: ReactNode }) {
  return <RequesterTaskConversationProvider component={Conversation} loadSharedTaskIds={getRequesterSharedTaskIdsAction}>{children}</RequesterTaskConversationProvider>;
}
// Only a signed-in client contact with a full session identity sees requester task threads.
function signedInClient(session: ReturnType<typeof useSession>['data']) {
  const user = session?.user;
  if (!session?.session_id || !user || !isClientUserType(user.user_type) || !user.tenant || !user.id) return null;
  return { sessionId: session.session_id, tenant: user.tenant, userId: user.id };
}

function Conversation(props: RequesterTaskConversationProps) {
  const { data: session } = useSession();
  const client = signedInClient(session);
  const signedIn = client !== null;
  const { t } = useTranslation('msp/licensing');
  const [open, setOpen] = useState(false);
  const taskLinkHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    const target = `${props.projectId}:${props.taskId}`;
    if (taskLinkHandled.current === target) return;
    taskLinkHandled.current = target;
    if (new URLSearchParams(window.location.search).get('taskId') === props.taskId) setOpen(true);
  }, [props.projectId, props.taskId, signedIn]);
  if (!client) return null;
  const identity = `${client.sessionId}:${client.tenant}:${client.userId}:${props.projectId}:${props.taskId}`;
  return <>
    <Button id={`requester-task-${props.taskId}-conversation`} size="sm" variant="ghost" onClick={() => setOpen(true)}>{t('coManaged.conversation.title', { defaultValue: 'Conversation' })}</Button>
    <Dialog id={`requester-task-${props.taskId}-dialog`} isOpen={open} onClose={() => setOpen(false)} title={t('coManaged.conversation.title', { defaultValue: 'Conversation' })} className="max-w-2xl">
      {open && <Messages key={identity} {...props} tenant={client.tenant} userId={client.userId} />}
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
    const request = pending.current ?? { operationId: newCoManagedOperationId(), text, ...(parent ? { parent } : {}) };
    pending.current = request;
    try {
      await createRequesterTaskCommentAction(target, request);
      if (!mounted.current) return;
      pending.current = null; setText(''); setParent(undefined); await load(null);
    } catch { if (mounted.current) { setSendError(true); await load(); } }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="my-3 space-y-3 rounded border p-3" aria-label={t('coManaged.conversation.title', { defaultValue: 'Conversation' })}>
    <p className="text-sm">{t('coManaged.conversation.audienceHelp.requester', { defaultValue: 'Messages here are visible to you and your IT provider. Internal notes are never shown.' })}</p>
    {loadError && <p role="alert">{t('coManaged.conversation.loadError', { defaultValue: 'The conversation could not be loaded.' })}</p>}
    <Button id={`${id}-refresh`} size="sm" variant="ghost" disabled={busy} onClick={() => void load(null)}>{t('coManaged.conversation.reload', { defaultValue: 'Reload' })}</Button>
    {screen && !screen.items.length && <p>{t('coManaged.conversation.empty', { defaultValue: 'No comments yet.' })}</p>}
    {screen?.items.map(item => <article key={item.commentId} className="space-y-1 border-t pt-2">
      <p className="text-sm font-medium">{item.authorName || t('coManaged.conversation.restrictedAuthor', { defaultValue: 'Author hidden' })}{item.organizationName ? ` · ${item.organizationName}` : ''}</p>
      <time className="text-xs" dateTime={item.createdAt}>{formatDate(item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>
      <p className="whitespace-pre-wrap break-words text-sm">{item.deleted ? t('coManaged.conversation.deleted', { defaultValue: 'This comment was deleted.' }) : conversationText(item.note, item.markdown)}</p>
      {item.canReply && <Button id={`${id}-${item.commentId}-reply`} size="sm" variant="ghost" disabled={busy || Boolean(pending.current)}
        onClick={() => setParent({ threadId: item.threadId, commentId: item.commentId })}>{t('coManaged.conversation.reply', { defaultValue: 'Reply' })}</Button>}
    </article>)}
    {screen?.nextBefore && <Button id={`${id}-older`} size="sm" variant="ghost" disabled={busy} onClick={() => void load(screen.nextBefore)}>{t('coManaged.conversation.older', { defaultValue: 'Older' })}</Button>}
    {screen?.canWrite && <form onSubmit={event => { event.preventDefault(); void send(); }} className="space-y-2">
      <p className="text-sm font-medium">{parent ? t('coManaged.conversation.reply', { defaultValue: 'Reply' }) : t('coManaged.conversation.new', { defaultValue: 'New comment' })}</p>
      <TextArea id={`${id}-message`} value={text} maxLength={100000} disabled={busy || Boolean(pending.current)} onChange={event => setText(event.target.value)} />
      {sendError && <p role="alert">{t('coManaged.conversation.unknownOutcome', { defaultValue: 'We could not confirm the save. Try again; it will not be applied twice.' })}</p>}
      <Button id={`${id}-send`} type="submit" disabled={busy || !text.trim()}>{t('coManaged.conversation.send', { defaultValue: 'Send' })}</Button>
      {parent && !pending.current && <Button id={`${id}-new`} variant="ghost" disabled={busy} onClick={() => setParent(undefined)}>{t('coManaged.conversation.new', { defaultValue: 'New comment' })}</Button>}
    </form>}
  </section>;
}
