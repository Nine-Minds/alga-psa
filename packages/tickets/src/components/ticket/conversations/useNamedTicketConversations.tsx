'use client';

import { ConversationAiDialog } from './ConversationAiDialog';
import { ConversationSynthesisControls } from './ConversationSynthesisControls';
import { ConversationShareDialog } from './ConversationShareDialog';
import { ConversationShareButton, ConversationSharingContext, useConversationSharing, type ConversationShareSelection, type ConversationSynthesisSelection } from './ConversationSharingContext';
import { ConversationAttentionControls } from './ConversationAttentionControls';
import { ConversationReadAcknowledgment } from './ConversationReadAcknowledgment';
import { useConversationMessageTarget, useConversationMessageFocus } from './useConversationMessageFocus';
import { ConversationSchedulePicker } from './ConversationSchedulePicker';
import { NamedScheduledReplies } from './NamedScheduledReplies';
import { getUserTimeZone } from '@alga-psa/core';
import { useConversationReplyLink } from './useConversationReplyLink';
import { ConversationDraftFiles } from './ConversationDraftFiles';
import type { ConversationEditorFile } from '@alga-psa/shared/lib/tickets/conversationEditorFiles';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Mail, MessageSquare, LockKeyhole, Plus, Check, ChevronRight } from 'lucide-react';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import type { RequesterPublicationOptions } from '@alga-psa/shared/lib/tickets/requesterPublicationOptions';
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
import { ConversationMessageDetails } from './ConversationMessageDetails';

const Document = dynamic(() => import('./ConversationDocument'), { ssr: false });
const reference = (c: NamedTicketConversation): TicketConversationReference => ({ storeTenant: c.storeTenant, conversationId: c.conversationId });
const keyOf = (c: TicketConversationReference) => `${c.storeTenant}:${c.conversationId}`;
type Screen = Awaited<ReturnType<typeof actions.getNamedTicketConversationScreenAction>>;
type Page = Awaited<ReturnType<typeof actions.getNamedTicketConversationMessagesAction>>;
type AiSelection = { kind: 'ai'; conversation: NamedTicketConversation };
type Flush = MutableRefObject<() => Promise<boolean>>;
const audienceLabels = { requester: 'Requester', shared_it: 'Shared IT', organization_private: 'Your organization only' };

/** Hosts may retain their established requester history while attaching the
 * shared private-draft composer. Every sender remains conversation-scoped. */
export function useNamedTicketConversations(input: ConversationTicketReference | null, enabled: boolean, id: string,
  options: { onPublished?: () => void | Promise<void>; requesterPanel?: (props: { conversation: NamedTicketConversation; flush: Flush; onDirty: (dirty: boolean) => void; canWrite: boolean; onRefresh: () => void; refreshVersion: number }) => ReactNode } = {}) {
  const { t } = useTranslation('features/tickets');
  const { data: session } = useSession(), router = useRouter(), params = useSearchParams();
  const ticket = useMemo(() => input ? { ...input } : null, [input?.tenant, input?.ticketId, input?.relationshipId]);
  const identity = `${session?.session_id}:${session?.user?.tenant}:${session?.user?.id}:${ticket?.tenant}:${ticket?.ticketId}:${ticket?.relationshipId}`;
  const [state, setState] = useState<{ identity: string; screen: Screen } | null>(null);
  const [error, setError] = useState(false), [reload, setReload] = useState(0), [creating, setCreating] = useState(false);
  const flush = useRef<() => Promise<boolean>>(async () => true);
  const [dirty, setDirty] = useState(false);
  const [sharing, setSharing] = useState<{ identity: string; selection: ConversationShareSelection | ConversationSynthesisSelection | AiSelection } | null>(null);
  const [panelEpoch, setPanelEpoch] = useState(0);
  // F023: recipients entered at creation ride along to the new conversation's
  // first composer mount only (see `NamedConversationComposer`'s
  // `initialRecipients` prop below); consumed once the composer seeds and
  // saves them into a real draft, never reapplied afterward.
  const [pendingRecipients, setPendingRecipients] = useState<{ identity: string; key: string; to: string[] } | null>(null);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const openingShare = useRef(false);
  const preparedDestination = useRef<{ identity: string; previousQuery: string; key: string } | null>(null);
  const refresh = useCallback(() => setReload(n => n + 1), []);
  const requestedId = params?.get('conversation'), requestedStore = params?.get('conversationStore');
  const requestedActivity = params?.get('conversationView') === 'all';
  const screen = state?.identity === identity ? state.screen : null;
  const activeShare = enabled && screen && sharing?.identity === identity ? sharing.selection : null;
  useEffect(() => {
    if (!enabled || !ticket || !session?.user?.id) { setState(null); return; }
    let current = true;
    actions.getNamedTicketConversationScreenAction(ticket).then(value => {
      if (current) { setState({ identity, screen: value }); setError(false); }
    }).catch(() => { if (current) { setState(null); setError(true); setDirty(false); setSharing(null); } });
    return () => { current = false; };
  }, [enabled, ticket, identity, reload]);
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(onFocus, 30000);
    return () => { window.removeEventListener('focus', onFocus); window.clearInterval(timer); };
  }, [enabled, refresh]);
  useEffect(() => { setCreating(false); setDirty(false); setSharing(null); }, [identity]);
  const [selection, setSelection] = useState<{ identity: string; key: string } | null>(null);
  const candidate = screen?.conversations.find(c => requestedId
    ? c.conversationId === requestedId && c.storeTenant === (requestedStore || ticket?.tenant)
    : c.defaultSlot === 'requester');
  const desiredKey = requestedActivity ? '__all__' : candidate ? keyOf(candidate) : requestedId ? `${requestedStore}:${requestedId}` : '';
  const selected = selection?.identity === identity ? screen?.conversations.find(c => keyOf(c) === selection.key) : candidate;
  const allActivity = selection?.identity === identity ? selection.key === '__all__' : requestedActivity;
  const queryString = params?.toString() ?? '';
  useEffect(() => {
    const prepared = preparedDestination.current;
    if (prepared) {
      if (prepared.identity === identity && prepared.key !== desiredKey && prepared.previousQuery === queryString) return;
      preparedDestination.current = null;
    }
    if (activeShare || !screen || (selection?.identity === identity && selection.key === desiredKey)) return;
    let valid = true;
    flush.current().then(saved => { if (valid && saved) { setSelection({ identity, key: desiredKey }); setDirty(false); } });
    return () => { valid = false; };
  }, [identity, desiredKey, screen, selection, activeShare, panelEpoch, queryString]);
  const navigate = (conversation: Pick<NamedTicketConversation, 'conversationId' | 'storeTenant' | 'defaultSlot'>, parent?: ConversationDraftParent, messageId?: string) => {
    const query = new URLSearchParams(params?.toString());
    query.delete('message'); query.delete('conversationView'); query.delete('replyTo'); query.delete('replyThread');
    if (parent) { query.set('replyTo', parent.commentId); query.set('replyThread', parent.threadId); }
    if (conversation.defaultSlot === 'requester') { query.delete('conversation'); query.delete('conversationStore'); }
    else { query.set('conversation', conversation.conversationId); query.set('conversationStore', conversation.storeTenant); }
    if (messageId) query.set('message', messageId);
    router.push(`${window.location.pathname}${query.size ? `?${query}` : ''}`, { scroll: false });
    setDirty(false);
  };
  const select = async (conversation: NamedTicketConversation, parent?: ConversationDraftParent) => {
    if (activeShare || !await flush.current() || currentIdentity.current !== identity) return;
    navigate(conversation, parent);
  };
  const share = async (value: ConversationShareSelection | ConversationSynthesisSelection | AiSelection) => {
    if (openingShare.current || activeShare || !screen?.writeAudiences.length) return;
    openingShare.current = true;
    try {
      if (await flush.current() && currentIdentity.current === identity) setSharing({ identity, selection: value });
    } finally { openingShare.current = false; }
  };
  const closeShare = () => { setSharing(null); setPanelEpoch(value => value + 1); refresh(); };
  const openSharedDraft = (conversation: NamedTicketConversation) => {
    if (currentIdentity.current !== identity) return;
    // Preparation already flushed the source. Select the destination directly;
    // its newly mounted composer cannot flush until its private draft has loaded.
    preparedDestination.current = { identity, previousQuery: queryString, key: keyOf(conversation) };
    setSelection({ identity, key: keyOf(conversation) });
    setState(previous => previous?.identity === identity ? { ...previous, screen: { ...previous.screen,
      conversations: previous.screen.conversations.some(value => keyOf(value) === keyOf(conversation))
        ? previous.screen.conversations.map(value => keyOf(value) === keyOf(conversation) ? { ...value, ...conversation } : value)
        : [...previous.screen.conversations, { ...conversation, attention: null, hasDraft: false }],
    } } : previous);
    closeShare(); navigate(conversation);
  };
  if (!enabled || !ticket) return { navigator: undefined, panel: undefined };
  const unavailable = <div role="alert" className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
    <p>{t('namedConversations.unavailable', 'This conversation is unavailable.')}</p>
    <Button id={`${id}-retry`} variant="ghost" onClick={refresh}>{t('namedConversations.retry', 'Retry')}</Button>
  </div>;
  const loading = <div role="status" className="rounded-lg border border-[rgb(var(--color-border-200))] p-4 text-sm text-muted-foreground">{t('namedConversations.loading', 'Loading conversations…')}</div>;
  const navigator = <section aria-label={t('namedConversations.title', 'Conversations')} className="@container overflow-hidden rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
    <div className="flex items-center justify-between border-b border-[rgb(var(--color-border-200))] px-3 py-2">
      <h2 className="text-sm font-semibold">{t('namedConversations.title', 'Conversations')}</h2>
      {Boolean(screen?.writeAudiences.length) && <Button id={`${id}-create`} size="sm" variant="ghost" aria-label={t('namedConversations.new', 'New conversation')}
        onClick={async () => { if (await flush.current()) setCreating(true); }}><Plus className="h-4 w-4" /></Button>}
    </div>
    {!screen ? error ? unavailable : loading : <nav className="space-y-1 p-2">{screen.conversations.map((conversation, index) => {
      const active = !allActivity && selected && keyOf(selected) === keyOf(conversation);
      const Icon = conversation.transport === 'email' ? Mail : conversation.audience === 'organization_private' ? LockKeyhole : MessageSquare;
      return <div key={`${identity}:${keyOf(conversation)}`}><button id={`${id}-select-${index}`} data-automation-id={`${id}-select-${index}`} type="button" aria-current={active ? 'page' : undefined}
        onClick={() => void select(conversation)} className={`flex w-full items-start gap-2 rounded-md px-2 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${active ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-background))]'}`}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{conversation.defaultSlot === 'requester' ? t('namedConversations.requester', 'Requester') : conversation.name}</span>
          <span className="block text-xs opacity-75">{t(`namedConversations.audiences.${conversation.audience}`, audienceLabels[conversation.audience])}{(active ? dirty : conversation.hasDraft) ? ` · ${t('namedConversations.draft', 'Draft')}` : ''}</span></span>
        {conversation.attention && conversation.attention.unreadCount > 0 && <span className="rounded-full bg-primary-100 px-1.5 text-xs font-semibold text-primary-800 dark:bg-primary-500/20 dark:text-primary-200" aria-label={`${conversation.attention.unreadCount} ${t('namedConversations.unread', 'unread')}`}>{conversation.attention.unreadCount}</span>}
        {conversation.status === 'done' ? <Check className="mt-0.5 h-3.5 w-3.5" aria-label={t('namedConversations.done', 'Done')} /> : active ? <ChevronRight className="mt-0.5 h-3.5 w-3.5" /> : null}
      </button>{active && conversation.attention && <ConversationAttentionControls id={`${id}-${index}`} ticket={ticket}
        conversation={reference(conversation)} attention={conversation.attention} onChanged={refresh} />}</div>;
    })}<button id={`${id}-all-activity`} data-automation-id={`${id}-all-activity`} type="button" aria-current={allActivity ? 'page' : undefined}
      className={`w-full rounded-md px-2 py-2.5 text-left text-sm ${allActivity ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-[rgb(var(--color-text-700))]'}`}
      onClick={async () => { if (!await flush.current()) return; const query = new URLSearchParams(params?.toString());
        for (const key of ['conversation', 'conversationStore', 'message', 'replyTo', 'replyThread']) query.delete(key);
        query.set('conversationView', 'all'); router.push(`${window.location.pathname}?${query}`, { scroll: false });
      }}>{t('namedConversations.allActivity', 'All activity')}</button></nav>}
    {activeShare?.kind === 'ai' && <ConversationAiDialog key={`${identity}:ai:${keyOf(activeShare.conversation)}`} id={id} ticket={ticket} conversation={activeShare.conversation} onClose={closeShare} />}
    {activeShare && activeShare.kind !== 'ai' && <ConversationShareDialog key={`${identity}:${'commentId' in activeShare ? activeShare.commentId : 'synthesis'}`} id={id} ticket={ticket} selection={activeShare} onClose={closeShare} onOpen={openSharedDraft} />}
    {screen && <CreateConversation key={identity} id={id} ticket={ticket} open={creating} audiences={screen.writeAudiences}
      onClose={() => setCreating(false)} onCreated={async (value, initialRecipients) => { setCreating(false);
        setPendingRecipients(initialRecipients?.length ? { identity, key: keyOf(value), to: initialRecipients } : null);
        refresh(); await select(value); }} />}
  </section>;
  const panel = !screen ? (error ? unavailable : loading) : allActivity ? <NamedConversationActivity key={`${identity}:all`} id={id} ticket={ticket} refreshVersion={reload} audiences={screen.writeAudiences} onReply={select} /> : !selected ? unavailable : selected.defaultSlot === 'requester' ? options.requesterPanel ? <Fragment key={`${identity}:${keyOf(selected)}`}>{options.requesterPanel?.({ conversation: selected, flush, onDirty: setDirty, canWrite: screen.writeAudiences.includes(selected.audience), onRefresh: refresh, refreshVersion: reload })}</Fragment> : undefined
    : <NamedConversationPanel key={`${identity}:${keyOf(selected)}`} id={id} ticket={ticket} conversation={selected}
      canWrite={screen.writeAudiences.includes(selected.audience)} flush={flush} onDirty={setDirty} onRefresh={refresh} onPublished={options.onPublished}
      initialRecipients={pendingRecipients?.identity === identity && pendingRecipients.key === keyOf(selected) ? pendingRecipients.to : undefined}
      onInitialRecipientsConsumed={() => setPendingRecipients(null)} />;
  return { navigator, panel: panel === undefined ? undefined : <ConversationSharingContext.Provider value={{ canShare: Boolean(screen?.writeAudiences.length), paused: Boolean(activeShare), share,
    openSource: async source => {
      if (activeShare || !await flush.current() || currentIdentity.current !== identity) return;
      navigate({ ...source.conversation, defaultSlot: null }, undefined, source.commentId);
    } }}>
    <div key={`${identity}:${panelEpoch}`} inert={Boolean(activeShare)} className="min-w-0">
      {selected && !allActivity && Boolean(screen?.writeAudiences.length) && <ConversationSynthesisControls key={`${identity}:synthesis:${keyOf(selected)}`} id={id}
        ticket={ticket} conversation={reference(selected)} refreshVersion={reload} disabled={Boolean(activeShare)} onSynthesize={share}
        onAskAi={selected.transport === 'internal' && selected.audience !== 'requester' && screen?.writeAudiences.includes(selected.audience)
          ? () => share({ kind: 'ai', conversation: selected }) : undefined} />}
      {panel}
    </div>
  </ConversationSharingContext.Provider> };
}

// F023: PRD §5.2 reads "Creation asks for a name, email or internal
// conversation, organizational audience and, for email, explicit recipients
// and an available authorized mailbox" as one continuous flow — the same
// literal wording F023's own checklist description ("validated email
// recipients") targets. Recipients are collected here, validated with the
// same loose-while-editing/syntax-checked rule the composer's own email
// draft uses, and carried into the newly created conversation's first draft
// (see `initialRecipients` below) rather than sent to the creation command
// itself — `CreateTicketConversation`'s snapshot rejects unknown fields, and
// mailbox/recipient values are draft data, not conversation identity.
// Mailbox selection remains a separate, already-built step in the composer
// (F037/F038): a mailbox chosen here would still need to be reconfirmed
// there once real send authority/grants are checked, so collecting it twice
// would not shorten the actual authorized path — only recipients move.
const EMAIL_ADDRESS_PATTERN = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
function parseRecipientInput(value: string): { addresses: string[]; invalid: boolean } {
  const parts = value.split(/[,;]/).map(part => part.trim()).filter(Boolean);
  const addresses = parts.filter(part => EMAIL_ADDRESS_PATTERN.test(part));
  return { addresses, invalid: addresses.length !== parts.length };
}
function CreateConversation({ id, ticket, open, audiences, onClose, onCreated }: { id: string; ticket: ConversationTicketReference; open: boolean;
  audiences: Screen['writeAudiences']; onClose: () => void; onCreated: (value: NamedTicketConversation, initialRecipients?: string[]) => Promise<void> }) {
  const { t } = useTranslation('features/tickets');
  const [name, setName] = useState(''), [audience, setAudience] = useState<Screen['writeAudiences'][number]>('organization_private');
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [transport, setTransport] = useState<'internal' | 'email'>('internal');
  const [recipientsText, setRecipientsText] = useState('');
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const operation = useRef<{ operationId: string; name: string; audience: typeof audience; transport: 'internal' | 'email' } | null>(null);
  useEffect(() => { if (open) {
    const initial = audiences.includes('organization_private') ? 'organization_private' : audiences.includes('shared_it') ? 'shared_it' : 'requester';
    setName(''); setTransport(initial === 'requester' ? 'email' : 'internal'); setAudience(initial); setError(false); setRecipientsText(''); operation.current = null;
  } }, [open]);
  // Requester-audience email is the pre-existing legacy composition path —
  // its recipient (the ticket's own requester) is implicit, not chosen here;
  // only vendor/external email conversations need explicit recipients at
  // creation (PRD §5.2, persona #2 — "choose explicit recipients").
  const isVendorEmail = transport === 'email' && audience !== 'requester';
  const { addresses: recipients, invalid: recipientsInvalid } = parseRecipientInput(recipientsText);
  const recipientsReady = !isVendorEmail || (recipients.length > 0 && !recipientsInvalid);
  const submit = async () => {
    if (busy || !name.trim() || !audiences.includes(audience) || !recipientsReady) return;
    setBusy(true); setError(false);
    try {
      operation.current ??= { operationId: crypto.randomUUID(), name: name.trim(), audience, transport };
      const created = await actions.createNamedTicketConversationAction(ticket, operation.current);
      if (mounted.current) await onCreated(created, isVendorEmail && recipients.length ? recipients : undefined);
    } catch { if (mounted.current) setError(true); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <Dialog isOpen={open} onClose={() => { if (!busy) onClose(); }} title={t('namedConversations.new', 'New conversation')}
    footer={<><Button id={`${id}-create-cancel`} variant="outline" disabled={busy} onClick={onClose}>{t('namedConversations.cancel', 'Cancel')}</Button>
      <Button id={`${id}-create-confirm`} disabled={busy || !name.trim() || !audiences.includes(audience) || !recipientsReady} onClick={() => void submit()}>{t('namedConversations.create', 'Create conversation')}</Button></>}>
    <DialogContent><div className="space-y-4">
      <CustomSelect id={`${id}-transport`} label={t('namedConversations.kind', 'Conversation type')} value={transport} disabled={busy || Boolean(error) || audience === 'requester'}
        options={[{ value: 'internal', label: t('namedConversations.internalMessage', 'Internal message') }, { value: 'email', label: t('namedConversations.externalEmail', 'External email') }]} onValueChange={value => setTransport(value as typeof transport)} />
      <Input id={`${id}-name`} label={t('namedConversations.name', 'Name')} value={name} maxLength={160} disabled={busy || Boolean(error)} onChange={e => setName(e.target.value)} />
      <CustomSelect id={`${id}-audience`} label={t('namedConversations.audience', 'Visible to')} value={audience} disabled={busy || Boolean(error)}
        options={audiences.map(value => ({ value, label: t(`namedConversations.audiences.${value}`, audienceLabels[value]) }))}
        onValueChange={value => { setAudience(value as typeof audience); if (value === 'requester') setTransport('email'); }} />
      {isVendorEmail && <Input id={`${id}-recipients`} label={t('namedConversations.recipients', 'Recipients')} placeholder={t('namedConversations.recipientsPlaceholder', 'name@example.com, name2@example.com')}
        value={recipientsText} disabled={busy || Boolean(error)} onChange={e => setRecipientsText(e.target.value)}
        aria-invalid={recipientsText.trim().length > 0 && !recipientsReady} />}
      {isVendorEmail && recipientsText.trim().length > 0 && !recipientsReady && <p role="alert" className="text-sm text-destructive">{t('namedConversations.recipientsInvalid', 'Enter at least one valid email address, separated by commas.')}</p>}
      <p className="text-sm text-muted-foreground">{transport === 'email' ? t('namedConversations.vendorHelp', 'Choose a sending mailbox in the conversation. Every email is reviewed before sending.') : t('namedConversations.internalHelp', 'Internal messages stay with the selected IT audience. They are not emailed to the requester.')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{t('namedConversations.createFailed', 'Could not confirm creation. Retry to check the same request.')}</p>}
    </div></DialogContent>
  </Dialog>;
}

function NamedConversationMessage({ id, index, ticket, conversation, item, onReply, replyReady = true, label = false }: {
  id: string; index: number; ticket: ConversationTicketReference; conversation: NamedTicketConversation; item: Page['items'][number];
  onReply?: (parent: ConversationDraftParent) => unknown; replyReady?: boolean; label?: boolean;
}) {
  const { t } = useTranslation('features/tickets'), { formatDate } = useFormatters();
  const element = useRef<HTMLElement | null>(null);
  const target = useConversationMessageTarget(ticket.tenant, label || item.deleted ? null : conversation);
  const highlighted = useConversationMessageFocus(target, item.commentId, element);
  const document = item.deleted ? null : conversationDocument(item.note);
  return <article ref={element} tabIndex={-1} key={`${item.storeTenant}:${item.commentId}`} data-comment-id={item.commentId}
    className={`rounded-md border border-[rgb(var(--color-border-200))] p-3 ${highlighted ? 'ring-2 ring-primary-500' : ''}`}>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="font-medium text-[rgb(var(--color-text-700))]">{item.author?.displayName ?? t('namedConversations.author', 'Ticket participant')}</span>
      <time dateTime={item.createdAt}>{formatDate(item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
    {label && <p className="mb-2 text-sm font-medium">{conversation.defaultSlot === 'requester' ? t('namedConversations.requester', 'Requester') : conversation.name} · {t(`namedConversations.audiences.${conversation.audience}`, audienceLabels[conversation.audience])}</p>}
    {item.isResolution && <p className="mb-2 text-xs font-medium">{t('namedConversations.resolution', 'Resolution')}</p>}
    {!item.deleted && <ConversationMessageDetails id={`${id}-${item.commentId}`} ticket={ticket} conversation={conversation} email={item.email} attachments={item.attachments} sharedFrom={item.sharedFrom} />}
    {item.deleted ? <p className="text-sm italic text-muted-foreground">{t('namedConversations.deleted', 'Message deleted')}</p>
      : document ? <Document id={`${id}-message-${index}`} document={document} /> : <p className="whitespace-pre-wrap break-words text-sm">{conversationText(item.note, item.markdown)}</p>}
    {item.parentCommentId && <p className="mt-2 text-xs text-muted-foreground">{t('namedConversations.reply', 'Reply')}</p>}
    {!item.deleted && <ConversationShareButton id={`${id}-message-${index}`} conversation={conversation} commentId={item.commentId} threadId={item.threadId} disabled={!replyReady} />}
    {onReply && !item.deleted && <Button id={`${id}-message-${index}-reply`} variant="ghost" size="sm" disabled={!replyReady}
      onClick={() => void onReply?.({ threadId: item.threadId, commentId: item.commentId })}>{t('namedConversations.reply', 'Reply')}</Button>}
  </article>;
}
function NamedConversationActivity({ id, ticket, refreshVersion, audiences, onReply }: {
  id: string; ticket: ConversationTicketReference; refreshVersion: number; audiences: Screen['writeAudiences'];
  onReply: (conversation: NamedTicketConversation, parent: ConversationDraftParent) => Promise<void>;
}) {
  const { t } = useTranslation('features/tickets');
  type Activity = Awaited<ReturnType<typeof actions.getNamedTicketConversationActivityAction>>;
  const [page, setPage] = useState<Activity | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const generation = useRef(0), mounted = useRef(false), pageDepth = useRef(1);
  useEffect(() => {
    mounted.current = true; const current = ++generation.current; setBusy(true);
    const read = async () => {
      const result = await actions.getNamedTicketConversationActivityAction(ticket);
      for (let depth = 1; depth < pageDepth.current && result.nextBefore; depth++) {
        if (!mounted.current || generation.current !== current) return result;
        const next = await actions.getNamedTicketConversationActivityAction(ticket, result.nextBefore);
        result.items.push(...next.items); result.nextBefore = next.nextBefore;
      }
      return result;
    };
    read().then(value => {
      if (mounted.current && generation.current === current) { setPage(value); setError(false); }
    }).catch(() => { if (mounted.current && generation.current === current) { setPage(null); setError(true); } })
      .finally(() => { if (mounted.current && generation.current === current) setBusy(false); });
    return () => { mounted.current = false; generation.current++; };
  }, [ticket, refreshVersion, version]);
  const older = async () => {
    if (busy || !page?.nextBefore) return;
    const current = generation.current; setBusy(true);
    try { const next = await actions.getNamedTicketConversationActivityAction(ticket, page.nextBefore);
      if (mounted.current && generation.current === current) { pageDepth.current++; setPage(previous => previous ? { ...next, items: [...previous.items, ...next.items] } : next); }
    } catch { if (mounted.current && generation.current === current) { setPage(null); setError(true); } }
    finally { if (mounted.current && generation.current === current) setBusy(false); }
  };
  return <section aria-label={t('namedConversations.allActivity', 'All activity')} className="space-y-4 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
    <h2 className="font-semibold">{t('namedConversations.allActivity', 'All activity')}</h2>
    {error && <div role="alert"><p>{t('namedConversations.unavailable', 'This conversation is unavailable.')}</p>
      <Button id={`${id}-activity-retry`} variant="ghost" disabled={busy} onClick={() => setVersion(value => value + 1)}>{t('namedConversations.retry', 'Retry')}</Button></div>}
    {!page && !error && <p role="status">{t('namedConversations.loading', 'Loading conversations…')}</p>}
    {page && !page.items.length && <p>{t('namedConversations.noActivity', 'No conversation activity yet.')}</p>}
    {page?.nextBefore && <Button id={`${id}-activity-older`} variant="ghost" disabled={busy} onClick={() => void older()}>{t('namedConversations.older', 'Load earlier messages')}</Button>}
    {page && [...page.items].reverse().map((item, index) => <NamedConversationMessage key={`${item.storeTenant}:${item.commentId}`} id={`${id}-activity`} index={index}
      ticket={ticket} item={item} conversation={item.conversation} label replyReady={!busy}
      onReply={audiences.includes(item.audience) ? parent => onReply(item.conversation, parent) : undefined} />)}
  </section>;
}

function NamedConversationPanel({ id, ticket, conversation, canWrite, flush, onDirty, onRefresh, onPublished, initialRecipients, onInitialRecipientsConsumed }: { id: string; ticket: ConversationTicketReference;
  conversation: NamedTicketConversation; canWrite: boolean; flush: Flush; onDirty: (dirty: boolean) => void; onRefresh: () => void; onPublished?: () => void | Promise<void>;
  initialRecipients?: string[]; onInitialRecipientsConsumed?: () => void }) {
  const { t } = useTranslation('features/tickets');
  const messageId = useConversationMessageTarget(ticket.tenant, conversation), router = useRouter(), params = useSearchParams();
  const [page, setPage] = useState<Page | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(false), [version, setVersion] = useState(0);
  const current = useRef(true), pageGeneration = useRef(0);
  const reply = useRef<((parent: ConversationDraftParent) => Promise<boolean>) | null>(null);
  const [replyReady, setReplyReady] = useState(false);
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  useEffect(() => {
    let valid = true;
    pageGeneration.current++;
    const read = messageId ? actions.getNamedTicketConversationMessagesAction(ticket, reference(conversation), undefined, messageId)
      : actions.getNamedTicketConversationMessagesAction(ticket, reference(conversation));
    read.then(value => { if (valid) { setPage(value); setError(false); } })
      .catch(() => { if (valid) { setPage(null); setError(true); onDirty(false); } });
    return () => { valid = false; };
  }, [ticket, conversation.revision, conversation.messageVersion, version, messageId]);
  const latest = () => {
    const query = new URLSearchParams(params?.toString()); query.delete('message');
    router.push(`${window.location.pathname}${query.size ? `?${query}` : ''}`, { scroll: false });
  };
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
      {'messageUnavailable' in page && page.messageUnavailable === true && <p role="alert" className="text-sm">{t('namedConversations.messageUnavailable', 'This message is unavailable in this conversation.')}</p>}
      {messageId && <Button id={`${id}-latest`} variant="ghost" size="sm" onClick={latest}>{t('namedConversations.latest', 'Show latest messages')}</Button>}
      {!('messageUnavailable' in page && page.messageUnavailable) && <ConversationReadAcknowledgment id={id} ticket={ticket} conversation={conversation}
        messages={page.items.filter(item => !item.deleted)} onChanged={onRefresh} />}
      {page.nextBefore && <Button id={`${id}-older`} size="sm" variant="ghost" disabled={busy} onClick={() => void loadMore()}>{t('namedConversations.older', 'Load earlier messages')}</Button>}
      {!page.items.length && <p className="py-8 text-center text-sm text-muted-foreground">{t('namedConversations.empty', 'Start the conversation. Keep this exchange focused on its audience.')}</p>}
      {[...page.items].reverse().map((item, index) => <NamedConversationMessage key={`${item.storeTenant}:${item.commentId}`}
        id={id} index={index} item={item} ticket={ticket} conversation={conversation} replyReady={!canWrite || replyReady}
        onReply={canWrite ? parent => reply.current?.(parent) : undefined} />)}
    </div>{canWrite && <NamedConversationComposer id={id} ticket={ticket} conversation={conversation} flush={flush} onDirty={onDirty} reply={reply} onReplyReady={setReplyReady} replyItems={page.items}
      onRefresh={onRefresh} onPosted={async () => { setVersion(n => n + 1); onRefresh(); await onPublished?.(); }}
      initialRecipients={initialRecipients} onInitialRecipientsConsumed={onInitialRecipientsConsumed} />}</>}
  </section>;
}

export function NamedConversationComposer({ id, ticket, conversation, flush, onDirty, onPosted, onRefresh, reply, onReplyReady, replyItems = [], disabled: externallyDisabled = false, showScheduledReplies = true, deliveryRefreshVersion = 0, initialRecipients, onInitialRecipientsConsumed }: { id: string; ticket: ConversationTicketReference;
  conversation: NamedTicketConversation; flush: Flush; onDirty: (dirty: boolean) => void; onPosted: () => void | Promise<void>; onRefresh?: () => void; reply?: MutableRefObject<((parent: ConversationDraftParent) => Promise<boolean>) | null>; onReplyReady?: (ready: boolean) => void; replyItems?: Page['items']; disabled?: boolean; showScheduledReplies?: boolean; deliveryRefreshVersion?: number;
  // F023: addresses collected in the creation dialog for a brand-new email
  // conversation. Consumed exactly once — only on the first `read()` when no
  // draft/email exists yet — then immediately saved as a real draft and
  // reported back via `onInitialRecipientsConsumed` so the parent clears it
  // and a later remount/reselect never reapplies a stale value.
  initialRecipients?: string[]; onInitialRecipientsConsumed?: () => void }) {
  const { t } = useTranslation('features/tickets');
  const [document, setDocument] = useState<CoManagedRichTextDocument>([]), [loaded, setLoaded] = useState(false), [epoch, setEpoch] = useState(0);
  const sharing = useConversationSharing();
  const paused = useRef(false); paused.current = Boolean(sharing?.paused);
  const disabled = externallyDisabled || Boolean(sharing?.paused);
  const isEmail = conversation.transport === 'email';
  const [email, setEmail] = useState<ConversationEmailDraft>({ subject: '', to: [], cc: [] });
  const [emailLocked, setEmailLocked] = useState(false);
  const [publicationOptions, setPublicationOptions] = useState<RequesterPublicationOptions | null>(null);
  const [canSchedule, setCanSchedule] = useState(false);
  const [deliveryRevision, setDeliveryRevision] = useState(0);
  const invalidSchedule = useRef(false);
  const [canMarkResolution, setCanMarkResolution] = useState(false);
  const [closeStatuses, setCloseStatuses] = useState<{ value: string; label: string }[]>([]);
  const [canOverrideClose, setCanOverrideClose] = useState(false);
  const [files, setFiles] = useState<ConversationEditorFile[]>([]), [fileLocked, setFileLocked] = useState(false);
  const fileLock = useRef(false);
  const lockFiles = (locked: boolean) => { fileLock.current = locked; setFileLocked(locked); };
  const emailLock = useRef(false), invalidEmail = useRef(false);
  const currentConversation = useRef(conversation); currentConversation.current = conversation;
  const lockEmail = (locked: boolean) => { emailLock.current = locked; setEmailLocked(locked); };
  const [parent, setParent] = useState<ConversationDraftParent | null>(null);
  const [saving, setSaving] = useState(false), [posting, setPosting] = useState(false), [error, setError] = useState<string | null>(null);
  const state = useRef({ revision: 0, publicationOptions: null as RequesterPublicationOptions | null, attachments: [] as ConversationEditorFile[], content: null as CoManagedConversationContent | null, generation: 0, dirty: false, alive: true, conversationRevision: conversation.revision, invalid: false, parent: null as ConversationDraftParent | null, email: null as ConversationEmailDraft | null });
  const pending = useRef<{ request: EditorDraftSaveRequest<CoManagedConversationContent>; generation: number } | null>(null);
  const flight = useRef<Promise<boolean> | null>(null);
  const postRequest = useRef<Parameters<typeof actions.postNamedTicketConversationAction>[2] | null>(null);
  const readGeneration = useRef(0);
  const read = useCallback(async () => {
    const generation = ++readGeneration.current;
    const [draft, capabilities] = await Promise.all([
      actions.getNamedConversationEditorDraftAction(ticket, reference(conversation)),
      actions.getNamedTicketConversationPublicationCapabilitiesAction(ticket, reference(conversation)),
    ]);
    const defaults = isEmail && !draft?.email ? await actions.getNamedConversationEmailDefaultsAction(ticket, reference(conversation)) : null;
    if (!state.current.alive || generation !== readGeneration.current) return;
    const content = draft?.content ?? null;
    setCanMarkResolution(capabilities.resolution); setCanSchedule(Boolean(capabilities.scheduling)); invalidSchedule.current = false;
    setCloseStatuses(capabilities.closeStatuses ?? []); setCanOverrideClose(Boolean(capabilities.canOverrideClose));
    state.current.publicationOptions = draft?.publicationOptions ?? null; setPublicationOptions(state.current.publicationOptions);
    state.current.revision = draft?.revision ?? 0; state.current.content = content;
    state.current.attachments = draft?.attachments ?? []; setFiles(state.current.attachments);
    state.current.dirty = Boolean(content && draft?.conversationRevision !== currentConversation.current.revision);
    state.current.generation++;
    state.current.parent = draft?.parent ?? null; setParent(state.current.parent);
    // F023: recipients chosen at creation seed the very first draft only —
    // once a real draft (or reply-all defaults) exists, neither this nor a
    // later remount ever overwrites it.
    const seededFromCreation = !draft?.email && Boolean(initialRecipients?.length);
    state.current.email = draft?.email ?? defaults ?? (seededFromCreation ? { subject: '', to: [...initialRecipients!], cc: [] } : null);
    setEmail(state.current.email ?? { subject: '', to: [], cc: [] });
    state.current.conversationRevision = currentConversation.current.revision;
    state.current.invalid = false; invalidEmail.current = false;
    setDocument(content?.document ?? (content?.text ? conversationDocument(content.text) ?? [] : []));
    setEpoch(n => n + 1); setLoaded(true); onDirty(Boolean(state.current.publicationOptions || state.current.attachments.length || draft?.email || state.current.parent || (content && (content.document || content.text))));
    if (seededFromCreation && state.current.alive) {
      state.current.content ??= { text: '' };
      state.current.dirty = true; state.current.generation++;
      onInitialRecipientsConsumed?.();
      void save();
    }
  }, [ticket, conversation.conversationId]);
  useEffect(() => {
    state.current.alive = true;
    read().catch(() => { if (state.current.alive) setError('unavailable'); });
    return () => { state.current.alive = false; };
  }, [read]);
  const save = useCallback((): Promise<boolean> => {
    if (paused.current || state.current.invalid || invalidEmail.current || invalidSchedule.current) return Promise.resolve(false);
    if (flight.current) return flight.current;
    const task = async () => {
      await Promise.resolve(); // Install the flight before a clean draft can resolve synchronously.
      setSaving(true);
      try {
        while (state.current.alive && (state.current.dirty || pending.current)) {
          if (paused.current) return false;
          if (!pending.current && (state.current.invalid || invalidEmail.current || invalidSchedule.current)) return false;
          pending.current ??= { generation: state.current.generation, request: { operationId: crypto.randomUUID(), expectedRevision: state.current.revision,
            expectedConversationRevision: state.current.conversationRevision, content: state.current.content, publicationOptions: state.current.publicationOptions, parent: state.current.parent, email: state.current.email, attachments: state.current.attachments.map(file => ({ attachmentId: file.attachmentId })) } };
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
    if (!state.current.alive || disabled || !loaded || posting || emailLock.current || fileLock.current || postRequest.current || !await save()) return false;
    state.current.parent = next; setParent(next);
    state.current.content ??= { text: '' };
    state.current.dirty = true; state.current.generation++;
    onDirty(Boolean(state.current.publicationOptions || state.current.attachments.length || state.current.email || next || state.current.content.document || state.current.content.text));
    const saved = await save();
    if (saved && state.current.alive) {
      const editor = window.document.getElementById(`${id}-composer`);
      editor?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      (editor?.querySelector<HTMLElement>('[contenteditable="true"]') ?? editor)?.focus();
    }
    return saved;
  }, [disabled, loaded, posting, save, id, onDirty]);
  const replyLinkError = useConversationReplyLink(!disabled && loaded && !posting && !emailLocked && !fileLocked, async target => {
    const admitted = await actions.getNamedTicketConversationReplyTargetAction(ticket, reference(conversation), target);
    return changeParent(admitted);
  });
  useEffect(() => {
    if (reply) reply.current = changeParent;
    onReplyReady?.(!disabled && loaded && !posting && !emailLocked && !fileLocked && !postRequest.current);
    return () => { if (reply?.current === changeParent) reply.current = null; onReplyReady?.(false); };
  }, [disabled, reply, changeParent, loaded, posting, emailLocked, fileLocked, error, onReplyReady]);
  useEffect(() => {
    const flushDraft = () => emailLock.current || fileLock.current ? Promise.resolve(false) : save();
    flush.current = flushDraft; return () => { if (flush.current === flushDraft) flush.current = async () => true; };
  }, [flush, save]);
  useEffect(() => {
    if (paused.current || !loaded || state.current.conversationRevision === conversation.revision) return;
    state.current.conversationRevision = conversation.revision;
    if (state.current.content) { state.current.dirty = true; state.current.generation++; void save(); }
  }, [conversation.revision, loaded, save]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (state.current.dirty || pending.current || postRequest.current || emailLock.current || fileLock.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const change = (value: CoManagedRichTextDocument) => {
    if (disabled || posting || emailLock.current || fileLock.current || postRequest.current) return;
    setDocument(value);
    let content: CoManagedConversationContent;
    try {
      snapshotConversationDocument(value, true);
      content = conversationText(JSON.stringify(value), null).trim() ? { document: snapshotConversationDocument(value) } : { text: '' };
      state.current.invalid = false;
    } catch { state.current.invalid = true; state.current.dirty = true; setError('invalid'); onDirty(true); return; }
    state.current.content = content; state.current.dirty = true; state.current.generation++;
    onDirty(Boolean(state.current.publicationOptions || state.current.attachments.length || state.current.email || state.current.parent || content.document || content.text)); void save();
  };
  const changePublicationOptions = (next: RequesterPublicationOptions | null) => {
    if (disabled || !loaded || posting || emailLock.current || fileLock.current) return;
    state.current.publicationOptions = next; setPublicationOptions(next); state.current.content ??= { text: '' };
    state.current.dirty = true; state.current.generation++;
    onDirty(Boolean(next || state.current.attachments.length || state.current.email || state.current.parent || state.current.content.text || state.current.content.document));
    void save();
  };
  // F041: lowercased addresses currently on this conversation's mailbox that
  // are NOT yet known correspondents, per the real server data contract
  // (`getNamedConversationNewCorrespondentsAction`) -- not a client-side
  // guess. Debounced so every keystroke doesn't round-trip; a stale response
  // for an identity/conversation this instance has moved on from is dropped.
  const [newCorrespondents, setNewCorrespondents] = useState<Set<string>>(new Set());
  const correspondentCheck = useRef<{ timer: ReturnType<typeof setTimeout> | null; generation: number }>({ timer: null, generation: 0 });
  useEffect(() => {
    if (!isEmail) return;
    const addresses = [...email.to, ...email.cc];
    if (correspondentCheck.current.timer) clearTimeout(correspondentCheck.current.timer);
    const generation = ++correspondentCheck.current.generation;
    correspondentCheck.current.timer = setTimeout(() => {
      actions.getNamedConversationNewCorrespondentsAction(ticket, reference(conversation), addresses).then(results => {
        if (!state.current.alive || generation !== correspondentCheck.current.generation) return;
        setNewCorrespondents(new Set(results.filter(row => row.isNew).map(row => row.email)));
      }).catch(() => {});
    }, 400);
    return () => { if (correspondentCheck.current.timer) clearTimeout(correspondentCheck.current.timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmail, email.to.join(';'), email.cc.join(';'), ticket, conversation.conversationId]);
  const changeEmail = (next: ConversationEmailDraft) => {
    if (disabled || !loaded || emailLock.current || fileLock.current) return;
    setEmail(next);
    invalidEmail.current = next.subject.length > 255 || [next.to, next.cc].some(values => values.length > 100 || values.some(value => value.length > 500 || /[\r\n\0]/.test(value)));
    if (invalidEmail.current) { state.current.dirty = true; setError('invalid'); onDirty(true); return; }
    state.current.email = next; state.current.content ??= { text: '' };
    state.current.dirty = true; state.current.generation++; onDirty(true); void save();
  };
  const reviewDraft = async () => {
    if (state.current.publicationOptions?.schedule && Date.parse(state.current.publicationOptions.schedule.at) <= Date.now()) { setError('scheduleInvalid'); return null; }
    if (disabled || !loaded || fileLock.current || !await save()) return null;
    return { operationId: crypto.randomUUID(), expectedConversationRevision: state.current.conversationRevision, expectedDraftRevision: state.current.revision };
  };
  const submit = async () => {
    if (disabled || posting || !loaded || fileLock.current || !await save() || fileLock.current) return;
    setPosting(true); setError(null);
    try {
      postRequest.current ??= { operationId: crypto.randomUUID(), expectedConversationRevision: state.current.conversationRevision,
        expectedDraftRevision: state.current.revision };
      await actions.postNamedTicketConversationAction(ticket, reference(conversation), postRequest.current);
      if (!state.current.alive) return;
      await read();
      if (!state.current.alive) return;
      postRequest.current = null; await onPosted();
    } catch { if (state.current.alive) setError('postFailed'); }
    finally { if (state.current.alive) setPosting(false); }
  };
  const parentMessage = parent ? replyItems.find(item => item.commentId === parent.commentId && item.threadId === parent.threadId) : undefined;
  let nonempty = false;
  try { snapshotConversationDocument(document); nonempty = true; } catch { /* An empty editor is a draft, not a message. */ }
  // F024: `@container` so this composer adapts to its own available width --
  // the embedded-drawer/entry-layout case an ambient viewport breakpoint
  // (`sm:`/`lg:`) cannot see, since a drawer can be narrow on a wide screen.
  return <div className="@container space-y-3 border-t border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] p-4">
    {loaded && canSchedule && showScheduledReplies && <NamedScheduledReplies id={id} ticket={ticket} conversation={conversation} revision={epoch} onChanged={() => setDeliveryRevision(value => value + 1)} disabled={disabled || posting || emailLocked || fileLocked} />}
    {replyLinkError && <p role="alert" className="text-sm text-destructive">{t('namedConversations.replyUnavailable', 'This reply target is unavailable. Your saved draft is unchanged.')}</p>}
    {/* F027: audience and transport, both explicit and together -- not just
        implied by a single heading string (the panel header above only
        repeats the conversation name/audience, not transport). */}
    <div className="flex flex-col gap-1 @sm:flex-row @sm:items-center @sm:justify-between @sm:gap-2">
      <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
        {isEmail ? <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> : <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
        <span>{isEmail ? conversation.audience === 'requester' ? t('namedConversations.requesterEmail', 'Requester email') : t('namedConversations.vendorEmail', 'Vendor email') : t('namedConversations.internalMessage', 'Internal message')}</span>
        <span className="text-muted-foreground" aria-hidden="true">·</span>
        <span className="text-xs font-normal text-muted-foreground">{t(`namedConversations.audiences.${conversation.audience}`, audienceLabels[conversation.audience])}</span>
      </h3>
      <span role="status" className="text-xs text-muted-foreground">{saving ? t('namedConversations.saving', 'Saving draft…') : loaded ? t('namedConversations.privateDraft', 'Draft visible only to you') : t('namedConversations.loading', 'Loading conversations…')}</span></div>
    {canMarkResolution && <div className="flex items-center gap-2">
      <Switch id={`${id}-resolution`} checked={Boolean(publicationOptions?.isResolution)} disabled={disabled || !loaded || posting || emailLocked || fileLocked}
        onCheckedChange={checked => changePublicationOptions(checked ? { ...publicationOptions, isResolution: true } : publicationOptions?.schedule ? { schedule: publicationOptions.schedule } : null)} />
      <Label htmlFor={`${id}-resolution`}>{t('namedConversations.markResolution', 'Mark as resolution')}</Label>
    </div>}
    {canSchedule && <div className="space-y-2">
      <div className="flex items-center gap-2"><Switch id={`${id}-schedule`} checked={Boolean(publicationOptions?.schedule)} disabled={disabled || !loaded || posting || emailLocked || fileLocked}
        onCheckedChange={checked => {
          invalidSchedule.current = false;
          changePublicationOptions(checked ? { ...(publicationOptions?.isResolution ? { isResolution: true } : {}),
            schedule: { at: new Date(Math.ceil((Date.now() + 3600000) / 60000) * 60000).toISOString(), timeZone: getUserTimeZone() } }
            : publicationOptions?.isResolution ? { isResolution: true } : null);
        }} /><Label htmlFor={`${id}-schedule`}>{t('conversation.schedule', 'Schedule')}</Label></div>
      {publicationOptions?.schedule && <>
        <ConversationSchedulePicker id={`${id}-scheduled-publish-at`} value={publicationOptions.schedule} disabled={disabled || posting || emailLocked || fileLocked}
          onChange={schedule => {
            invalidSchedule.current = !schedule;
            if (schedule) changePublicationOptions({ ...(state.current.publicationOptions?.isResolution ? { isResolution: true } : {}), schedule });
            else { state.current.dirty = true; onDirty(true); setError('scheduleInvalid'); }
          }} />
        <p className="text-xs text-muted-foreground">{t('namedConversations.scheduleKeepsStatus', 'Scheduled replies keep the current ticket status.')}</p>
      </>}
    </div>}
    {publicationOptions?.isResolution && !publicationOptions.schedule && closeStatuses.length > 0 && <CustomSelect id={`${id}-close-status`}
      label={t('namedConversations.closeStatus', 'After sending')} value={publicationOptions.close?.statusId ?? '__no_close__'}
      disabled={disabled || !loaded || posting || emailLocked || fileLocked}
      options={[{ value: '__no_close__', label: t('namedConversations.keepStatus', 'Keep the current ticket status') }, ...closeStatuses]}
      onValueChange={value => changePublicationOptions({ isResolution: true, ...(value !== '__no_close__' ? { close: { statusId: value } } : {}) })} />}
    {publicationOptions?.close && canOverrideClose && <div className="space-y-2">
      <div className="flex items-center gap-2"><Switch id={`${id}-override-close`} checked={publicationOptions.close.overrideReason !== undefined}
        disabled={disabled || posting || emailLocked || fileLocked} onCheckedChange={checked => changePublicationOptions({ isResolution: true,
          close: { statusId: publicationOptions.close!.statusId, ...(checked ? { overrideReason: '' } : {}) } })} />
        <Label htmlFor={`${id}-override-close`}>{t('namedConversations.overrideClose', 'Override unmet close rules')}</Label></div>
      {publicationOptions.close.overrideReason !== undefined && <Input id={`${id}-close-reason`} maxLength={4000}
        label={t('namedConversations.closeReason', 'Override reason')} value={publicationOptions.close.overrideReason}
        disabled={disabled || posting || emailLocked || fileLocked} onChange={event => changePublicationOptions({ isResolution: true,
          close: { statusId: publicationOptions.close!.statusId, overrideReason: event.target.value } })} />}
    </div>}
    {isEmail && <div className="space-y-3">
      <RecipientChips id={`${id}-email-to`} label={t('namedConversations.to', 'To')} value={email.to} newAddresses={newCorrespondents}
        disabled={disabled || !loaded || emailLocked || fileLocked} onChange={next => changeEmail({ ...email, to: next })} />
      <RecipientChips id={`${id}-email-cc`} label={t('namedConversations.cc', 'CC')} value={email.cc} newAddresses={newCorrespondents}
        disabled={disabled || !loaded || emailLocked || fileLocked} onChange={next => changeEmail({ ...email, cc: next })} />
      <p className="text-xs text-muted-foreground">{t('namedConversations.addressHelp', 'Press Enter, comma or semicolon to add a recipient.')}</p>
      <Input id={`${id}-email-subject`} label={t('namedConversations.subject', 'Subject')} value={email.subject} disabled={disabled || !loaded || emailLocked || fileLocked} maxLength={255} onChange={event => changeEmail({ ...email, subject: event.target.value })} />
    </div>}
    {parent && <div className="flex items-center justify-between gap-2 rounded-md border border-[rgb(var(--color-border-200))] px-3 py-2 text-sm">
      <div className="min-w-0"><p>{t('namedConversations.replying', 'Replying to a message in this conversation')}</p>
        {parentMessage && <p className="mt-1 truncate text-xs text-muted-foreground">{parentMessage.author?.displayName ? `${parentMessage.author.displayName}: ` : ''}{parentMessage.deleted ? t('namedConversations.deleted', 'Message deleted') : conversationText(parentMessage.note, parentMessage.markdown)}</p>}
      </div>
      <Button id={`${id}-clear-reply`} variant="ghost" size="sm" disabled={disabled || posting || emailLocked || fileLocked || Boolean(postRequest.current)} onClick={() => void changeParent(null)}>{t('namedConversations.clearReply', 'New message instead')}</Button>
    </div>}
    {loaded && <Document key={epoch} id={`${id}-composer`} document={document} editable={!disabled && !posting && !emailLocked && !fileLocked && !postRequest.current} onChange={change} />}
    {loaded && <ConversationDraftFiles id={id} ticket={ticket} conversation={reference(conversation)} files={files}
      disabled={disabled || posting || emailLocked || Boolean(postRequest.current)} onLock={lockFiles} onChange={async next => {
        if (disabled || emailLock.current || posting || postRequest.current) return false;
        state.current.attachments = next; setFiles(next); state.current.content ??= { text: '' };
        state.current.dirty = true; state.current.generation++; onDirty(true);
        return save();
      }} />}
    {error && <p role="alert" className="text-sm text-destructive">{t(`namedConversations.${error}`, error === 'saveFailed' ? 'Could not save. Retry before switching conversations.' : error === 'postFailed' ? 'Could not confirm the post. Retry to check the same message.' : error === 'scheduleInvalid' ? 'Choose a future publication time before reviewing this email.' : error === 'invalid' ? 'This draft contains unsupported content. Edit it before saving.' : 'This conversation is unavailable.')}</p>}
    {isEmail && loaded && <ConversationEmailControls id={id} refreshVersion={deliveryRefreshVersion + deliveryRevision} ticket={ticket} conversation={conversation} closeStatuses={closeStatuses} ready={!disabled && !fileLocked && !invalidSchedule.current && (!publicationOptions?.schedule || Date.parse(publicationOptions.schedule.at) > Date.now()) && nonempty && Boolean(email.subject.trim()) && email.to.some(value => value.trim())}
      saveDraft={reviewDraft} onLock={lockEmail} onMailbox={value => { state.current.conversationRevision = value.revision; if (state.current.content) { state.current.dirty = true; state.current.generation++; } onRefresh?.(); }} onSent={async () => { await read(); await onPosted(); }} />}
    <div className="flex flex-wrap items-center gap-2">{!isEmail && <Button id={`${id}-post`} disabled={disabled || !loaded || !nonempty || posting || fileLocked} onClick={() => void submit()}>{postRequest.current ? t('namedConversations.retryPost', 'Retry post') : t('namedConversations.post', 'Post')}</Button>}
      {error === 'saveFailed' && <Button id={`${id}-save-retry`} variant="outline" disabled={saving} onClick={() => void save()}>{t('namedConversations.retry', 'Retry')}</Button>}
      <span className="text-xs text-muted-foreground">{t(`namedConversations.audiences.${conversation.audience}`, audienceLabels[conversation.audience])}</span></div>
  </div>;
}

// F041: chip/token recipient editor replacing the old semicolon-joined text
// input. Each committed address is its own removable chip; addresses the
// server (`newAddresses`, from `getNamedConversationNewCorrespondentsAction`)
// hasn't seen accepted on this conversation's mailbox before are highlighted
// so a sender notices them before Send, without blocking entry -- editing an
// individual address is just removing its chip and retyping it.
function RecipientChips({ id, label, value, onChange, disabled, newAddresses }: { id: string; label: string; value: string[];
  onChange: (next: string[]) => void; disabled: boolean; newAddresses: Set<string> }) {
  const { t } = useTranslation('features/tickets');
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = (raw: string) => {
    const text = raw.trim();
    if (!text) { setDraft(''); return; }
    onChange([...value, text]);
    setDraft('');
  };
  const remove = (index: number) => onChange(value.filter((_, item) => item !== index));
  return <div>
    <Label htmlFor={`${id}-input`}>{label}</Label>
    <div id={id} className={`mt-1 flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-2 py-1 ${disabled ? 'opacity-60' : 'cursor-text'}`}
      onClick={() => inputRef.current?.focus()}>
      {value.map((address, index) => {
        const trimmed = address.trim();
        const isNew = trimmed.length > 0 && newAddresses.has(trimmed.toLowerCase());
        return <span key={`${trimmed || 'empty'}-${index}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${isNew
          ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200' : 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-700))]'}`}>
          {isNew && <span aria-hidden="true" title={t('namedConversations.newCorrespondent', 'New correspondent')}>●</span>}
          <span>{trimmed || address}</span>
          {isNew && <span className="sr-only">{t('namedConversations.newCorrespondent', 'New correspondent')}</span>}
          {!disabled && <button type="button" id={`${id}-remove-${index}`} aria-label={t('namedConversations.removeRecipient', { defaultValue: 'Remove {{address}}', address: trimmed || address })}
            onClick={event => { event.stopPropagation(); remove(index); }} className="rounded-full text-current/70 hover:text-current">×</button>}
        </span>;
      })}
      <input ref={inputRef} id={`${id}-input`} disabled={disabled} value={draft} autoComplete="off"
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ',' || event.key === ';') { event.preventDefault(); commit(draft); }
          else if (event.key === 'Backspace' && !draft && value.length) { event.preventDefault(); remove(value.length - 1); }
        }}
        onBlur={() => commit(draft)}
        className="min-w-[10rem] flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        placeholder={value.length ? '' : t('namedConversations.recipientsPlaceholder', 'name@example.com, name2@example.com')} />
    </div>
  </div>;
}
