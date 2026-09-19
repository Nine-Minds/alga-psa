'use client';

import CoManagedCommentAttachments from './CoManagedCommentAttachments';
import CoManagedThreadDisclosure from './CoManagedThreadDisclosure';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import type { CoManagedSharedResource, CoManagedConversationCursor, CoManagedTaskConversationItem, CoManagedTaskCommentCommand } from '@alga-psa/co-managed';
import { snapshotConversationDocument, type CoManagedRichTextDocument } from '@alga-psa/co-managed/conversationRichText';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { getSharedProjectTaskConversationAction, saveSharedProjectTaskCommentAction } from '@/lib/actions/coManagedProjectTaskConversationActions';
import { conversationDocument, conversationText } from './conversationText';

const Document = dynamic(() => import('./CoManagedConversationDocument'), { ssr: false });
type Screen = Awaited<ReturnType<typeof getSharedProjectTaskConversationAction>>;
type Audience = Screen['writeAudiences'][number];
type Draft = { kind: 'new' } | { kind: 'reply' | 'edit' | 'delete'; item: CoManagedTaskConversationItem };
const reference = (item: CoManagedTaskConversationItem) => ({ storeTenant: item.storeTenant, threadId: item.threadId, commentId: item.commentId });

// LEVERAGE: pattern qualified-conversation-composer — rich-text audience/retry controls recur, while ticket attachment/disclosure and task revision commands differ.
function Composer({ resource, audiences, draft, onSaved, onCancel, onUnavailable }: {
  resource: CoManagedSharedResource; audiences: Audience[]; draft: Draft; onSaved: () => void; onCancel: () => void; onUnavailable: () => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [audience, setAudience] = useState<Audience>(draft.kind === 'new' ? (audiences.includes('shared_it') ? 'shared_it' : audiences[0]) : draft.item.audience);
  const [document, setDocument] = useState<CoManagedRichTextDocument>(draft.kind === 'edit' ? conversationDocument(draft.item.note) ?? [] : []);
  const validated = useMemo(() => { try { return snapshotConversationDocument(document); } catch { return null; } }, [document]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const saved = useRef<CoManagedTaskCommentCommand | null>(null), inFlight = useRef(false), mounted = useRef(false);
  const allowed = audiences.includes(audience), allowedRef = useRef(allowed); allowedRef.current = allowed;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!allowed) onCancel(); }, [allowed, onCancel]);
  const conflict = error === 'conflict' || error === 'operationConflict', frozen = busy || saved.current !== null || conflict;
  async function submit() {
    if (inFlight.current || !allowedRef.current || conflict || (draft.kind !== 'delete' && !validated)) return;
    inFlight.current = true; setBusy(true); setError(null);
    if (!saved.current) {
      const operationId = crypto.randomUUID();
      saved.current = draft.kind === 'new' ? { kind: 'create', operationId, audience, document: validated! }
        : draft.kind === 'reply' ? { kind: 'create', operationId, parent: reference(draft.item), expectedAudience: audience, document: validated! }
        : draft.kind === 'edit' ? { kind: 'edit', operationId, comment: reference(draft.item), expectedRevision: draft.item.revision!, document: validated! }
        : { kind: 'delete', operationId, comment: reference(draft.item), expectedRevision: draft.item.revision! };
    }
    try {
      const result = await saveSharedProjectTaskCommentAction(resource, saved.current);
      if (!mounted.current || !allowedRef.current) return;
      if (result.ok) onSaved();
      else if (result.code === 'forbidden' || result.code === 'readOnly') onUnavailable();
      else { setError(result.code); if (result.code === 'invalid') saved.current = null; }
    } catch { if (mounted.current && allowedRef.current) setError('unknownOutcome'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  return <form aria-busy={busy} className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-semibold">{t(`coManaged.conversation.${draft.kind}`)}</h3>
    {draft.kind === 'new' ? <CustomSelect id="co-task-conversation-audience" label={t('coManaged.conversation.audience')} value={audience} disabled={frozen}
      options={audiences.map(value => ({ value, label: t(`coManaged.conversation.audiences.${value}`) }))} onValueChange={value => setAudience(value as Audience)} />
      : <p className="text-sm font-medium">{t(`coManaged.conversation.audiences.${audience}`)}</p>}
    <p className="text-sm text-muted-foreground">{t(`coManaged.conversation.audienceHelp.${audience}`)}</p>
    {draft.kind === 'delete' ? <p>{t('coManaged.conversation.deleteHelp')}</p> : <Document id="co-task-conversation-message" label={t('coManaged.conversation.message')} document={document} editable={!frozen} onChange={setDocument} />}
    {error && <p role="alert" className="text-destructive">{t(error === 'unknownOutcome' ? 'coManaged.conversation.unknownOutcome' : `coManaged.projects.errors.${error}`)}</p>}
    <div className="flex gap-2">
      <Button id="co-task-conversation-submit" type="submit" disabled={busy || conflict || !allowed || (draft.kind !== 'delete' && !validated)}>{t(error === 'unknownOutcome' ? 'coManaged.policy.retry' : draft.kind === 'delete' ? 'coManaged.conversation.delete' : 'coManaged.conversation.send')}</Button>
      <Button id="co-task-conversation-cancel" type="button" variant="outline" disabled={busy} onClick={onCancel}>{t('coManaged.ticket.cancel')}</Button>
    </div>
  </form>;
}

export default function CoManagedProjectTaskConversation({ resource, onUnavailable }: { resource: CoManagedSharedResource; onUnavailable: () => void }) {
  const { data: session } = useSession(), tenant = session?.user?.tenant, userId = session?.user?.id;
  if (!tenant || !userId) return null;
  return <Conversation key={JSON.stringify([resource, tenant, userId])} resource={resource} actor={{ tenant, userId }} onUnavailable={onUnavailable} />;
}
function Conversation({ resource, actor, onUnavailable }: { resource: CoManagedSharedResource; actor: Screen['actor']; onUnavailable: () => void }) {
  const { t } = useTranslation('msp/licensing'), { formatDate } = useFormatters();
  const [state, setState] = useState<Screen | null>(null), [draft, setDraft] = useState<Draft | null>(null), [draftId, setDraftId] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [disclosure,setDisclosure] = useState<CoManagedTaskConversationItem | null>(null);
  const cursors = useRef<Array<CoManagedConversationCursor | undefined>>([undefined]);
  const generation = useRef(0), mounted = useRef(false), loading = useRef(false);
  function unavailable() { setState(null); setDraft(null); setDisclosure(null); setError(true); onUnavailable(); }
  async function refresh(clear = false) {
    const current = ++generation.current; loading.current = true; setBusy(true);
    if (clear) { setState(null); setDraft(null); setDisclosure(null); }
    try {
      const page = await getSharedProjectTaskConversationAction(resource, cursors.current.at(-1));
      if (!mounted.current || current !== generation.current) return;
      if (page.actor.tenant !== actor.tenant || page.actor.userId !== actor.userId) throw new Error('Task conversation session changed');
      setState(page); setError(false);
      setDisclosure(previous => previous && page.items.some(item => item.storeTenant === previous.storeTenant && item.commentId === previous.commentId && !item.deleted && item.audience === previous.audience && page.writeAudiences.includes(item.audience)) ? previous : null);
      setDraft(previous => {
        if (!previous) return null;
        if (previous.kind === 'new') return page.writeAudiences.length ? previous : null;
        const item = page.items.find(row => row.storeTenant === previous.item.storeTenant && row.commentId === previous.item.commentId);
        return item && !item.deleted && item.revision === previous.item.revision && item.audience === previous.item.audience && page.writeAudiences.includes(item.audience)
          && (previous.kind !== 'reply' || item.canReply) ? previous : null;
      });
    } catch { if (mounted.current && current === generation.current) unavailable(); }
    finally { if (mounted.current && current === generation.current) { loading.current = false; setBusy(false); } }
  }
  useEffect(() => {
    mounted.current = true; void refresh();
    const timer = setInterval(() => { if (!loading.current) void refresh(); }, 30000);
    return () => { mounted.current = false; generation.current++; clearInterval(timer); };
  }, []);
  const open = (value: Draft) => { setDraft(value); setDraftId(id => id + 1); };
  return <section className="space-y-4" aria-labelledby="co-task-conversation-title">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="co-task-conversation-title" className="font-semibold">{t('coManaged.conversation.title')}</h2>
      <Button id="co-task-conversation-refresh" variant="outline" disabled={busy || Boolean(draft || disclosure)} onClick={() => void refresh(true)}>{t('coManaged.ticket.reload')}</Button></div>
    {error && <p role="alert" className="text-destructive">{t('coManaged.conversation.loadError')}</p>}
    {!state && busy && <p role="status">{t('coManaged.ticket.loading')}</p>}
    {state && <>
      {!state.writeAudiences.length && <p role="status">{t('coManaged.ticket.readOnly')}</p>}
      {state.writeAudiences.length > 0 && !draft && !disclosure && <Button id="co-task-conversation-new" onClick={() => open({ kind: 'new' })}>{t('coManaged.conversation.new')}</Button>}
      {disclosure && <CoManagedThreadDisclosure resource={resource} thread={{ storeTenant:disclosure.storeTenant,threadId:disclosure.threadId }} actor={state.actor}
        audiences={state.writeAudiences.filter(value => actor.tenant === resource.tenant || value !== 'organization_private')}
        onClosed={() => { setDisclosure(null); void refresh(true); }} onSaved={() => { setDisclosure(null); cursors.current=[undefined]; void refresh(true); }} />}
      {draft && <Composer key={draftId} resource={resource} audiences={state.writeAudiences} draft={draft} onUnavailable={unavailable}
        onSaved={() => { setDraft(null); cursors.current = [undefined]; void refresh(true); }} onCancel={() => { setDraft(null); void refresh(true); }} />}
      {!state.items.length && <p className="text-sm text-muted-foreground">{t('coManaged.conversation.empty')}</p>}
      <ol className="space-y-3">{state.items.map(item => {
        const id = `co-task-comment-${item.storeTenant}-${item.commentId}`, document = item.deleted ? null : conversationDocument(item.note);
        const own = item.author?.kind === 'user' && item.author.tenant === actor.tenant && item.author.id === actor.userId;
        const writable = !item.deleted && item.revision !== null && state.writeAudiences.includes(item.audience);
        return <li key={id} id={id} className="space-y-2 rounded-lg border border-[rgb(var(--color-border-200))] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm font-medium">{item.author?.displayName || t('coManaged.conversation.restrictedAuthor')}
            {item.author?.organizationName && <span className="font-normal text-muted-foreground"> · {item.author.organizationName}</span>}</p>
            <span className="rounded-md border px-2 py-0.5 text-xs font-medium">{t(`coManaged.conversation.audiences.${item.audience}`)}</span></div>
          <p className="text-xs text-muted-foreground"><time dateTime={item.createdAt}>{formatDate(new Date(item.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</time>
            {item.parentCommentId && <span> · {t('coManaged.conversation.reply')}</span>}</p>
          {document ? <Document key={`${id}:${item.revision}`} id={`${id}-body`} document={document} /> : <p className="whitespace-pre-wrap break-words text-sm">{item.deleted ? t('coManaged.conversation.deleted') : conversationText(item.note, item.markdown)}</p>}
          {!item.deleted && <CoManagedCommentAttachments resource={resource} comment={reference(item)} />}
          {writable && !draft && !disclosure && <div className="flex gap-2">
            {item.canReply && <Button id={`${id}-reply`} variant="ghost" size="sm" onClick={() => open({ kind: 'reply', item })}>{t('coManaged.conversation.reply')}</Button>}
            {own && document !== null && <Button id={`${id}-edit`} variant="ghost" size="sm" onClick={() => open({ kind: 'edit', item })}>{t('coManaged.conversation.edit')}</Button>}
            {own && !item.parentCommentId && <Button id={`${id}-audience`} variant="ghost" size="sm" onClick={() => setDisclosure(item)}>{t('coManaged.disclosure.title')}</Button>}
            {own && <Button id={`${id}-delete`} variant="ghost" size="sm" onClick={() => open({ kind: 'delete', item })}>{t('coManaged.conversation.delete')}</Button>}
          </div>}
        </li>;
      })}</ol>
      <div className="flex gap-2">
        {cursors.current.length > 1 && <Button id="co-task-conversation-newer" variant="outline" disabled={busy || Boolean(draft || disclosure)} onClick={() => { cursors.current.pop(); void refresh(true); }}>{t('coManaged.conversation.newer')}</Button>}
        {state.nextBefore && <Button id="co-task-conversation-older" variant="outline" disabled={busy || Boolean(draft || disclosure)} onClick={() => { cursors.current.push(state.nextBefore!); void refresh(true); }}>{t('coManaged.conversation.older')}</Button>}
      </div>
    </>}
  </section>;
}
