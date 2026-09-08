'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ConversationTicketReference, NamedTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { NamedConversationShareRequest } from '../../../lib/prepareNamedConversationShare';
import type { ConversationShareSelection } from './ConversationSharingContext';
import * as actions from '../../../actions/namedTicketConversationActions';
import { conversationText } from './conversationText';

type Screen = Awaited<ReturnType<typeof actions.getNamedTicketConversationScreenAction>>;
type Page = Awaited<ReturnType<typeof actions.getNamedTicketConversationMessagesAction>>;
type Draft = Awaited<ReturnType<typeof actions.getNamedConversationEditorDraftAction>>;
const keyOf = (value: { storeTenant: string; conversationId: string }) => `${value.storeTenant}:${value.conversationId}`;
const refOf = (value: NamedTicketConversation) => ({ storeTenant: value.storeTenant, conversationId: value.conversationId });
const labels = { requester: 'Requester', shared_it: 'Shared IT', organization_private: 'Your organization only' };
const addresses = (text: string) => text.split(/[;\n]+/).map(value => value.trim()).filter(Boolean);

/** Mounted only after the current editor has flushed. The host pauses that
 * editor until this dialog closes, then remounts it from its private saved draft. */
export function ConversationShareDialog({ id, ticket, selection, onClose, onOpen }: {
  id: string; ticket: ConversationTicketReference; selection: ConversationShareSelection;
  onClose: () => void; onOpen: (conversation: NamedTicketConversation) => void;
}) {
  const { t } = useTranslation('features/tickets');
  const [screen, setScreen] = useState<Screen | null>(null), [source, setSource] = useState<Page | null>(null);
  const [destination, setDestination] = useState(''), [target, setTarget] = useState<{ conversation: NamedTicketConversation; draft: Draft } | null>(null);
  const [created, setCreated] = useState<NamedTicketConversation | null>(null);
  const [name, setName] = useState(''), [audience, setAudience] = useState<NamedTicketConversation['audience']>('requester');
  const [transport, setTransport] = useState<'internal' | 'email'>('email'), [to, setTo] = useState(''), [cc, setCc] = useState('');
  const [quote, setQuote] = useState(false), [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [loadingTarget, setLoadingTarget] = useState(false);
  const [error, setError] = useState<'load' | 'target' | 'conflict' | 'invalid' | 'unavailable' | 'unknown' | null>(null);
  const [reload, setReload] = useState(0);
  const alive = useRef(false), flight = useRef(false), targetGeneration = useRef(0);
  const pendingCreate = useRef<Parameters<typeof actions.createNamedTicketConversationAction>[1] | null>(null);
  const pendingShare = useRef<{ target: NamedTicketConversation; request: NamedConversationShareRequest } | null>(null);
  const sourceMessage = source?.items.find(item => item.commentId === selection.commentId && item.threadId === selection.threadId && !item.deleted);
  const candidates = screen?.conversations.filter(value => screen.writeAudiences.includes(value.audience)) ?? [];
  const isNew = destination === '__new__';
  const existingDraft = target?.draft?.content != null;
  const frozen = busy || Boolean(pendingShare.current) || Boolean(pendingCreate.current && !created);

  useEffect(() => { alive.current = true; return () => { alive.current = false; targetGeneration.current++; }; }, []);
  useEffect(() => {
    let current = true; setScreen(null); setSource(null); setError(null);
    Promise.all([actions.getNamedTicketConversationScreenAction(ticket),
      actions.getNamedTicketConversationMessagesAction(ticket, selection.conversation, undefined, selection.commentId)])
      .then(([next, page]) => {
        if (!current) return;
        if (('messageUnavailable' in page && page.messageUnavailable) || !page.items.some(item => item.commentId === selection.commentId && item.threadId === selection.threadId && !item.deleted) ||
          keyOf(page.conversation) !== keyOf(selection.conversation)) throw new Error('Unavailable source');
        setScreen(next); setSource(page);
        const destinations = next.conversations.filter(value => next.writeAudiences.includes(value.audience));
        setDestination(keyOf(destinations.find(value => value.defaultSlot === 'requester') ?? destinations[0] ?? { storeTenant: '', conversationId: '' }));
        const initial = next.writeAudiences.includes('requester') ? 'requester' : next.writeAudiences[0];
        if (initial) { setAudience(initial); setTransport(initial === 'requester' ? 'email' : 'internal'); }
      }).catch(() => { if (current) { setSource(null); setScreen(null); setError('load'); } });
    return () => { current = false; };
  }, [ticket, selection, reload]);

  const loadTarget = async (conversation: NamedTicketConversation) => {
    const generation = ++targetGeneration.current; setLoadingTarget(true); setTarget(null);
    try {
      const [current, draft] = await Promise.all([actions.getNamedTicketConversationAction(ticket, refOf(conversation)),
        actions.getNamedConversationEditorDraftAction(ticket, refOf(conversation))]);
      if (alive.current && generation === targetGeneration.current) {
        if (keyOf(current) !== keyOf(conversation) || current.ticket.tenant !== ticket.tenant || current.ticket.ticketId !== ticket.ticketId) throw new Error('Unavailable destination');
        setTarget({ conversation: current, draft }); setError(null); pendingShare.current = null;
      }
    } catch { if (alive.current && generation === targetGeneration.current) setError('target'); }
    finally { if (alive.current && generation === targetGeneration.current) setLoadingTarget(false); }
  };
  useEffect(() => {
    targetGeneration.current++; setTarget(null); setLoadingTarget(false);
    const candidate = created ?? candidates.find(value => keyOf(value) === destination);
    if (candidate) void loadTarget(candidate);
  }, [destination, screen]);

  const submit = async () => {
    if (flight.current || !sourceMessage || !screen || loadingTarget) return;
    if (isNew && !created && (!name.trim() || !screen.writeAudiences.includes(audience) || (transport === 'email' && !addresses(to).length))) return;
    if (!isNew && !target) return;
    flight.current = true; setBusy(true); setError(null);
    try {
      let selected = target;
      if (isNew && !created) {
        pendingCreate.current ??= { operationId: crypto.randomUUID(), name: name.trim(), audience, transport };
        const conversation = await actions.createNamedTicketConversationAction(ticket, pendingCreate.current);
        if (!alive.current) return;
        setCreated(conversation);
        selected = { conversation, draft: null };
        setTarget(selected);
      }
      if (!selected) return;
      pendingShare.current ??= { target: selected.conversation, request: { operationId: crypto.randomUUID(), source: selection.conversation,
        commentId: selection.commentId, threadId: selection.threadId, expectedDraftRevision: selected.draft?.revision ?? 0,
        expectedConversationRevision: selected.conversation.revision, replaceExisting: selected.draft?.content != null, quote,
        attachments: files.map(attachmentId => ({ attachmentId })),
        ...(isNew && transport === 'email' ? { email: { subject: name.trim(), to: addresses(to), cc: addresses(cc) } } : {}) } };
      const pending = pendingShare.current;
      const result = await actions.prepareNamedConversationShareAction(ticket, refOf(pending.target), pending.request);
      if (!alive.current) return;
      if (result.ok) onOpen(pending.target);
      else {
        setError(result.code);
        if (result.code === 'unavailable') { setSource(null); setScreen(null); setTarget(null); }
      }
    } catch { if (alive.current) setError('unknown'); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  };
  const errorMessages = {
    load: 'This message is unavailable. Refresh to check your access.', target: 'This destination is unavailable. Choose another conversation or retry.',
    conflict: 'The destination draft or conversation changed. Reload it before preparing a copy.',
    invalid: 'Check the recipients and selected files, then reload the destination to try again.',
    unavailable: 'The source or destination is no longer available. Refresh to check your access.',
    unknown: 'Could not confirm preparation. Retry the same request, or open the destination to check its draft.',
  };
  const canSubmit = sourceMessage && !loadingTarget && (target || (isNew && !created && name.trim() && (transport !== 'email' || addresses(to).length)));
  return <Dialog id={`${id}-share-dialog`} isOpen onClose={() => { if (!busy) onClose(); }} title={t('namedConversations.share.title', 'Share message')}
    footer={<><Button id={`${id}-share-cancel`} variant="outline" disabled={busy} onClick={onClose}>{t('namedConversations.cancel', 'Cancel')}</Button>
      {target && (existingDraft || error) && <Button id={`${id}-share-open-existing`} variant="outline" disabled={busy}
        onClick={() => onOpen(target.conversation)}>{t('namedConversations.share.openDraft', 'Open existing draft')}</Button>}
      {sourceMessage && <Button id={`${id}-share-prepare`} disabled={busy || !canSubmit || ['conflict', 'invalid', 'target'].includes(error ?? '')} onClick={() => void submit()}>
        {busy ? t('namedConversations.share.preparing', 'Preparing…') : pendingShare.current || pendingCreate.current && !created
          ? t('namedConversations.share.retry', 'Retry preparation') : existingDraft
          ? t('namedConversations.share.replace', 'Replace draft and prepare copy') : t('namedConversations.share.prepare', 'Prepare draft')}</Button>}</>}>
    <DialogContent><div className="space-y-4">
      {!source && !error && <p role="status">{t('namedConversations.loading', 'Loading conversations…')}</p>}
      {sourceMessage && source && screen && <>
        <div className="rounded-md bg-[rgb(var(--color-background))] p-3 text-sm">
          <p className="font-medium">{t('namedConversations.share.from', 'From conversation')}: {source.conversation.name}</p>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-muted-foreground">{conversationText(sourceMessage.note, sourceMessage.markdown)}</p>
        </div>
        <CustomSelect id={`${id}-share-destination`} label={t('namedConversations.share.destination', 'Destination')} value={destination} disabled={frozen || Boolean(created)}
          options={[...candidates.map(value => ({ value: keyOf(value), label: `${value.defaultSlot === 'requester' ? t('namedConversations.requester', 'Requester') : value.name} · ${t(`namedConversations.audiences.${value.audience}`, labels[value.audience])}` })),
            ...(screen.writeAudiences.length ? [{ value: '__new__', label: t('namedConversations.share.new', 'New conversation…') }] : [])]}
          onValueChange={value => { setDestination(value); setError(null); }} />
        {isNew && <div className="space-y-3 rounded-md border border-[rgb(var(--color-border-200))] p-3">
          <Input id={`${id}-share-name`} label={t('namedConversations.name', 'Name')} value={name} maxLength={160} disabled={frozen || Boolean(created)} onChange={event => setName(event.target.value)} />
          <CustomSelect id={`${id}-share-audience`} label={t('namedConversations.audience', 'Visible to')} value={audience} disabled={frozen || Boolean(created)}
            options={screen.writeAudiences.map(value => ({ value, label: t(`namedConversations.audiences.${value}`, labels[value]) }))}
            onValueChange={value => { setAudience(value as typeof audience); setTransport(value === 'requester' ? 'email' : 'internal'); }} />
          {audience !== 'requester' && <CustomSelect id={`${id}-share-transport`} label={t('namedConversations.kind', 'Conversation type')} value={transport} disabled={frozen || Boolean(created)}
            options={[{ value: 'internal', label: t('namedConversations.internalMessage', 'Internal message') }, { value: 'email', label: t('namedConversations.externalEmail', 'External email') }]}
            onValueChange={value => setTransport(value as typeof transport)} />}
          {transport === 'email' && <><Input id={`${id}-share-to`} label={t('namedConversations.to', 'To')} value={to} disabled={frozen} onChange={event => setTo(event.target.value)} />
            <Input id={`${id}-share-cc`} label={t('namedConversations.cc', 'CC')} value={cc} disabled={frozen} onChange={event => setCc(event.target.value)} />
            <p className="text-xs text-muted-foreground">{t('namedConversations.share.recipientsHelp', 'Separate recipients with semicolons. Choose a sending mailbox and review the email in the destination draft.')}</p></>}
        </div>}
        {loadingTarget && <p role="status" className="text-sm">{t('namedConversations.share.loadingDraft', 'Checking the destination draft…')}</p>}
        {existingDraft && <div role="status" className="rounded-md border border-[rgb(var(--color-border-200))] p-3 text-sm">
          <p className="font-medium">{t('namedConversations.share.existingDraft', 'You already have a draft here.')}</p>
          <p>{t('namedConversations.share.existingHelp', 'Open it to keep working, or explicitly replace it with this copy.')}</p>
        </div>}
        <Checkbox id={`${id}-share-quote`} label={t('namedConversations.share.quote', 'Format as a quote')} checked={quote} disabled={frozen} onChange={event => setQuote(event.target.checked)} />
        {Boolean(sourceMessage.attachments?.length) && <fieldset className="space-y-2" disabled={frozen}>
          <legend className="mb-2 text-sm font-medium">{t('namedConversations.share.files', 'Choose attachments to copy')}</legend>
          {sourceMessage.attachments!.map(file => <Checkbox key={file.attachmentId} id={`${id}-share-file-${file.attachmentId}`} label={file.fileName}
            checked={files.includes(file.attachmentId)} onChange={event => setFiles(current => event.target.checked ? [...current, file.attachmentId] : current.filter(id => id !== file.attachmentId))} />)}
        </fieldset>}
        <p className="text-sm text-muted-foreground">{t('namedConversations.share.reviewHelp', 'The copy stays private until you review it and choose Send or Post in the destination conversation.')}</p>
      </>}
      {error && <div role="alert" className="space-y-2 text-sm"><p>{t(`namedConversations.share.errors.${error}`, errorMessages[error])}</p>
        {['load', 'unavailable'].includes(error) ? <Button id={`${id}-share-reload`} variant="ghost" disabled={busy} onClick={() => {
          pendingShare.current = null; pendingCreate.current = null; setCreated(null); setTarget(null); setFiles([]); setReload(value => value + 1);
        }}>{t('namedConversations.retry', 'Retry')}</Button> : (target || created || candidates.find(value => keyOf(value) === destination)) && <Button id={`${id}-share-reload-target`} variant="ghost" disabled={busy || loadingTarget}
          onClick={() => void loadTarget(target?.conversation ?? created ?? candidates.find(value => keyOf(value) === destination)!)}>{t('namedConversations.share.reloadDraft', 'Reload destination draft')}</Button>}
      </div>}
    </div></DialogContent>
  </Dialog>;
}
