'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Mail, MessageSquare, LockKeyhole, Plus, Check, ChevronRight } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import type { NamedTicketConversation, ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { CoManagedConversationContent } from '@alga-psa/co-managed/conversationContent';
import { snapshotConversationDocument, type CoManagedRichTextDocument } from '@alga-psa/co-managed/conversationRichText';
import type { ConversationDraftParent, EditorDraftSaveRequest } from '@alga-psa/shared/lib/tickets/conversationEditorDrafts';
import * as actions from '../../../actions/namedTicketConversationActions';
import { conversationDocument, conversationText } from './conversationText';
import type { ConversationEmailDraft } from '@alga-psa/shared/lib/tickets/conversationEmailEnvelope';
import { ConversationEmailControls } from './ConversationEmailControls';
import { ConversationEmailEnvelope } from './ConversationEmailEnvelope';

const Document = dynamic(() => import('./ConversationDocument'), { ssr: false });
const reference = (c: NamedTicketConversation): TicketConversationReference => ({ storeTenant: c.storeTenant, conversationId: c.conversationId });
const keyOf = (c: TicketConversationReference) => `${c.storeTenant}:${c.conversationId}`;
type Screen = Awaited<ReturnType<typeof actions.getNamedTicketConversationScreenAction>>;
type Page = Awaited<ReturnType<typeof actions.getNamedTicketConversationMessagesAction>>;
type Flush = MutableRefObject<() => Promise<boolean>>;
const audienceLabels = { requester: 'Requester', shared_it: 'Shared IT', organization_private: 'Your organization only' };

/** The host provides the established requester panel. Additional conversations
 * have their own history and composer; they never reuse a ticket-wide sender. */
export function useNamedTicketConversations(input: ConversationTicketReference | null, enabled: boolean, id: string) {
  const { t } = useTranslation('features/tickets');
  const { data: session } = useSession(), router = useRouter(), params = useSearchParams();
  const ticket = useMemo(() => input ? { ...input } : null, [input?.tenant, input?.ticketId, input?.relationshipId]);
  const identity = `${session?.session_id}:${session?.user?.tenant}:${session?.user?.id}:${ticket?.tenant}:${ticket?.ticketId}:${ticket?.relationshipId}`;
  const [state, setState] = useState<{ identity: string; screen: Screen } | null>(null);
  const [error, setError] = useState(false), [reload, setReload] = useState(0), [creating, setCreating] = useState(false);
  const flush = useRef<() => Promise<boolean>>(async () => true);
  const [dirty, setDirty] = useState(false);
  const refresh = useCallback(() => setReload(n => n + 1), []);
  const requestedId = params?.get('conversation'), requestedStore = params?.get('conversationStore');
  const screen = state?.identity === identity ? state.screen : null;
  useEffect(() => {
    if (!enabled || !ticket || !session?.user?.id) { setState(null); return; }
    let current = true;
    actions.getNamedTicketConversationScreenAction(ticket).then(value => {
      if (current) { setState({ identity, screen: value }); setError(false); }
    }).catch(() => { if (current) { setState(null); setError(true); setDirty(false); } });
    return () => { current = false; };
  }, [enabled, ticket, identity, reload]);
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(onFocus, 30000);
    return () => { window.removeEventListener('focus', onFocus); window.clearInterval(timer); };
  }, [enabled, refresh]);
  useEffect(() => { setCreating(false); setDirty(false); }, [identity]);
  const [selection, setSelection] = useState<{ identity: string; key: string } | null>(null);
  const candidate = screen?.conversations.find(c => requestedId
    ? c.conversationId === requestedId && c.storeTenant === (requestedStore || ticket?.tenant)
    : c.defaultSlot === 'requester');
  const desiredKey = candidate ? keyOf(candidate) : requestedId ? `${requestedStore}:${requestedId}` : '';
  const selected = selection?.identity === identity ? screen?.conversations.find(c => keyOf(c) === selection.key) : candidate;
  useEffect(() => {
    if (!screen || (selection?.identity === identity && selection.key === desiredKey)) return;
    let valid = true;
    flush.current().then(saved => { if (valid && saved) { setSelection({ identity, key: desiredKey }); setDirty(false); } });
    return () => { valid = false; };
  }, [identity, desiredKey, screen, selection]);
  const select = async (conversation: NamedTicketConversation) => {
    if (!await flush.current()) return;
    const query = new URLSearchParams(params?.toString());
    query.delete('message');
    if (conversation.defaultSlot === 'requester') { query.delete('conversation'); query.delete('conversationStore'); }
    else { query.set('conversation', conversation.conversationId); query.set('conversationStore', conversation.storeTenant); }
    router.push(`${window.location.pathname}${query.size ? `?${query}` : ''}`, { scroll: false });
    setDirty(false);
  };
  if (!enabled || !ticket) return { navigator: undefined, panel: undefined };
  const unavailable = <div role="alert" className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
    <p>{t('namedConversations.unavailable', 'This conversation is unavailable.')}</p>
    <Button id={`${id}-retry`} variant="ghost" onClick={refresh}>{t('namedConversations.retry', 'Retry')}</Button>
  </div>;
  const loading = <div role="status" className="rounded-lg border border-[rgb(var(--color-border-200))] p-4 text-sm text-muted-foreground">{t('namedConversations.loading', 'Loading conversations…')}</div>;
  const navigator = <section aria-label={t('namedConversations.title', 'Conversations')} className="overflow-hidden rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
    <div className="flex items-center justify-between border-b border-[rgb(var(--color-border-200))] px-3 py-2">
      <h2 className="text-sm font-semibold">{t('namedConversations.title', 'Conversations')}</h2>
      {screen?.writeAudiences.some(a => a !== 'requester') && <Button id={`${id}-create`} size="sm" variant="ghost" aria-label={t('namedConversations.new', 'New conversation')}
        onClick={async () => { if (await flush.current()) setCreating(true); }}><Plus className="h-4 w-4" /></Button>}
    </div>
    {!screen ? error ? unavailable : loading : <nav className="space-y-1 p-2">{screen.conversations.map((conversation, index) => {
      const active = selected && keyOf(selected) === keyOf(conversation);
      const Icon = conversation.transport === 'email' ? Mail : conversation.audience === 'organization_private' ? LockKeyhole : MessageSquare;
      return <button id={`${id}-select-${index}`} key={keyOf(conversation)} type="button" aria-current={active ? 'page' : undefined}
        onClick={() => void select(conversation)} className={`flex w-full items-start gap-2 rounded-md px-2 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${active ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-background))]'}`}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{conversation.defaultSlot === 'requester' ? t('namedConversations.requester', 'Requester') : conversation.name}</span>
          <span className="block text-xs opacity-75">{t(`namedConversations.audiences.${conversation.audience}`, audienceLabels[conversation.audience])}{active && dirty ? ` · ${t('namedConversations.draft', 'Draft')}` : ''}</span></span>
        {conversation.status === 'done' ? <Check className="mt-0.5 h-3.5 w-3.5" aria-label={t('namedConversations.done', 'Done')} /> : active ? <ChevronRight className="mt-0.5 h-3.5 w-3.5" /> : null}
      </button>;
    })}</nav>}
    {screen && <CreateConversation id={id} ticket={ticket} open={creating} audiences={screen.writeAudiences.filter(a => a !== 'requester')}
      onClose={() => setCreating(false)} onCreated={async value => { setCreating(false); refresh(); await select(value); }} />}
  </section>;
  return { navigator, panel: !screen ? (error ? unavailable : loading) : !selected ? unavailable : selected.defaultSlot === 'requester' ? undefined
    : <NamedConversationPanel key={`${identity}:${keyOf(selected)}`} id={id} ticket={ticket} conversation={selected}
      canWrite={screen.writeAudiences.includes(selected.audience)} flush={flush} onDirty={setDirty} onRefresh={refresh} /> };
}

function CreateConversation({ id, ticket, open, audiences, onClose, onCreated }: { id: string; ticket: ConversationTicketReference; open: boolean;
  audiences: Screen['writeAudiences']; onClose: () => void; onCreated: (value: NamedTicketConversation) => Promise<void> }) {
  const { t } = useTranslation('features/tickets');
  const [name, setName] = useState(''), [audience, setAudience] = useState<'shared_it' | 'organization_private'>('organization_private');
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [transport, setTransport] = useState<'internal' | 'email'>('internal');
  const operation = useRef<{ operationId: string; name: string; audience: typeof audience; transport: 'internal' | 'email' } | null>(null);
  useEffect(() => { if (open) { setName(''); setTransport('internal'); setAudience(audiences.includes('organization_private') ? 'organization_private' : 'shared_it'); setError(false); operation.current = null; } }, [open]);
  const submit = async () => {
    if (busy || !name.trim() || !audiences.includes(audience)) return;
    setBusy(true); setError(false);
    try {
      operation.current ??= { operationId: crypto.randomUUID(), name: name.trim(), audience, transport };
      await onCreated(await actions.createNamedTicketConversationAction(ticket, operation.current));
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  return <Dialog isOpen={open} onClose={() => { if (!busy) onClose(); }} title={t('namedConversations.new', 'New conversation')}
    footer={<><Button id={`${id}-create-cancel`} variant="outline" disabled={busy} onClick={onClose}>{t('namedConversations.cancel', 'Cancel')}</Button>
      <Button id={`${id}-create-confirm`} disabled={busy || !name.trim()} onClick={() => void submit()}>{t('namedConversations.create', 'Create conversation')}</Button></>}>
    <DialogContent><div className="space-y-4">
      <CustomSelect id={`${id}-transport`} label={t('namedConversations.kind', 'Conversation type')} value={transport} disabled={busy || Boolean(error)}
        options={[{ value: 'internal', label: t('namedConversations.internalMessage', 'Internal message') }, { value: 'email', label: t('namedConversations.vendorEmail', 'Vendor email') }]} onValueChange={value => setTransport(value as typeof transport)} />
      <Input id={`${id}-name`} label={t('namedConversations.name', 'Name')} value={name} maxLength={160} disabled={busy || Boolean(error)} onChange={e => setName(e.target.value)} />
      <CustomSelect id={`${id}-audience`} label={t('namedConversations.audience', 'Visible to')} value={audience} disabled={busy || Boolean(error)}
        options={audiences.map(value => ({ value, label: t(`namedConversations.audiences.${value}`, audienceLabels[value]) }))}
        onValueChange={value => setAudience(value as typeof audience)} />
      <p className="text-sm text-muted-foreground">{transport === 'email' ? t('namedConversations.vendorHelp', 'Choose a sending mailbox and recipients in the conversation. Every email is reviewed before sending.') : t('namedConversations.internalHelp', 'Internal messages stay with the selected IT audience. They are not emailed to the requester.')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{t('namedConversations.createFailed', 'Could not confirm creation. Retry to check the same request.')}</p>}
    </div></DialogContent>
  </Dialog>;
}

function NamedConversationPanel({ id, ticket, conversation, canWrite, flush, onDirty, onRefresh }: { id: string; ticket: ConversationTicketReference;
  conversation: NamedTicketConversation; canWrite: boolean; flush: Flush; onDirty: (dirty: boolean) => void; onRefresh: () => void }) {
  const { t } = useTranslation('features/tickets'), { formatDate } = useFormatters();
  const [page, setPage] = useState<Page | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(false), [version, setVersion] = useState(0);
  const current = useRef(true), pageGeneration = useRef(0);
  const reply = useRef<((parent: ConversationDraftParent) => Promise<boolean>) | null>(null);
  const [replyReady, setReplyReady] = useState(false);
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  useEffect(() => {
    let valid = true;
    pageGeneration.current++;
    actions.getNamedTicketConversationMessagesAction(ticket, reference(conversation)).then(value => { if (valid) { setPage(value); setError(false); } })
      .catch(() => { if (valid) { setPage(null); setError(true); onDirty(false); } });
    return () => { valid = false; };
  }, [ticket, conversation.revision, conversation.messageVersion, version]);
  const loadMore = async () => {
    if (!page?.nextBefore || busy) return;
    const generation = pageGeneration.current;
    setBusy(true);
    try { const next = await actions.getNamedTicketConversationMessagesAction(ticket, reference(conversation), page.nextBefore);
      if (current.current && generation === pageGeneration.current) setPage(old => old ? { ...next, items: [...old.items, ...next.items] } : next); }
    catch { if (current.current && generation === pageGeneration.current) { setPage(null); setError(true); onDirty(false); } }
    finally { if (current.current) setBusy(false); }
  };
  const status = async () => {
    if (busy || !await flush.current()) return;
    setBusy(true);
    try { await actions.setNamedTicketConversationStatusAction(ticket, reference(conversation), conversation.revision, conversation.status === 'done' ? 'open' : 'done'); onRefresh(); }
    catch { if (current.current) setError(true); }
    finally { if (current.current) setBusy(false); }
  };
  return <section className="overflow-hidden rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]" aria-label={conversation.name}>
    <header className="flex items-start justify-between gap-3 border-b border-[rgb(var(--color-border-200))] p-4">
      <div className="min-w-0"><h2 className="break-words text-base font-semibold">{conversation.name}</h2><p className="mt-1 text-xs text-muted-foreground">{t(`namedConversations.audiences.${conversation.audience}`, audienceLabels[conversation.audience])}</p></div>
      {canWrite && <Button id={`${id}-status`} size="sm" variant="outline" disabled={busy} onClick={() => void status()}>{conversation.status === 'done' ? t('namedConversations.reopen', 'Reopen') : t('namedConversations.markDone', 'Mark done')}</Button>}
    </header>
    {error && <p role="alert" className="p-4 text-destructive">{t('namedConversations.unavailable', 'This conversation is unavailable.')}</p>}
    {!page && !error && <p role="status" className="p-4 text-sm">{t('namedConversations.loading', 'Loading conversations…')}</p>}
    {page && <><div className="space-y-4 p-4">
      {page.nextBefore && <Button id={`${id}-older`} size="sm" variant="ghost" disabled={busy} onClick={() => void loadMore()}>{t('namedConversations.older', 'Load earlier messages')}</Button>}
      {!page.items.length && <p className="py-8 text-center text-sm text-muted-foreground">{t('namedConversations.empty', 'Start the conversation. Keep this exchange focused on its audience.')}</p>}
      {[...page.items].reverse().map((item, index) => {
        const document = item.deleted ? null : conversationDocument(item.note);
        return <article key={`${item.storeTenant}:${item.commentId}`} data-comment-id={item.commentId} className="rounded-md border border-[rgb(var(--color-border-200))] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="font-medium text-[rgb(var(--color-text-700))]">{item.author?.displayName ?? t('namedConversations.author', 'Ticket participant')}</span>
            <time dateTime={item.createdAt}>{formatDate(item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
          {!item.deleted && item.email && <ConversationEmailEnvelope email={item.email} />}
          {item.deleted ? <p className="text-sm italic text-muted-foreground">{t('namedConversations.deleted', 'Message deleted')}</p>
            : document ? <Document id={`${id}-message-${index}`} document={document} /> : <p className="whitespace-pre-wrap break-words text-sm">{conversationText(item.note, item.markdown)}</p>}
          {item.parentCommentId && <p className="mt-2 text-xs text-muted-foreground">{t('namedConversations.reply', 'Reply')}</p>}
          {canWrite && !item.deleted && <Button id={`${id}-message-${index}-reply`} variant="ghost" size="sm" disabled={!replyReady}
            onClick={() => void reply.current?.({ threadId: item.threadId, commentId: item.commentId })}>{t('namedConversations.reply', 'Reply')}</Button>}
        </article>;
      })}
    </div>{canWrite && <NamedConversationComposer id={id} ticket={ticket} conversation={conversation} flush={flush} onDirty={onDirty} reply={reply} onReplyReady={setReplyReady} replyItems={page.items}
      onRefresh={onRefresh} onPosted={() => { setVersion(n => n + 1); onRefresh(); }} />}</>}
  </section>;
}

export function NamedConversationComposer({ id, ticket, conversation, flush, onDirty, onPosted, onRefresh, reply, onReplyReady, replyItems = [] }: { id: string; ticket: ConversationTicketReference;
  conversation: NamedTicketConversation; flush: Flush; onDirty: (dirty: boolean) => void; onPosted: () => void; onRefresh?: () => void; reply?: MutableRefObject<((parent: ConversationDraftParent) => Promise<boolean>) | null>; onReplyReady?: (ready: boolean) => void; replyItems?: Page['items'] }) {
  const { t } = useTranslation('features/tickets');
  const [document, setDocument] = useState<CoManagedRichTextDocument>([]), [loaded, setLoaded] = useState(false), [epoch, setEpoch] = useState(0);
  const isEmail = conversation.transport === 'email';
  const [email, setEmail] = useState<ConversationEmailDraft>({ subject: '', to: [], cc: [] });
  const [emailLocked, setEmailLocked] = useState(false);
  const emailLock = useRef(false), invalidEmail = useRef(false);
  const currentConversation = useRef(conversation); currentConversation.current = conversation;
  const lockEmail = (locked: boolean) => { emailLock.current = locked; setEmailLocked(locked); };
  const [parent, setParent] = useState<ConversationDraftParent | null>(null);
  const [saving, setSaving] = useState(false), [posting, setPosting] = useState(false), [error, setError] = useState<string | null>(null);
  const state = useRef({ revision: 0, content: null as CoManagedConversationContent | null, generation: 0, dirty: false, alive: true, conversationRevision: conversation.revision, invalid: false, parent: null as ConversationDraftParent | null, email: null as ConversationEmailDraft | null });
  const pending = useRef<{ request: EditorDraftSaveRequest<CoManagedConversationContent>; generation: number } | null>(null);
  const flight = useRef<Promise<boolean> | null>(null);
  const postRequest = useRef<Parameters<typeof actions.postNamedTicketConversationAction>[2] | null>(null);
  const readGeneration = useRef(0);
  const read = useCallback(async () => {
    const generation = ++readGeneration.current;
    const draft = await actions.getNamedConversationEditorDraftAction(ticket, reference(conversation));
    const defaults = isEmail && !draft?.email ? await actions.getNamedConversationEmailDefaultsAction(ticket, reference(conversation)) : null;
    if (!state.current.alive || generation !== readGeneration.current) return;
    const content = draft?.content ?? null;
    state.current.revision = draft?.revision ?? 0; state.current.content = content;
    state.current.dirty = Boolean(content && draft?.conversationRevision !== currentConversation.current.revision);
    state.current.generation++;
    state.current.parent = draft?.parent ?? null; setParent(state.current.parent);
    state.current.email = draft?.email ?? defaults;
    if (defaults) { state.current.content ??= { text: '' }; state.current.dirty = true; }
    setEmail(state.current.email ?? { subject: '', to: [], cc: [] });
    state.current.conversationRevision = currentConversation.current.revision;
    state.current.invalid = false; invalidEmail.current = false;
    setDocument(content?.document ?? (content?.text ? conversationDocument(content.text) ?? [] : []));
    setEpoch(n => n + 1); setLoaded(true); onDirty(Boolean(state.current.email || state.current.parent || (content && (content.document || content.text))));
  }, [ticket, conversation.conversationId]);
  useEffect(() => {
    state.current.alive = true;
    read().catch(() => { if (state.current.alive) setError('unavailable'); });
    return () => { state.current.alive = false; };
  }, [read]);
  const save = useCallback((): Promise<boolean> => {
    if (state.current.invalid || invalidEmail.current) return Promise.resolve(false);
    if (flight.current) return flight.current;
    const task = async () => {
      await Promise.resolve(); // Install the flight before a clean draft can resolve synchronously.
      setSaving(true);
      try {
        while (state.current.alive && (state.current.dirty || pending.current)) {
          if (!pending.current && (state.current.invalid || invalidEmail.current)) return false;
          pending.current ??= { generation: state.current.generation, request: { operationId: crypto.randomUUID(), expectedRevision: state.current.revision,
            expectedConversationRevision: state.current.conversationRevision, content: state.current.content, parent: state.current.parent, email: state.current.email } };
          const sent = pending.current;
          const saved = await actions.saveNamedConversationEditorDraftAction(ticket, reference(conversation), sent.request);
          if (!state.current.alive) return false;
          state.current.revision = saved.revision;
          if (state.current.generation === sent.generation) state.current.dirty = false;
          pending.current = null;
        }
        setError(null); return state.current.alive && !state.current.dirty;
      } catch { if (state.current.alive) setError('saveFailed'); return false; }
      finally { flight.current = null; if (state.current.alive) setSaving(false); }
    };
    flight.current = task(); return flight.current;
  }, [ticket, conversation.conversationId]);
  const changeParent = useCallback(async (next: ConversationDraftParent | null) => {
    if (!loaded || posting || emailLock.current || postRequest.current || !await save()) return false;
    state.current.parent = next; setParent(next);
    state.current.content ??= { text: '' };
    state.current.dirty = true; state.current.generation++;
    onDirty(Boolean(state.current.email || next || state.current.content.document || state.current.content.text));
    const saved = await save();
    if (saved && state.current.alive) {
      const editor = window.document.getElementById(`${id}-composer`);
      editor?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      (editor?.querySelector<HTMLElement>('[contenteditable="true"]') ?? editor)?.focus();
    }
    return saved;
  }, [loaded, posting, save, id, onDirty]);
  useEffect(() => {
    if (reply) reply.current = changeParent;
    onReplyReady?.(loaded && !posting && !emailLocked && !postRequest.current);
    return () => { if (reply?.current === changeParent) reply.current = null; onReplyReady?.(false); };
  }, [reply, changeParent, loaded, posting, emailLocked, error, onReplyReady]);
  useEffect(() => {
    const flushDraft = () => emailLock.current ? Promise.resolve(false) : save();
    flush.current = flushDraft; return () => { if (flush.current === flushDraft) flush.current = async () => true; };
  }, [flush, save]);
  useEffect(() => {
    if (!loaded || state.current.conversationRevision === conversation.revision) return;
    state.current.conversationRevision = conversation.revision;
    if (state.current.content) { state.current.dirty = true; state.current.generation++; void save(); }
  }, [conversation.revision, loaded, save]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (state.current.dirty || pending.current || postRequest.current || emailLock.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const change = (value: CoManagedRichTextDocument) => {
    if (posting || emailLock.current || postRequest.current) return;
    setDocument(value);
    let content: CoManagedConversationContent;
    try {
      snapshotConversationDocument(value, true);
      content = conversationText(JSON.stringify(value), null).trim() ? { document: snapshotConversationDocument(value) } : { text: '' };
      state.current.invalid = false;
    } catch { state.current.invalid = true; state.current.dirty = true; setError('invalid'); onDirty(true); return; }
    state.current.content = content; state.current.dirty = true; state.current.generation++;
    onDirty(Boolean(state.current.email || state.current.parent || content.document || content.text)); void save();
  };
  const changeEmail = (next: ConversationEmailDraft) => {
    if (!loaded || emailLock.current) return;
    setEmail(next);
    invalidEmail.current = next.subject.length > 255 || [next.to, next.cc].some(values => values.length > 100 || values.some(value => value.length > 500 || /[\r\n\0]/.test(value)));
    if (invalidEmail.current) { state.current.dirty = true; setError('invalid'); onDirty(true); return; }
    state.current.email = next; state.current.content ??= { text: '' };
    state.current.dirty = true; state.current.generation++; onDirty(true); void save();
  };
  const reviewDraft = async () => {
    if (!loaded || !await save()) return null;
    return { operationId: crypto.randomUUID(), expectedConversationRevision: state.current.conversationRevision, expectedDraftRevision: state.current.revision };
  };
  const submit = async () => {
    if (posting || !loaded || !await save()) return;
    setPosting(true); setError(null);
    try {
      postRequest.current ??= { operationId: crypto.randomUUID(), expectedConversationRevision: state.current.conversationRevision,
        expectedDraftRevision: state.current.revision };
      await actions.postNamedTicketConversationAction(ticket, reference(conversation), postRequest.current);
      if (!state.current.alive) return;
      await read();
      if (!state.current.alive) return;
      postRequest.current = null; onPosted();
    } catch { if (state.current.alive) setError('postFailed'); }
    finally { if (state.current.alive) setPosting(false); }
  };
  const parentMessage = parent ? replyItems.find(item => item.commentId === parent.commentId && item.threadId === parent.threadId) : undefined;
  let nonempty = false;
  try { snapshotConversationDocument(document); nonempty = true; } catch { /* An empty editor is a draft, not a message. */ }
  return <div className="space-y-3 border-t border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
    <div className="flex justify-between gap-2"><h3 className="text-sm font-medium">{isEmail ? t('namedConversations.vendorEmail', 'Vendor email') : t('namedConversations.internalMessage', 'Internal message')}</h3>
      <span role="status" className="text-xs text-muted-foreground">{saving ? t('namedConversations.saving', 'Saving draft…') : loaded ? t('namedConversations.privateDraft', 'Draft visible only to you') : t('namedConversations.loading', 'Loading conversations…')}</span></div>
    {isEmail && <div className="space-y-3">
      <Input id={`${id}-email-to`} label={t('namedConversations.to', 'To')} value={email.to.join(';')} disabled={!loaded || emailLocked} maxLength={50000} onChange={event => changeEmail({ ...email, to: event.target.value.split(';') })} />
      <Input id={`${id}-email-cc`} label={t('namedConversations.cc', 'CC')} value={email.cc.join(';')} disabled={!loaded || emailLocked} maxLength={50000} onChange={event => changeEmail({ ...email, cc: event.target.value.split(';') })} />
      <p className="text-xs text-muted-foreground">{t('namedConversations.addressHelp', 'Separate email addresses with semicolons.')}</p>
      <Input id={`${id}-email-subject`} label={t('namedConversations.subject', 'Subject')} value={email.subject} disabled={!loaded || emailLocked} maxLength={255} onChange={event => changeEmail({ ...email, subject: event.target.value })} />
    </div>}
    {parent && <div className="flex items-center justify-between gap-2 rounded-md border border-[rgb(var(--color-border-200))] px-3 py-2 text-sm">
      <div className="min-w-0"><p>{t('namedConversations.replying', 'Replying to a message in this conversation')}</p>
        {parentMessage && <p className="mt-1 truncate text-xs text-muted-foreground">{parentMessage.author?.displayName ? `${parentMessage.author.displayName}: ` : ''}{parentMessage.deleted ? t('namedConversations.deleted', 'Message deleted') : conversationText(parentMessage.note, parentMessage.markdown)}</p>}
      </div>
      <Button id={`${id}-clear-reply`} variant="ghost" size="sm" disabled={posting || emailLocked || Boolean(postRequest.current)} onClick={() => void changeParent(null)}>{t('namedConversations.clearReply', 'New message instead')}</Button>
    </div>}
    {loaded && <Document key={epoch} id={`${id}-composer`} document={document} editable={!posting && !emailLocked && !postRequest.current} onChange={change} />}
    {error && <p role="alert" className="text-sm text-destructive">{t(`namedConversations.${error}`, error === 'saveFailed' ? 'Could not save. Retry before switching conversations.' : error === 'postFailed' ? 'Could not confirm the post. Retry to check the same message.' : error === 'invalid' ? 'This draft contains unsupported content. Edit it before saving.' : 'This conversation is unavailable.')}</p>}
    {isEmail && loaded && <ConversationEmailControls id={id} ticket={ticket} conversation={conversation} ready={nonempty && Boolean(email.subject.trim()) && email.to.some(value => value.trim())}
      saveDraft={reviewDraft} onLock={lockEmail} onMailbox={value => { state.current.conversationRevision = value.revision; if (state.current.content) { state.current.dirty = true; state.current.generation++; } onRefresh?.(); }} onSent={async () => { await read(); onPosted(); }} />}
    <div className="flex items-center gap-2">{!isEmail && <Button id={`${id}-post`} disabled={!loaded || !nonempty || posting} onClick={() => void submit()}>{postRequest.current ? t('namedConversations.retryPost', 'Retry post') : t('namedConversations.post', 'Post')}</Button>}
      {error === 'saveFailed' && <Button id={`${id}-save-retry`} variant="outline" disabled={saving} onClick={() => void save()}>{t('namedConversations.retry', 'Retry')}</Button>}
      <span className="text-xs text-muted-foreground">{t(`namedConversations.audiences.${conversation.audience}`, audienceLabels[conversation.audience])}</span></div>
  </div>;
}
