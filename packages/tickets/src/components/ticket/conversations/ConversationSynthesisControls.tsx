'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import * as actions from '../../../actions/conversationAiActions';
import type { ConversationSynthesisSelection } from './ConversationSharingContext';

/** Mounted inside the host's identity-keyed, paused conversation panel. Neither
 * a capability response nor retained provenance can survive a persona change. */
export function ConversationSynthesisControls({ id, ticket, conversation, refreshVersion, disabled, onSynthesize }: {
  id: string; ticket: ConversationTicketReference; conversation: TicketConversationReference; refreshVersion: number;
  disabled: boolean; onSynthesize: (selection: ConversationSynthesisSelection) => Promise<void>;
}) {
  const { t } = useTranslation('features/tickets');
  const [available, setAvailable] = useState(false);
  const [draft, setDraft] = useState<Extract<Awaited<ReturnType<typeof actions.getNamedConversationDraftSynthesisAction>>, { ok: true }>['result']>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let current = true;
    const refresh = async () => {
      const [capability, provenance] = await Promise.allSettled([
        actions.getConversationAiCapabilityAction(ticket, conversation), actions.getNamedConversationDraftSynthesisAction(ticket, conversation),
      ]);
      if (!current) return;
      setAvailable(capability.status === 'fulfilled' && capability.value.available);
      if (provenance.status === 'fulfilled' && provenance.value.ok) { setDraft(provenance.value.result); setUnavailable(false); }
      else { setDraft(null); setUnavailable(true); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { current = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [ticket, conversation.storeTenant, conversation.conversationId, refreshVersion]);
  if (!available && !draft && !unavailable) return null;
  return <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 py-2 text-sm">
    {draft ? <p role="status" className="text-muted-foreground">{draft.sourceChanged
      ? t('namedConversations.synthesis.sourceChanged', 'The source conversation changed. Your draft edits are kept; regenerate when you are ready.')
      : t('namedConversations.synthesis.review', 'AI prepared this private draft. Review it before sending or posting.')}</p>
      : unavailable ? <p role="status">{t('namedConversations.synthesis.sourceUnavailable', 'Could not check this draft’s source. Refresh to check your access.')}</p> : <span />}
    {available && <div className="flex flex-wrap gap-2">
      {draft && <Button id={`${id}-regenerate-synthesis`} size="sm" variant="outline" disabled={disabled}
        onClick={() => void onSynthesize({ kind: 'synthesis', conversation: draft.source, destination: conversation })}>
        {t('namedConversations.synthesis.regenerate', 'Regenerate summary…')}
      </Button>}
      <Button id={`${id}-summarize`} size="sm" variant="ghost" disabled={disabled}
        onClick={() => void onSynthesize({ kind: 'synthesis', conversation })}>
        <Sparkles className="mr-1.5 h-3.5 w-3.5" />{t('namedConversations.synthesis.action', 'Summarize with AI')}
      </Button>
    </div>}
  </div>;
}
