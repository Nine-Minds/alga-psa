'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ConversationTicketReference, NamedTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { NamedConversationAiRequest } from '../../../lib/invokeNamedConversationAi';
import * as actions from '../../../actions/conversationAiActions';
import { requestConversationAi } from './conversationAiRequest';

type Sources = Extract<Awaited<ReturnType<typeof actions.getConversationAiSourcesAction>>, { ok: true }>['sources'];
const keyOf = (ref: Sources[number]) => `${ref.storeTenant}:${ref.conversationId}`;

/** Identity-keyed by the host. The normal composer is flushed and paused while
 * open; this prompt never replaces its private draft. Only reviewed, admitted
 * source references are submitted, and the server repeats audience admission. */
export function ConversationAiDialog({ id, ticket, conversation, onClose }: {
  id: string; ticket: ConversationTicketReference; conversation: NamedTicketConversation; onClose: () => void;
}) {
  const { t } = useTranslation('features/tickets');
  const [sources, setSources] = useState<Sources | null>(null), [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState(''), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [denied, setDenied] = useState(false);
  const [waiting, setWaiting] = useState(false), [cancelling, setCancelling] = useState(false);
  const alive = useRef(true), cancellingRef = useRef(false), inFlight = useRef(false);
  const pending = useRef<NamedConversationAiRequest | null>(null);
  const destination = { storeTenant: conversation.storeTenant, conversationId: conversation.conversationId };
  const failure = (code: string) => {
    if (code === 'unavailable') { setSources(null); setSelected([]); setPrompt(''); setDenied(true); }
    setError(code); setWaiting(false); setUncertain(code === 'unknown');
    // Known failures did not publish. Retrying is a new explicit invocation.
    if (code !== 'unknown') pending.current = null;
  };
  useEffect(() => {
    alive.current = true;
    void actions.getConversationAiSourcesAction(ticket, destination).then(result => {
      if (!alive.current) return;
      if (result.ok) { setSources(result.sources); setSelected(result.sources.map(keyOf)); }
      else failure(result.code);
    }).catch(() => { if (alive.current) failure('unavailable'); });
    return () => { alive.current = false; };
  }, []);
  const receive = (result: Awaited<ReturnType<typeof actions.getNamedConversationAiStatusAction>>) => {
    if (!alive.current || cancellingRef.current) return;
    if (!result.ok) { failure(result.code); return; }
    if (result.result.status === 'completed') { pending.current = null; onClose(); }
    else if (result.result.status === 'running') { setWaiting(true); setUncertain(false); }
    else { pending.current = null; setWaiting(false); setUncertain(false); setError(result.result.status === 'cancelled' ? 'AI_CANCELLED' : 'AI_UNAVAILABLE'); }
  };
  useEffect(() => {
    if (!waiting) return;
    let active = true, polling = false;
    const timer = window.setInterval(async () => {
      if (!active || polling || !pending.current || cancellingRef.current) return;
      polling = true;
      try { const result = await actions.getNamedConversationAiStatusAction(ticket, destination, pending.current.operationId); if (active) receive(result); }
      catch { if (active) failure('unknown'); }
      finally { polling = false; }
    }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [waiting]);
  const submit = async () => {
    if (inFlight.current || waiting || cancellingRef.current || denied || !sources || !prompt.trim()) return;
    inFlight.current = true; setBusy(true); setError(null);
    pending.current ??= { operationId: crypto.randomUUID(), expectedConversationRevision: conversation.revision, prompt: prompt.trim(),
      sources: sources.filter(source => selected.includes(keyOf(source))).map(({ storeTenant, conversationId }) => ({ storeTenant, conversationId })) };
    try { receive(await requestConversationAi(ticket, destination, pending.current)); }
    catch { if (alive.current && !cancellingRef.current) failure('unknown'); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const close = async () => {
    if (cancellingRef.current) return;
    if (!pending.current) { onClose(); return; }
    cancellingRef.current = true; setCancelling(true);
    try {
      const result = await actions.cancelNamedConversationAiAction(ticket, destination, pending.current.operationId);
      if (!alive.current) return;
      if (result.ok) { pending.current = null; onClose(); }
      else { cancellingRef.current = false; failure(result.code); }
    } catch { if (alive.current) { cancellingRef.current = false; failure('unknown'); } }
    finally { if (alive.current) setCancelling(false); }
  };
  const locked = busy || waiting || uncertain || cancelling;
  const errorText = error === 'AI_CONTEXT_TOO_LARGE' ? t('namedConversations.ai.contextTooLarge', 'The selected context exceeds the available AI capacity. Narrow the source list and try again. No question or reply was posted.')
    : error === 'unknown' ? t('namedConversations.ai.uncertain', 'The result could not be confirmed. Retry checks the same request; closing cancels any pending generation.')
    : error === 'AI_CANCELLED' ? t('namedConversations.ai.cancelled', 'Generation was cancelled. Your manual draft is unchanged.')
    : error === 'AI_SOURCE_CHANGED' || error === 'conflict' ? t('namedConversations.ai.changed', 'The conversation or source changed. Close and reopen Ask AI to review the current context.')
    : t('namedConversations.ai.unavailable', 'AI is unavailable for this conversation. You can continue composing manually.');
  return <Dialog isOpen title={t('namedConversations.ai.title', 'Ask AI')} onClose={() => void close()} footer={<>
    <Button id={`${id}-ai-cancel`} variant="outline" disabled={cancelling} onClick={() => void close()}>
      {busy || waiting || uncertain ? t('namedConversations.ai.cancel', 'Cancel generation') : t('namedConversations.cancel', 'Cancel')}
    </Button>
    <Button id={`${id}-ai-submit`} disabled={busy || waiting || cancelling || denied || !sources || !prompt.trim() || error === 'AI_SOURCE_CHANGED' || error === 'conflict'} onClick={() => void submit()}>
      {uncertain ? t('namedConversations.retry', 'Retry') : busy || waiting ? t('namedConversations.ai.generating', 'Thinking…') : t('namedConversations.ai.title', 'Ask AI')}
    </Button>
  </>}>
    <DialogContent><div className="space-y-4">
      {!denied && <div><p className="font-medium break-words">{conversation.name}</p>
        <p className="text-sm text-muted-foreground">{t('namedConversations.ai.publication', 'Your question and the AI reply will be posted together in this internal conversation. Your manual draft is kept.')}</p></div>}
      {error && <p role="alert" className="text-sm text-destructive">{errorText}</p>}
      {!sources && !error && <p role="status">{t('namedConversations.loading', 'Loading conversations…')}</p>}
      {sources && <>
        <fieldset disabled={locked} className="space-y-2"><legend className="text-sm font-medium">{t('namedConversations.ai.sources', 'Conversations AI can use')}</legend>
          <p className="text-xs text-muted-foreground">{t('namedConversations.ai.scope', 'Only published content permitted for this audience is included. Uncheck conversations to narrow the context.')}</p>
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-[rgb(var(--color-border-200))] p-3">
            {sources.map((source, index) => <label key={keyOf(source)} className="flex items-start gap-2 text-sm">
              <input id={`${id}-ai-source-${index}`} type="checkbox" checked={selected.includes(keyOf(source))}
                onChange={event => setSelected(old => event.target.checked ? [...old, keyOf(source)] : old.filter(key => key !== keyOf(source)))} />
              <span className="min-w-0 break-words">{source.name}</span>
            </label>)}
          </div>
          {!selected.length && <p className="text-xs text-muted-foreground">{t('namedConversations.ai.noSources', 'AI will receive only your question.')}</p>}
        </fieldset>
        <TextArea id={`${id}-ai-prompt`} aria-label={t('namedConversations.ai.prompt', 'Your question')} label={t('namedConversations.ai.prompt', 'Your question')}
          rows={4} value={prompt} maxLength={4000} disabled={locked} onChange={event => setPrompt(event.target.value)} />
      </>}
    </div></DialogContent>
  </Dialog>;
}
