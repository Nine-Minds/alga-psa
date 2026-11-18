'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import Drawer from '@alga-psa/ui/components/Drawer';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { getSharedTicketHandoffHistoryAction } from '@/lib/actions/coManagedSharedWorkActions';

type History = Awaited<ReturnType<typeof getSharedTicketHandoffHistoryAction>>;
const EMPTY: History = { items: [], nextBeforeRevision: null };

/**
 * Handoff history for one qualified ticket, paged newest first. Rows are read
 * when the drawer opens (and again after `refreshKey` changes), never while it
 * is closed.
 */
export default function CoManagedHandoffHistoryDrawer({ resource, isOpen, onClose, refreshKey }: {
  resource: CoManagedSharedResource; isOpen: boolean; onClose: () => void; refreshKey: number;
}) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const target = useRef({ ...resource });
  const [history, setHistory] = useState<History>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // LEVERAGE: pattern co-managed-request-generation — keep late reads out of a closed or refreshed drawer.
  const generation = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    setHistory(EMPTY); setFailed(false); setLoaded(false); inFlight.current = false;
    if (!isOpen) { setBusy(false); return; }
    setBusy(true); inFlight.current = true;
    void getSharedTicketHandoffHistoryAction(target.current)
      .then(rows => { if (generation.current === current) { setHistory(rows); setLoaded(true); } })
      .catch(() => { if (generation.current === current) setFailed(true); })
      .finally(() => { if (generation.current === current) { setBusy(false); inFlight.current = false; } });
    return () => { generation.current++; };
  }, [isOpen, refreshKey, attempt]);

  async function older() {
    if (inFlight.current || history.nextBeforeRevision === null) return;
    const current = generation.current;
    inFlight.current = true; setBusy(true); setFailed(false);
    try {
      const rows = await getSharedTicketHandoffHistoryAction(target.current, history.nextBeforeRevision);
      if (generation.current === current) setHistory(previous => ({ items: [...previous.items, ...rows.items], nextBeforeRevision: rows.nextBeforeRevision }));
    } catch { if (generation.current === current) setFailed(true); }
    finally { if (generation.current === current) { setBusy(false); inFlight.current = false; } }
  }

  return <Drawer id="co-ticket-history-drawer" isOpen={isOpen} onClose={onClose}>
    <section className="space-y-3 pr-8" aria-labelledby="co-ticket-history-title">
      <h2 id="co-ticket-history-title" className="text-lg font-bold text-[rgb(var(--color-text-900))]">{t('coManaged.ticket.history')}</h2>
      {loaded && !history.items.length && !busy && !failed && <p className="text-sm text-[rgb(var(--color-text-400))]">{t('coManaged.ticket.noHistory')}</p>}
      <ol id="co-ticket-history-list" className="divide-y divide-[rgb(var(--color-border-100))]">{history.items.map(item => <li key={item.operationId} className="space-y-1 py-3 first:pt-0 last:pb-0">
        <p className="text-sm font-medium text-[rgb(var(--color-text-800))]">{t(`coManaged.ticket.transitions.${item.transition}`)}</p>
        {item.author && <p className="text-xs text-[rgb(var(--color-text-500))]">{item.author.name} · {item.author.organization}</p>}
        <time className="block text-xs text-[rgb(var(--color-text-500))]" dateTime={item.occurredAt}>{formatDate(new Date(item.occurredAt), { dateStyle: 'medium', timeStyle: 'short' })}</time>
        {item.note !== undefined && <p className="whitespace-pre-wrap break-words text-sm text-[rgb(var(--color-text-700))]">{item.note}</p>}
      </li>)}</ol>
      {busy && <div role="status" aria-label={t('coManaged.ticket.loading')} className="h-16 animate-pulse rounded-md bg-[rgb(var(--color-border-100))]" />}
      {failed && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">{t('coManaged.ticket.historyError')}</p>}
      {(history.nextBeforeRevision !== null || failed) && loaded && <Button id="co-ticket-history-older" variant="outline" disabled={busy} onClick={() => void older()}>
        {t(`coManaged.ticket.${failed ? 'retry' : 'older'}`)}</Button>}
      {failed && !loaded && <Button id="co-ticket-history-retry" variant="outline" disabled={busy} onClick={() => setAttempt(value => value + 1)}>{t('coManaged.ticket.retry')}</Button>}
    </section>
  </Drawer>;
}
