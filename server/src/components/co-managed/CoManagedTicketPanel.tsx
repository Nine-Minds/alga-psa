'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedTicketScreenAction, getSharedTicketHandoffHistoryAction, type CoManagedTicketScreenTarget } from '@/lib/actions/coManagedSharedWorkActions';
import CoManagedTicketEditor from './CoManagedTicketEditor';
import CoManagedTicketSla from './CoManagedTicketSla';
import CoManagedTimeEntry from './CoManagedTimeEntry';
import CoManagedTicketConversation from './CoManagedTicketConversation';
import CoManagedTicketAssignment from './CoManagedTicketAssignment';
import CoManagedHandoffComposer, { type HandoffAction } from './CoManagedHandoffComposer';

type Screen = Awaited<ReturnType<typeof getCoManagedTicketScreenAction>>;
type History = Awaited<ReturnType<typeof getSharedTicketHandoffHistoryAction>>;

/** Key the entire reader/composer by qualified identity so navigation cannot
 * reuse an unresolved submission or paint a previous customer's response. */
export default function CoManagedTicketPanel({ target, showSummary = false }: { target: CoManagedTicketScreenTarget; showSummary?: boolean }) {
  const identity = target.kind === 'local' ? `local:${target.ticketId}` : JSON.stringify(target.resource);
  return <TicketPanel key={identity} target={target} showSummary={showSummary} />;
}
function TicketPanel({ target, showSummary }: { target: CoManagedTicketScreenTarget; showSummary: boolean }) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const initialTarget = useRef(target);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [history, setHistory] = useState<History>({ items: [], nextBeforeRevision: null });
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [action, setAction] = useState<HandoffAction | null>(null);
  // LEVERAGE: pattern co-managed-request-generation — keep late reads out of a new customer or refreshed screen.
  const generation = useRef(0);
  const historyRequest = useRef(false);
  function reload() { generation.current++; setScreen(null); setAction(null); setRefresh(value => value + 1); }
  function unavailable() { generation.current++; setScreen(null); setAction(null); setHistory({ items: [], nextBeforeRevision: null }); setError(true); }
  useEffect(() => {
    const current = ++generation.current;
    setError(false); setHistoryError(false); setHistory({ items: [], nextBeforeRevision: null });
    setHistoryBusy(false); historyRequest.current = false;
    void getCoManagedTicketScreenAction(initialTarget.current).then(async result => {
      if (generation.current !== current) return;
      setScreen(result); setHistoryBusy(true); historyRequest.current = true;
      try {
        const rows = await getSharedTicketHandoffHistoryAction(result.summary.resource);
        if (generation.current === current) setHistory(rows);
      } catch { if (generation.current === current) setHistoryError(true); }
      finally { if (generation.current === current) { setHistoryBusy(false); historyRequest.current = false; } }
    }).catch(() => { if (generation.current === current) setError(true); });
    return () => { generation.current++; };
  }, [refresh]);
  async function older() {
    if (!screen || historyRequest.current) return;
    const current = generation.current;
    historyRequest.current = true; setHistoryBusy(true); setHistoryError(false);
    try {
      const rows = await getSharedTicketHandoffHistoryAction(screen.summary.resource, history.nextBeforeRevision ?? undefined);
      if (generation.current === current) setHistory(previous => ({ items: [...previous.items, ...rows.items], nextBeforeRevision: rows.nextBeforeRevision }));
    } catch { if (generation.current === current) setHistoryError(true); }
    finally { if (generation.current === current) { setHistoryBusy(false); historyRequest.current = false; } }
  }
  const fields = screen?.summary.fields;
  const display = (field: unknown) => typeof field === 'string' ? field : undefined;
  const named = (field: unknown) => field && typeof field === 'object' && 'name' in field ? display(field.name) : undefined;
  return <Card className="my-4"><CardHeader><CardTitle>{t('coManaged.ticket.title')}</CardTitle></CardHeader><CardContent className="space-y-4">
    {error ? <div role="alert"><p>{t('coManaged.ticket.loadError')}</p><Button id="co-ticket-reload" variant="outline" onClick={reload}>{t('coManaged.ticket.reload')}</Button></div>
      : !screen ? <p role="status">{t('coManaged.ticket.loading')}</p> : <>
      {showSummary && <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{screen.customerName}</p>
        <h1 className="break-words text-xl font-semibold">{[display(fields?.ticket_number), display(fields?.title)].filter(Boolean).join(' · ') || t('coManaged.ticket.restricted')}</h1>
        {(named(fields?.status) || named(fields?.priority)) && <p>{[named(fields?.status), named(fields?.priority)].filter(Boolean).join(' · ')}</p>}
      </div>}
      {(fields?.responsibility === 'customer' || fields?.responsibility === 'msp') && <p>{t('coManaged.ticket.responsibility', { organization: fields.responsibility === 'msp' ? screen.sponsorName : screen.customerName })}</p>}
      {screen.sla && <CoManagedTicketSla sla={screen.sla} customerName={screen.customerName} sponsorName={screen.sponsorName} />}
      {!screen.canWrite && <p role="status" className="rounded-md border p-3">{t('coManaged.ticket.readOnly')}</p>}
      {action && typeof fields?.work_revision === 'number' ? <CoManagedHandoffComposer key={action} action={action} side={screen.side}
        resource={screen.summary.resource} revision={fields.work_revision} onSaved={reload} onCancel={() => setAction(null)} onReload={reload} />
        : <div className="flex flex-wrap gap-2">
          {screen.canEscalate && <Button id="co-ticket-escalate" onClick={() => setAction('escalate')}>{t('coManaged.ticket.escalate')}</Button>}
          {screen.canHandBack && <Button id="co-ticket-handback" onClick={() => setAction('handback')}>{t(`coManaged.ticket.${screen.side === 'customer' ? 'takeBack' : 'handback'}`)}</Button>}
          {screen.canRevoke && <Button id="co-ticket-revoke" variant="outline" onClick={() => setAction('revoke')}>{t('coManaged.ticket.revoke')}</Button>}
        </div>}
      {showSummary && screen.side === 'sponsor' && <CoManagedTicketEditor resource={screen.summary.resource} onSaved={reload} onReload={reload} />}
      {screen.side === 'sponsor' && <CoManagedTimeEntry resource={screen.summary.resource} canWrite={screen.canWrite} />}
      <CoManagedTicketAssignment resource={screen.summary.resource} onSaved={reload} onReload={reload} onUnavailable={unavailable} />
      <CoManagedTicketConversation resource={screen.summary.resource} />
      <section className="space-y-3" aria-labelledby="co-ticket-history-title">
        <h2 id="co-ticket-history-title" className="font-semibold">{t('coManaged.ticket.history')}</h2>
        {!history.items.length && !historyBusy && !historyError && <p className="text-sm text-muted-foreground">{t('coManaged.ticket.noHistory')}</p>}
        <ol className="space-y-3">{history.items.map(item => <li key={item.operationId} className="space-y-1 rounded-md border p-3">
          <p className="font-medium">{t(`coManaged.ticket.transitions.${item.transition}`)}</p>
          {item.author && <p className="text-sm">{item.author.name} · {item.author.organization}</p>}
          <time className="text-sm text-muted-foreground" dateTime={item.occurredAt}>{formatDate(new Date(item.occurredAt), { dateStyle: 'medium', timeStyle: 'short' })}</time>
          {item.note !== undefined && <p className="whitespace-pre-wrap break-words">{item.note}</p>}
        </li>)}</ol>
        {historyBusy && <p role="status">{t('coManaged.ticket.loading')}</p>}
        {historyError && <p role="alert">{t('coManaged.ticket.historyError')}</p>}
        {(history.nextBeforeRevision !== null || historyError) && <Button id="co-ticket-older" variant="outline" disabled={historyBusy} onClick={() => void older()}>{t(`coManaged.ticket.${historyError ? 'retry' : 'older'}`)}</Button>}
      </section>
    </>}
  </CardContent></Card>;
}
