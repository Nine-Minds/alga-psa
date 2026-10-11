'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getExplicitTicketGrantsAction } from '@/lib/actions/coManagedSharedWorkActions';
import CoManagedHandoffComposer from './CoManagedHandoffComposer';

type Page = Awaited<ReturnType<typeof getExplicitTicketGrantsAction>>;
export default function CoManagedExplicitTicketGrantsPanel() {
  const { t } = useTranslation('msp/licensing');
  const [page, setPage] = useState<Page | null>(null);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Page['items'][number] | null>(null);
  // LEVERAGE: pattern co-managed-request-generation — keep late reads out of a new customer or refreshed screen.
  const generation = useRef(0);
  const cursor = cursors.at(-1);
  function reload() { generation.current++; setPage(null); setSelected(null); setRefresh(value => value + 1); }
  useEffect(() => {
    const current = ++generation.current;
    setPage(null); setError(false); setSelected(null);
    void getExplicitTicketGrantsAction(cursor).then(result => { if (generation.current === current) setPage(result); })
      .catch(() => { if (generation.current === current) setError(true); });
    return () => { generation.current++; };
  }, [cursor, refresh]);
  return <div className="mx-auto max-w-4xl space-y-4 p-6">
    <Link href="/msp/co-management" className="text-primary underline">{t('coManaged.grants.back')}</Link>
    <Card><CardHeader><CardTitle>{t('coManaged.grants.title')}</CardTitle></CardHeader><CardContent className="space-y-4">
      <p>{t('coManaged.grants.description')}</p>
      {error ? <div role="alert"><p>{t('coManaged.ticket.loadError')}</p><Button id="co-grants-reload" variant="outline" onClick={reload}>{t('coManaged.ticket.reload')}</Button></div>
        : !page ? <p role="status">{t('coManaged.ticket.loading')}</p> : <>
        {!page.items.length && <p>{t('coManaged.grants.empty')}</p>}
        <ul className="space-y-3">{page.items.map(item => <li key={item.resource.id} className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 break-words">{item.ticketNumber || item.title
              ? <Link href={`/msp/tickets/${item.resource.id}`} className="text-primary underline">{[item.ticketNumber, item.title].filter(Boolean).join(' · ')}</Link>
              : <><p>{t('coManaged.ticket.restricted')}</p><p className="text-sm text-muted-foreground">{item.resource.id}</p></>}</div>
            <Button id={`co-grant-revoke-${item.resource.id}`} variant="outline" disabled={selected !== null} onClick={() => setSelected(item)}>{t('coManaged.ticket.revoke')}</Button>
          </div>
          {selected?.resource.id === item.resource.id && <CoManagedHandoffComposer key={`${item.resource.id}:${refresh}`} action="revoke" side="customer"
            resource={selected.resource} revision={selected.revision} onSaved={reload} onCancel={() => setSelected(null)} onReload={reload} />}
        </li>)}</ul>
      </>}
      <div className="flex gap-2">
        <Button id="co-grants-previous" variant="outline" disabled={selected !== null || cursors.length === 1} onClick={() => setCursors(previous => previous.slice(0, -1))}>{t('coManaged.provisioning.previous')}</Button>
        <Button id="co-grants-next" variant="outline" disabled={selected !== null || !page?.nextAfterTicketId} onClick={() => {
          if (page?.nextAfterTicketId) setCursors(previous => [...previous, page.nextAfterTicketId!]);
        }}>{t('coManaged.provisioning.next')}</Button>
      </div>
    </CardContent></Card>
  </div>;
}
