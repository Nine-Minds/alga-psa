'use client';

import type { TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { CoManagedSharedResource, CoManagedConversationCursor, CoManagedConversationItem, CoManagedCommentCreateRequest, CoManagedCommentMutationRequest, CoManagedPrivateCommentCommand } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import dynamic from 'next/dynamic';
import { snapshotConversationDocument, type CoManagedRichTextDocument } from '@alga-psa/co-managed/conversationRichText';
import { Input } from '@alga-psa/ui/components/Input';
import { prepareConversationDraft, submitConversationDraft, type PreparedConversationDraft, type ConversationDraftProgress } from './conversationDraftSubmission';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedTicketConversationScreenAction } from '@/lib/actions/coManagedTicketConversationActions';
import { abandonCoManagedConversationDraftAction } from '@/lib/actions/coManagedConversationDraftActions';
import { createCoManagedTicketCommentAction } from '@/lib/actions/coManagedTicketCommentActions';
import { mutateCoManagedTicketCommentAction } from '@/lib/actions/coManagedTicketCommentMutationActions';
import { saveCoManagedPrivateTicketCommentAction } from '@/lib/actions/coManagedPrivateTicketCommentActions';
import CoManagedThreadDisclosure from './CoManagedThreadDisclosure';
import CoManagedCommentAttachments from './CoManagedCommentAttachments';
import { ConversationEmailEnvelope } from '@alga-psa/tickets/components/ticket/conversations/ConversationEmailEnvelope';
import { ConversationReadAcknowledgment } from '@alga-psa/tickets/components/ticket/conversations/ConversationReadAcknowledgment';
import { conversationText, conversationDocument } from './conversationText';

const Document = dynamic(() => import('./CoManagedConversationDocument'), { ssr: false });

type Screen = Awaited<ReturnType<typeof getCoManagedTicketConversationScreenAction>>;
type Audience = Screen['writeAudiences'][number];
type Draft = { kind: 'new' } | { kind: 'reply' | 'edit' | 'delete'; item: CoManagedConversationItem };
type Submission = { store: 'draft'; prepared: PreparedConversationDraft } | { store: 'private'; request: CoManagedPrivateCommentCommand } | { store: 'create'; request: CoManagedCommentCreateRequest } | { store: 'mutate'; request: CoManagedCommentMutationRequest };
const reference = (item: CoManagedConversationItem) => ({ storeTenant: item.storeTenant, threadId: item.threadId, commentId: item.commentId });

// LEVERAGE: pattern qualified-conversation-composer — rich-text audience/retry controls recur, while ticket attachment/disclosure and task revision commands differ.
function Composer({ resource, actor, audiences, draftAttachments, draft, onSaved, onCancel }: {
  resource: CoManagedSharedResource; actor: Screen['actor']; audiences: Audience[]; draftAttachments: Screen['draftAttachments']; draft: Draft; onSaved: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation('msp/licensing'), { formatNumber } = useFormatters();
  const [audience, setAudience] = useState<Audience>(draft.kind === 'new' ? (audiences.includes('shared_it') ? 'shared_it' : audiences[0]) : draft.item.audience);
  const [document, setDocument] = useState<CoManagedRichTextDocument>(draft.kind === 'edit' ? conversationDocument(draft.item.note) ?? [] : []);
  const validDocument = useMemo(() => {
    try { return snapshotConversationDocument(document); } catch { return null; }
  }, [document]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<Array<{ key: string; file: File }>>([]);
  const [progress, setProgress] = useState<ConversationDraftProgress | null>(null);
  const cancellation = useRef(false);
  const submission = useRef<Submission | null>(null), inFlight = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const permitted = audiences.includes(audience);
  const canAttach = (draft.kind === 'new' || draft.kind === 'reply') && draftAttachments.audiences.includes(audience);
  const filesInvalid = files.length > draftAttachments.maxFiles || files.some(({ file }) => file.size > draftAttachments.maxBytes);
  const uncertain = error === 'unknownOutcome' || error === 'cancelUnknownOutcome', retryable = uncertain || error === 'notReady';
  const rejected = error && !['unknownOutcome', 'cancelUnknownOutcome', 'notReady', 'invalid', 'abandoned', 'preparationFailed'].includes(error);
  const frozen = busy || retryable || Boolean(rejected) || !permitted;
  const allowed = useRef(false);
  allowed.current = permitted && (!files.length || canAttach);
  const current = () => mounted.current && allowed.current;
  useEffect(() => {
    // Drop the whole message when attachment permission disappears, including during upload.
    // Never turn an interrupted attachment submission into a second, text-only message.
    if (files.length && !canAttach) onCancel();
  }, [canAttach, files.length, onCancel]);
  async function cancel() {
    if (inFlight.current) return;
    const saved = submission.current;
    if (saved?.store !== 'draft') { onCancel(); return; }
    inFlight.current = true; cancellation.current = true; setBusy(true); setError(null);
    try {
      const outcome = await abandonCoManagedConversationDraftAction(saved.prepared.resource,
        { storeTenant: saved.prepared.storeTenant, operationId: saved.prepared.request.operationId });
      if (!mounted.current) return;
      if (outcome.ok) { if (outcome.result.status === 'published') onSaved(); else onCancel(); }
      else if (outcome.code === 'unknownOutcome') setError('cancelUnknownOutcome');
      else onCancel();
    } catch { if (mounted.current) setError('cancelUnknownOutcome'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function submit() {
    if (cancellation.current) { await cancel(); return; }
    if (inFlight.current || rejected || !allowed.current || filesInvalid || (draft.kind !== 'delete' && !validDocument)) return;
    inFlight.current = true; setBusy(true); setError(null);
    let dispatched = false;
    try {
      if (!submission.current) {
        const operationId = crypto.randomUUID();
        const privateStore = draft.kind === 'new' ? actor.tenant !== resource.tenant && audience === 'organization_private' : draft.item.storeTenant !== resource.tenant;
        if (draft.kind === 'new' || draft.kind === 'reply') {
          const parent = draft.kind === 'reply' ? reference(draft.item) : undefined;
          if (files.length) {
            setProgress({ phase: 'preparing', completed: 0, total: files.length });
            const prepared = await prepareConversationDraft({ resource, actorTenant: actor.tenant, operationId, document: validDocument!, audience, parent, files: files.map(item => item.file) });
            if (!current()) return;
            submission.current = { store: 'draft', prepared };
          } else {
            submission.current = privateStore ? { store: 'private', request: { kind: 'create', operationId, document: validDocument!, ...(parent ? { parent } : {}) } }
              : { store: 'create', request: { operationId, document: validDocument!, ...(parent ? { parent, expectedAudience: audience } : { audience }) } };
          }
        } else {
          const change = draft.kind === 'edit' ? { kind: 'edit' as const, document: validDocument! } : { kind: 'delete' as const };
          submission.current = privateStore ? { store: 'private', request: { ...change, operationId, comment: reference(draft.item), expectedRevision: draft.item.revision! } }
            : { store: 'mutate', request: { ...change, operationId, comment: reference(draft.item), expectedUpdatedAt: draft.item.updatedAt } };
        }
      }
      if (!current()) return;
      const saved = submission.current; dispatched = true;
      const result = saved.store === 'draft' ? await submitConversationDraft(saved.prepared, current, value => { if (current()) setProgress(value); })
        : saved.store === 'private' ? await saveCoManagedPrivateTicketCommentAction(resource, saved.request)
        : saved.store === 'create' ? await createCoManagedTicketCommentAction(resource, saved.request)
        : await mutateCoManagedTicketCommentAction(resource, saved.request);
      if (!current()) return;
      if (result.ok) onSaved();
      else if (saved.store === 'draft' && ['forbidden', 'readOnly'].includes(result.code)) onCancel();
      else if (result.code !== 'aborted') { setError(result.code); if (result.code === 'invalid' || result.code === 'abandoned') submission.current = null; }
    } catch { if (current()) setError(dispatched ? 'unknownOutcome' : 'preparationFailed'); }
    finally { inFlight.current = false; if (mounted.current) { setBusy(false); setProgress(null); } }
  }
  return <form className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-semibold">{t(`coManaged.conversation.${draft.kind}`)}</h3>
    {draft.kind === 'new' ? <CustomSelect id="co-conversation-audience" label={t('coManaged.conversation.audience')} value={audience} disabled={frozen}
      options={audiences.map(value => ({ value, label: t(`coManaged.conversation.audiences.${value}`) }))} onValueChange={value => setAudience(value as Audience)} />
      : <p className="text-sm font-medium">{t(`coManaged.conversation.audiences.${audience}`)}</p>}
    <p className="text-sm text-muted-foreground">{t(`coManaged.conversation.audienceHelp.${audience}`)}</p>
    {draft.kind === 'delete' ? <p>{t('coManaged.conversation.deleteHelp')}</p> : <Document id="co-conversation-text" label={t('coManaged.conversation.message')} document={document}
      editable={!frozen} onChange={setDocument} />}
    {canAttach && <div className="space-y-2">
      <Input id="co-conversation-files" type="file" multiple preserveCursor={false} label={t('coManaged.conversation.files.choose')} disabled={frozen}
        aria-describedby="co-conversation-files-help" onChange={event => {
          if (frozen) return;
          const selected = Array.from(event.target.files ?? []).map(file => ({ key: crypto.randomUUID(), file }));
          setFiles(previous => [...previous, ...selected]); event.target.value = ''; setError(null); submission.current = null;
        }} />
      <p id="co-conversation-files-help" className="text-xs text-muted-foreground">{t('coManaged.conversation.files.help', {
        count: draftAttachments.maxFiles, size: formatNumber(draftAttachments.maxBytes / 1048576, { maximumFractionDigits: 2 }) })}</p>
      {files.length > 0 && <ul className="space-y-1">{files.map(({ key, file }, index) => <li key={key} className="flex items-center justify-between gap-2 text-sm">
        <span className="break-all">{file.name}</span>
        <Button id={`co-conversation-file-${index}-remove`} type="button" size="sm" variant="ghost" disabled={frozen}
          aria-label={t('coManaged.conversation.files.removeNamed', { name: file.name })} onClick={() => {
            setFiles(previous => previous.filter(item => item.key !== key)); setError(null); submission.current = null;
          }}>{t('coManaged.conversation.files.remove')}</Button>
      </li>)}</ul>}
      {filesInvalid && <p role="alert" className="text-destructive">{t('coManaged.conversation.files.invalid')}</p>}
    </div>}
    {progress && <p role="status">{t(`coManaged.conversation.files.${progress.phase}`, { completed: progress.completed, total: progress.total })}</p>}
    {!permitted && <p role="status">{t('coManaged.ticket.readOnly')}</p>}
    {error && <p role="alert" className="text-destructive">{t(error === 'unknownOutcome' ? 'coManaged.conversation.unknownOutcome' : ['notReady', 'abandoned', 'cancelUnknownOutcome', 'preparationFailed'].includes(error) ? `coManaged.conversation.files.${error}` : `coManaged.editor.errors.${error}`)}</p>}
    <div className="flex flex-wrap gap-2">
      <Button id="co-conversation-submit" type="submit" disabled={busy || Boolean(rejected) || !allowed.current || filesInvalid || (draft.kind !== 'delete' && !validDocument)}>
        {t(busy ? (cancellation.current ? 'coManaged.conversation.files.canceling' : 'coManaged.ticket.saving') : retryable ? 'coManaged.ticket.retry' : `coManaged.conversation.${draft.kind === 'delete' ? 'delete' : 'send'}`)}</Button>
      <Button id="co-conversation-cancel" type="button" variant="outline" disabled={busy || uncertain} onClick={() => void cancel()}>{t('coManaged.ticket.cancel')}</Button>
    </div>
  </form>;
}

export interface CoManagedConversationComposition {
  ready: boolean;
  refreshVersion: number;
  beforeEdit: () => Promise<boolean>;
  reply: (parent: { threadId: string; commentId: string }) => Promise<boolean>;
  onRead?: () => void;
}
export default function CoManagedTicketConversation({ resource, requester, onDraftState, composition }: { resource: CoManagedSharedResource; requester?: TicketConversationReference; onDraftState?: (active: boolean) => void; composition?: CoManagedConversationComposition }) {
  const { data: session } = useSession();
  const identity = `${session?.session_id}:${resource.tenant}:${resource.relationshipId}:${resource.id}:${session?.user?.tenant}:${session?.user?.id}:${requester?.storeTenant}:${requester?.conversationId}`;
  return <Conversation key={identity} resource={resource} requester={requester} onDraftState={onDraftState} composition={composition} homeTenant={session?.user?.tenant} userId={session?.user?.id} />;
}
function Conversation({ resource, homeTenant, userId, requester, onDraftState, composition }: { resource: CoManagedSharedResource; homeTenant?: string; userId?: string; requester?: TicketConversationReference; onDraftState?: (active: boolean) => void; composition?: CoManagedConversationComposition }) {
  const { t } = useTranslation('msp/licensing'), { formatDate } = useFormatters();
  const [state, setState] = useState<Screen | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(true);
  const [disclosure, setDisclosure] = useState<CoManagedConversationItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), [revision, setRevision] = useState(0);
  useEffect(() => { onDraftState?.(Boolean(draft || disclosure)); return () => onDraftState?.(false); }, [draft, disclosure, onDraftState]);
  const target = useRef({ ...resource }), cursors = useRef<Array<CoManagedConversationCursor | undefined>>([undefined]);
  const generation = useRef(0), mounted = useRef(false), loading = useRef(false), queued = useRef(false);
  async function refresh() {
    if (!homeTenant || !userId) { setBusy(false); return; }
    if (loading.current) { queued.current = true; return; }
    const current = ++generation.current; loading.current = true; setBusy(true);
    try {
      const page = requester ? await getCoManagedTicketConversationScreenAction(target.current, cursors.current.at(-1), requester)
        : await getCoManagedTicketConversationScreenAction(target.current, cursors.current.at(-1));
      if (!mounted.current || current !== generation.current) return;
      if (page.actor.tenant !== homeTenant || page.actor.userId !== userId) throw new Error('Conversation session changed');
      setState(page); setError(false);
      setDisclosure(previous => previous && !page.writeAudiences.includes(previous.audience) ? null : previous);
      setDraft(previous => previous && (previous.kind === 'new' ? !page.writeAudiences.length : !page.writeAudiences.includes(previous.item.audience)) ? null : previous);
    } catch { if (mounted.current && current === generation.current) { setState(null); setDraft(null); setDisclosure(null); setError(true); } }
    finally { if (mounted.current && current === generation.current) {
      loading.current = false; setBusy(false);
      if (queued.current) { queued.current = false; void refresh(); }
    } }
  }
  useEffect(() => {
    mounted.current = true; void refresh();
    const timer = setInterval(() => { void refresh(); }, 30000);
    return () => { mounted.current = false; generation.current++; loading.current = false; queued.current = false; clearInterval(timer); };
  }, [homeTenant, userId]);
  useEffect(() => {
    if (composition?.refreshVersion) { cursors.current = [undefined]; void refresh(); }
  }, [composition?.refreshVersion]);
  const open = (next: Draft) => { setDraft(next); setRevision(value => value + 1); };
  const edit = async (next: Draft) => {
    if (composition && (!composition.ready || !await composition.beforeEdit())) return;
    if (mounted.current) open(next);
  };
  return <section className="space-y-4" aria-labelledby="co-conversation-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="co-conversation-title" className="font-semibold">{t('coManaged.conversation.title')}</h2>
      <Button id="co-conversation-refresh" variant="outline" disabled={busy || Boolean(draft || disclosure)} onClick={() => void refresh()}>{t('coManaged.ticket.reload')}</Button>
    </div>
    {state && !state.writeAudiences.length && <p role="status">{t('coManaged.ticket.readOnly')}</p>}
    {error && <p role="alert">{t('coManaged.conversation.loadError')}</p>}
    {!state && busy && <p role="status">{t('coManaged.ticket.loading')}</p>}
    {state && <>
      {requester && !busy && !error && <ConversationReadAcknowledgment id="co-conversation" ticket={{ tenant: resource.tenant, ticketId: resource.id, relationshipId: resource.relationshipId }}
        conversation={requester} messages={state.items.filter(item => !item.deleted)} onChanged={composition?.onRead} />}
      {state.writeAudiences.length > 0 && !composition && !draft && !disclosure && <Button id="co-conversation-new" onClick={() => open({ kind: 'new' })}>{t('coManaged.conversation.new')}</Button>}
      {disclosure && <CoManagedThreadDisclosure resource={target.current} thread={{ storeTenant: disclosure.storeTenant, threadId: disclosure.threadId }} actor={state.actor}
        audiences={state.actor.tenant === resource.tenant ? state.writeAudiences : state.writeAudiences.filter(value => value !== 'organization_private')}
        onClosed={() => { setDisclosure(null); void refresh(); }} onSaved={() => { setDisclosure(null); void refresh(); }} />}
      {draft && <Composer key={revision} draft={draft} resource={target.current} actor={state.actor} audiences={state.writeAudiences} draftAttachments={state.draftAttachments ?? { audiences: [], maxBytes: 0, maxFiles: 0 }}
        onSaved={() => { setDraft(null); cursors.current = [undefined]; void refresh(); }} onCancel={() => { setDraft(null); void refresh(); }} />}
      {!state.items.length && <p className="text-sm text-muted-foreground">{t('coManaged.conversation.empty')}</p>}
      <ol className="space-y-3">{state.items.map(item => {
        const id = `co-comment-${item.storeTenant}-${item.commentId}`;
        const content = item.deleted ? null : conversationDocument(item.note);
        const own = item.author?.kind === 'user' && item.author.tenant === state.actor.tenant && item.author.id === state.actor.userId;
        const writable = state.writeAudiences.includes(item.audience) && !item.deleted && (item.storeTenant === resource.tenant || item.revision !== null);
        return <li id={id} key={id} className="space-y-2 rounded-lg border border-[rgb(var(--color-border-200))] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{item.author?.displayName || t('coManaged.conversation.restrictedAuthor')}{item.author?.organizationName && <span className="font-normal text-muted-foreground"> · {item.author.organizationName}</span>}</p>
            <span className="rounded-md border px-2 py-0.5 text-xs font-medium">{t(`coManaged.conversation.audiences.${item.audience}`)}</span>
          </div>
          <p className="text-xs text-muted-foreground"><time dateTime={item.createdAt}>{formatDate(new Date(item.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</time>
            {item.parentCommentId && <span> · {t('coManaged.conversation.reply')}</span>}</p>
          {!item.deleted && item.email && <ConversationEmailEnvelope email={item.email} />}
          {content ? <Document key={`${id}:${item.updatedAt}`} id={`${id}-body`} document={content} />
            : <p className="whitespace-pre-wrap break-words text-sm">{item.deleted ? t('coManaged.conversation.deleted') : conversationText(item.note, item.markdown)}</p>}
          {!item.deleted && <CoManagedCommentAttachments resource={target.current} comment={reference(item)} conversation={requester} />}
          {writable && !draft && !disclosure && <div className="flex flex-wrap gap-2">
            <Button id={`${id}-reply`} variant="ghost" size="sm" disabled={composition && !composition.ready}
              onClick={() => composition ? void composition.reply({ threadId: item.threadId, commentId: item.commentId }) : open({ kind: 'reply', item })}>{t('coManaged.conversation.reply')}</Button>
            {own && content !== null && <Button id={`${id}-edit`} variant="ghost" size="sm" disabled={composition && !composition.ready} onClick={() => void edit({ kind: 'edit', item })}>{t('coManaged.conversation.edit')}</Button>}
            {own && !requester && !item.parentCommentId && <Button id={`${id}-audience`} variant="ghost" size="sm" onClick={() => setDisclosure(item)}>{t('coManaged.disclosure.title')}</Button>}
            {own && <Button id={`${id}-delete`} variant="ghost" size="sm" disabled={composition && !composition.ready} onClick={() => void edit({ kind: 'delete', item })}>{t('coManaged.conversation.delete')}</Button>}
          </div>}
        </li>;
      })}</ol>
      <div className="flex gap-2">
        {cursors.current.length > 1 && <Button id="co-conversation-newer" variant="outline" disabled={busy || Boolean(draft || disclosure)} onClick={() => { cursors.current.pop(); void refresh(); }}>{t('coManaged.conversation.newer')}</Button>}
        {state.nextBefore && <Button id="co-conversation-older" variant="outline" disabled={busy || Boolean(draft || disclosure)} onClick={() => { cursors.current.push(state.nextBefore!); void refresh(); }}>{t('coManaged.conversation.older')}</Button>}
      </div>
    </>}
  </section>;
}
