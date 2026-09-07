'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { CoManagedSharedResource, CoManagedConversationCursor, CoManagedConversationItem, CoManagedCommentCreateRequest, CoManagedCommentMutationRequest, CoManagedPrivateCommentCommand } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import dynamic from 'next/dynamic';
import { snapshotConversationDocument, type CoManagedRichTextDocument } from '@alga-psa/co-managed/conversationRichText';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedTicketConversationScreenAction } from '@/lib/actions/coManagedTicketConversationActions';
import { createCoManagedTicketCommentAction } from '@/lib/actions/coManagedTicketCommentActions';
import { mutateCoManagedTicketCommentAction } from '@/lib/actions/coManagedTicketCommentMutationActions';
import { saveCoManagedPrivateTicketCommentAction } from '@/lib/actions/coManagedPrivateTicketCommentActions';
import { conversationText, conversationDocument } from './conversationText';

const Document = dynamic(() => import('./CoManagedConversationDocument'), { ssr: false });

type Screen = Awaited<ReturnType<typeof getCoManagedTicketConversationScreenAction>>;
type Audience = Screen['writeAudiences'][number];
type Draft = { kind: 'new' } | { kind: 'reply' | 'edit' | 'delete'; item: CoManagedConversationItem };
type Submission = { store: 'private'; request: CoManagedPrivateCommentCommand } | { store: 'create'; request: CoManagedCommentCreateRequest } | { store: 'mutate'; request: CoManagedCommentMutationRequest };
const reference = (item: CoManagedConversationItem) => ({ storeTenant: item.storeTenant, threadId: item.threadId, commentId: item.commentId });

function Composer({ resource, actor, audiences, draft, onSaved, onCancel }: {
  resource: CoManagedSharedResource; actor: Screen['actor']; audiences: Audience[]; draft: Draft; onSaved: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [audience, setAudience] = useState<Audience>(draft.kind === 'new' ? (audiences.includes('shared_it') ? 'shared_it' : audiences[0]) : draft.item.audience);
  const [document, setDocument] = useState<CoManagedRichTextDocument>(draft.kind === 'edit' ? conversationDocument(draft.item.note) ?? [] : []);
  const validDocument = useMemo(() => {
    try { return snapshotConversationDocument(document); } catch { return null; }
  }, [document]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const submission = useRef<Submission | null>(null), inFlight = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const permitted = audiences.includes(audience);
  const uncertain = error === 'unknownOutcome';
  const rejected = error && !['unknownOutcome', 'invalid'].includes(error);
  const frozen = busy || uncertain || Boolean(rejected) || !permitted;
  async function submit() {
    if (inFlight.current || rejected || !permitted || (draft.kind !== 'delete' && !validDocument)) return;
    if (!submission.current) {
      const operationId = crypto.randomUUID();
      const privateStore = draft.kind === 'new' ? actor.tenant !== resource.tenant && audience === 'organization_private' : draft.item.storeTenant !== resource.tenant;
      if (draft.kind === 'new' || draft.kind === 'reply') {
        const parent = draft.kind === 'reply' ? reference(draft.item) : undefined;
        submission.current = privateStore ? { store: 'private', request: { kind: 'create', operationId, document: validDocument!, ...(parent ? { parent } : {}) } }
          : { store: 'create', request: { operationId, document: validDocument!, ...(parent ? { parent } : { audience }) } };
      } else {
        const change = draft.kind === 'edit' ? { kind: 'edit' as const, document: validDocument! } : { kind: 'delete' as const };
        submission.current = privateStore ? { store: 'private', request: { ...change, operationId, comment: reference(draft.item), expectedRevision: draft.item.revision! } }
          : { store: 'mutate', request: { ...change, operationId, comment: reference(draft.item), expectedUpdatedAt: draft.item.updatedAt } };
      }
    }
    inFlight.current = true; setBusy(true); setError(null);
    const saved = submission.current;
    try {
      const result = saved.store === 'private' ? await saveCoManagedPrivateTicketCommentAction(resource, saved.request)
        : saved.store === 'create' ? await createCoManagedTicketCommentAction(resource, saved.request)
        : await mutateCoManagedTicketCommentAction(resource, saved.request);
      if (!mounted.current) return;
      if (result.ok) onSaved();
      else { setError(result.code); if (result.code === 'invalid') submission.current = null; }
    } catch { if (mounted.current) setError('unknownOutcome'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  return <form className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-semibold">{t(`coManaged.conversation.${draft.kind}`)}</h3>
    {draft.kind === 'new' ? <CustomSelect id="co-conversation-audience" label={t('coManaged.conversation.audience')} value={audience} disabled={frozen}
      options={audiences.map(value => ({ value, label: t(`coManaged.conversation.audiences.${value}`) }))} onValueChange={value => setAudience(value as Audience)} />
      : <p className="text-sm font-medium">{t(`coManaged.conversation.audiences.${audience}`)}</p>}
    <p className="text-sm text-muted-foreground">{t(`coManaged.conversation.audienceHelp.${audience}`)}</p>
    {draft.kind === 'delete' ? <p>{t('coManaged.conversation.deleteHelp')}</p> : <Document id="co-conversation-text" label={t('coManaged.conversation.message')} document={document}
      editable={!frozen} onChange={setDocument} />}
    {!permitted && <p role="status">{t('coManaged.ticket.readOnly')}</p>}
    {error && <p role="alert" className="text-destructive">{t(error === 'unknownOutcome' ? 'coManaged.conversation.unknownOutcome' : `coManaged.editor.errors.${error}`)}</p>}
    <div className="flex flex-wrap gap-2">
      <Button id="co-conversation-submit" type="submit" disabled={busy || Boolean(rejected) || !permitted || (draft.kind !== 'delete' && !validDocument)}>
        {t(busy ? 'coManaged.ticket.saving' : uncertain ? 'coManaged.ticket.retry' : `coManaged.conversation.${draft.kind === 'delete' ? 'delete' : 'send'}`)}</Button>
      <Button id="co-conversation-cancel" type="button" variant="outline" disabled={busy || uncertain} onClick={onCancel}>{t('coManaged.ticket.cancel')}</Button>
    </div>
  </form>;
}

export default function CoManagedTicketConversation({ resource }: { resource: CoManagedSharedResource }) {
  const { data: session } = useSession();
  const identity = `${resource.tenant}:${resource.relationshipId}:${resource.id}:${session?.user?.tenant}:${session?.user?.id}`;
  return <Conversation key={identity} resource={resource} homeTenant={session?.user?.tenant} userId={session?.user?.id} />;
}
function Conversation({ resource, homeTenant, userId }: { resource: CoManagedSharedResource; homeTenant?: string; userId?: string }) {
  const { t } = useTranslation('msp/licensing'), { formatDate } = useFormatters();
  const [state, setState] = useState<Screen | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null), [revision, setRevision] = useState(0);
  const target = useRef({ ...resource }), cursors = useRef<Array<CoManagedConversationCursor | undefined>>([undefined]);
  const generation = useRef(0), mounted = useRef(false), loading = useRef(false), queued = useRef(false);
  async function refresh() {
    if (!homeTenant || !userId) { setBusy(false); return; }
    if (loading.current) { queued.current = true; return; }
    const current = ++generation.current; loading.current = true; setBusy(true);
    try {
      const page = await getCoManagedTicketConversationScreenAction(target.current, cursors.current.at(-1));
      if (!mounted.current || current !== generation.current) return;
      if (page.actor.tenant !== homeTenant || page.actor.userId !== userId) throw new Error('Conversation session changed');
      setState(page); setError(false);
      setDraft(previous => previous && (previous.kind === 'new' ? !page.writeAudiences.length : !page.writeAudiences.includes(previous.item.audience)) ? null : previous);
    } catch { if (mounted.current && current === generation.current) { setState(null); setDraft(null); setError(true); } }
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
  const open = (next: Draft) => { setDraft(next); setRevision(value => value + 1); };
  return <section className="space-y-4" aria-labelledby="co-conversation-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="co-conversation-title" className="font-semibold">{t('coManaged.conversation.title')}</h2>
      <Button id="co-conversation-refresh" variant="outline" disabled={busy || Boolean(draft)} onClick={() => void refresh()}>{t('coManaged.ticket.reload')}</Button>
    </div>
    {state && !state.writeAudiences.length && <p role="status">{t('coManaged.ticket.readOnly')}</p>}
    {error && <p role="alert">{t('coManaged.conversation.loadError')}</p>}
    {!state && busy && <p role="status">{t('coManaged.ticket.loading')}</p>}
    {state && <>
      {state.writeAudiences.length > 0 && !draft && <Button id="co-conversation-new" onClick={() => open({ kind: 'new' })}>{t('coManaged.conversation.new')}</Button>}
      {draft && <Composer key={revision} draft={draft} resource={target.current} actor={state.actor} audiences={state.writeAudiences}
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
          {content ? <Document key={`${id}:${item.updatedAt}`} id={`${id}-body`} document={content} />
            : <p className="whitespace-pre-wrap break-words text-sm">{item.deleted ? t('coManaged.conversation.deleted') : conversationText(item.note, item.markdown)}</p>}
          {writable && !draft && <div className="flex flex-wrap gap-2">
            <Button id={`${id}-reply`} variant="ghost" size="sm" onClick={() => open({ kind: 'reply', item })}>{t('coManaged.conversation.reply')}</Button>
            {own && content !== null && <Button id={`${id}-edit`} variant="ghost" size="sm" onClick={() => open({ kind: 'edit', item })}>{t('coManaged.conversation.edit')}</Button>}
            {own && <Button id={`${id}-delete`} variant="ghost" size="sm" onClick={() => open({ kind: 'delete', item })}>{t('coManaged.conversation.delete')}</Button>}
          </div>}
        </li>;
      })}</ol>
      <div className="flex gap-2">
        {cursors.current.length > 1 && <Button id="co-conversation-newer" variant="outline" disabled={busy || Boolean(draft)} onClick={() => { cursors.current.pop(); void refresh(); }}>{t('coManaged.conversation.newer')}</Button>}
        {state.nextBefore && <Button id="co-conversation-older" variant="outline" disabled={busy || Boolean(draft)} onClick={() => { cursors.current.push(state.nextBefore!); void refresh(); }}>{t('coManaged.conversation.older')}</Button>}
      </div>
    </>}
  </section>;
}
