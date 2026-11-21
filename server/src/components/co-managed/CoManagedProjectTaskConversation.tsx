'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoManagedSharedResource, CoManagedConversationCursor } from '@alga-psa/co-managed';
import type { CoManagedTaskConversationItem, CoManagedTaskCommentCommand } from '@alga-psa/co-managed/projectTaskConversation';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getSharedProjectTaskConversationAction, saveSharedProjectTaskCommentAction } from '@/lib/actions/coManagedProjectTaskConversationActions';
import { conversationText } from './conversationText';
import { newCoManagedOperationId } from './coManagedOperationId';

type Screen = Awaited<ReturnType<typeof getSharedProjectTaskConversationAction>>;
type Audience = Screen['writeAudiences'][number];
type Draft = { kind: 'new' } | { kind: 'reply' | 'edit' | 'delete'; item: CoManagedTaskConversationItem };
const reference = (item: CoManagedTaskConversationItem) => ({ storeTenant: item.storeTenant, threadId: item.threadId, commentId: item.commentId });
const paragraph = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }];

const AUDIENCE_LABELS: Record<Audience, string> = {
  requester: 'Requester and IT',
  shared_it: 'Shared with IT teams',
  organization_private: 'Our organization only',
};

/**
 * Qualified conversation on a shared task: each comment names its author and organisation, carries its
 * audience, and a deleted comment stays as a tombstone so replies keep their parent. A stale edit or
 * delete is refused (revision), never merged. Attachments and thread disclosure arrive with L4b.
 */
function Composer({ resource, audiences, draft, onSaved, onCancel, onUnavailable }: {
  resource: CoManagedSharedResource; audiences: Audience[]; draft: Draft; onSaved: () => void; onCancel: () => void; onUnavailable: () => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [audience, setAudience] = useState<Audience>(draft.kind === 'new' ? (audiences.includes('shared_it') ? 'shared_it' : audiences[0]) : draft.item.audience);
  const [text, setText] = useState(draft.kind === 'edit' ? conversationText(draft.item.note, draft.item.markdown) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One operation id per logical attempt so a lost response retries idempotently.
  const saved = useRef<CoManagedTaskCommentCommand | null>(null);
  const allowed = audiences.includes(audience);
  const conflict = error === 'conflict' || error === 'operationConflict';

  async function submit() {
    if (busy || !allowed || conflict || (draft.kind !== 'delete' && !text.trim())) return;
    setBusy(true); setError(null);
    if (!saved.current) {
      const operationId = newCoManagedOperationId(), document = paragraph(text.trim());
      saved.current = draft.kind === 'new' ? { kind: 'create', operationId, audience, document }
        : draft.kind === 'reply' ? { kind: 'create', operationId, parent: reference(draft.item), expectedAudience: audience, document }
        : draft.kind === 'edit' ? { kind: 'edit', operationId, comment: reference(draft.item), expectedRevision: draft.item.revision!, document }
        : { kind: 'delete', operationId, comment: reference(draft.item), expectedRevision: draft.item.revision! };
    }
    try {
      const result = await saveSharedProjectTaskCommentAction(resource, saved.current);
      if (result.ok) onSaved();
      else if (result.code === 'forbidden' || result.code === 'readOnly') onUnavailable();
      else { setError(result.code); if (result.code === 'invalid') saved.current = null; }
    } catch { setError('unknownOutcome'); }
    finally { setBusy(false); }
  }

  return <form aria-busy={busy} className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4"
    onSubmit={event => { event.preventDefault(); void submit(); }}>
    {draft.kind === 'new'
      ? <CustomSelect id="co-task-conversation-audience" label={t('coManaged.conversation.audience', { defaultValue: 'Audience' })} value={audience} disabled={busy || conflict}
          options={audiences.map(value => ({ value, label: t(`coManaged.conversation.audiences.${value}`, { defaultValue: AUDIENCE_LABELS[value] }) }))}
          onValueChange={value => setAudience(value as Audience)} />
      : <p className="text-sm font-medium">{t(`coManaged.conversation.audiences.${audience}`, { defaultValue: AUDIENCE_LABELS[audience] })}</p>}
    {draft.kind === 'delete'
      ? <p>{t('coManaged.conversation.deleteHelp', { defaultValue: 'The comment is replaced by a deleted marker. Replies stay in the thread.' })}</p>
      : <TextArea id="co-task-conversation-message" label={t('coManaged.conversation.message', { defaultValue: 'Message' })} value={text} disabled={busy || conflict}
          onChange={event => setText(event.target.value)} />}
    {error && <Alert variant="destructive"><AlertDescription id="co-task-conversation-error" role="alert">
      {error === 'conflict' || error === 'operationConflict'
        ? t('coManaged.conversation.conflict', { defaultValue: 'This comment changed since you opened it. Cancel and reload to continue.' })
        : error === 'unknownOutcome'
          ? t('coManaged.conversation.unknownOutcome', { defaultValue: 'We could not confirm the save. Try again; it will not be applied twice.' })
          : t('coManaged.conversation.invalid', { defaultValue: 'This comment could not be saved.' })}</AlertDescription></Alert>}
    <div className="flex gap-2">
      <Button id="co-task-conversation-submit" type="submit" disabled={busy || conflict || !allowed || (draft.kind !== 'delete' && !text.trim())}>
        {draft.kind === 'delete' ? t('coManaged.conversation.delete', { defaultValue: 'Delete' }) : t('coManaged.conversation.send', { defaultValue: 'Send' })}</Button>
      <Button id="co-task-conversation-cancel" type="button" variant="outline" disabled={busy} onClick={onCancel}>{t('coManaged.conversation.cancel', { defaultValue: 'Cancel' })}</Button>
    </div>
  </form>;
}

export default function CoManagedProjectTaskConversation({ resource: input, onUnavailable }: { resource: CoManagedSharedResource; onUnavailable?: () => void }) {
  // Callers build the resource inline; key on its fields so a re-render never refetches.
  const resource = useMemo(() => input, [input.kind, input.tenant, input.relationshipId, input.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { t } = useTranslation('msp/licensing'), { formatDate } = useFormatters();
  const [state, setState] = useState<Screen | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftId, setDraftId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const cursors = useRef<Array<CoManagedConversationCursor | undefined>>([undefined]);
  const generation = useRef(0), mounted = useRef(false);

  const refresh = useCallback(async (clear = false) => {
    const current = ++generation.current;
    setBusy(true);
    if (clear) { setState(null); setDraft(null); }
    try {
      const page = await getSharedProjectTaskConversationAction(resource, cursors.current.at(-1));
      if (!mounted.current || current !== generation.current) return;
      setState(page); setError(false);
    } catch {
      if (mounted.current && current === generation.current) { setState(null); setDraft(null); setError(true); onUnavailable?.(); }
    } finally { if (mounted.current && current === generation.current) setBusy(false); }
  }, [resource, onUnavailable]);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; generation.current++; }; }, [refresh]);
  const open = (value: Draft) => { setDraft(value); setDraftId(id => id + 1); };

  return <section className="space-y-4" aria-labelledby="co-task-conversation-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="co-task-conversation-title" className="font-semibold">{t('coManaged.conversation.title', { defaultValue: 'Conversation' })}</h2>
      <Button id="co-task-conversation-refresh" variant="outline" disabled={busy || Boolean(draft)} onClick={() => void refresh(true)}>
        {t('coManaged.conversation.reload', { defaultValue: 'Reload' })}</Button>
    </div>
    {error && <Alert variant="destructive"><AlertDescription role="alert">{t('coManaged.conversation.loadError', { defaultValue: 'The conversation could not be loaded.' })}</AlertDescription></Alert>}
    {!state && busy && <p role="status">{t('coManaged.loading')}</p>}
    {state && <>
      {!state.writeAudiences.length && <p role="status">{t('coManaged.conversation.readOnly', { defaultValue: 'You can read this conversation but not add to it.' })}</p>}
      {state.writeAudiences.length > 0 && !draft && <Button id="co-task-conversation-new" onClick={() => open({ kind: 'new' })}>
        {t('coManaged.conversation.new', { defaultValue: 'New comment' })}</Button>}
      {draft && <Composer key={draftId} resource={resource} audiences={state.writeAudiences} draft={draft}
        onUnavailable={() => { setState(null); setDraft(null); setError(true); onUnavailable?.(); }}
        onSaved={() => { setDraft(null); cursors.current = [undefined]; void refresh(true); }} onCancel={() => { setDraft(null); void refresh(true); }} />}
      {!state.items.length && <p className="text-sm text-muted-foreground">{t('coManaged.conversation.empty', { defaultValue: 'No comments yet.' })}</p>}
      <ol className="space-y-3">{state.items.map(item => {
        const id = `co-task-comment-${item.storeTenant}-${item.commentId}`;
        // Own-ness is decided from the verified actor the server returned, never from a client-held id.
        const own = item.author?.kind === 'user' && item.author.tenant === state.actor.tenant && item.author.id === state.actor.userId;
        const writable = !item.deleted && item.revision !== null && state.writeAudiences.includes(item.audience);
        return <li key={id} id={id} className="space-y-2 rounded-lg border border-[rgb(var(--color-border-200))] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{item.author?.displayName || t('coManaged.conversation.restrictedAuthor', { defaultValue: 'Author hidden' })}
              {item.author?.organizationName && <span className="font-normal text-muted-foreground"> · {item.author.organizationName}</span>}</p>
            <Badge variant="outline">{t(`coManaged.conversation.audiences.${item.audience}`, { defaultValue: AUDIENCE_LABELS[item.audience] })}</Badge>
          </div>
          <p className="text-xs text-muted-foreground"><time dateTime={item.createdAt}>{formatDate(new Date(item.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</time>
            {item.parentCommentId && <span> · {t('coManaged.conversation.replyMarker', { defaultValue: 'Reply' })}</span>}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{item.deleted
            ? t('coManaged.conversation.deleted', { defaultValue: 'This comment was deleted.' }) : conversationText(item.note, item.markdown)}</p>
          {writable && !draft && <div className="flex gap-2">
            {item.canReply && <Button id={`${id}-reply`} variant="ghost" size="sm" onClick={() => open({ kind: 'reply', item })}>{t('coManaged.conversation.reply', { defaultValue: 'Reply' })}</Button>}
            {own && <Button id={`${id}-edit`} variant="ghost" size="sm" onClick={() => open({ kind: 'edit', item })}>{t('coManaged.conversation.edit', { defaultValue: 'Edit' })}</Button>}
            {own && <Button id={`${id}-delete`} variant="ghost" size="sm" onClick={() => open({ kind: 'delete', item })}>{t('coManaged.conversation.delete', { defaultValue: 'Delete' })}</Button>}
          </div>}
        </li>;
      })}</ol>
      <div className="flex gap-2">
        {cursors.current.length > 1 && <Button id="co-task-conversation-newer" variant="outline" disabled={busy || Boolean(draft)}
          onClick={() => { cursors.current.pop(); void refresh(true); }}>{t('coManaged.conversation.newer', { defaultValue: 'Newer' })}</Button>}
        {state.nextBefore && <Button id="co-task-conversation-older" variant="outline" disabled={busy || Boolean(draft)}
          onClick={() => { cursors.current.push(state.nextBefore!); void refresh(true); }}>{t('coManaged.conversation.older', { defaultValue: 'Older' })}</Button>}
      </div>
    </>}
  </section>;
}
