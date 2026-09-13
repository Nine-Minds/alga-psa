'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CoManagedTicketQueuePage, CoManagedTicketQueueRequest } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedTicketQueueAction, exportCoManagedTicketQueueAction } from '@/lib/actions/coManagedTicketQueueActions';
import CoManagedTicketBulkHandback from './CoManagedTicketBulkHandback';

export default function CoManagedTicketQueue() {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const [request, setRequest] = useState<CoManagedTicketQueueRequest>({ view: 'working', state: 'open', sort: 'updated', direction: 'desc', page: 1, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<CoManagedTicketQueuePage | null>(null);
  const [error, setError] = useState<'load' | 'export' | null>(null);
  const [exporting, setExporting] = useState(false);
  const generation = useRef(0);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    // LEVERAGE: pattern qualified-queue-request-lifetime — ticket/task filters must discard older requests and clear stale rows/counts.
    let cancelled = false;
    generation.current += 1;
    setResult(null); setError(null); setExporting(false);
    void getCoManagedTicketQueueAction(request).then(page => { if (!cancelled) setResult(page); }).catch(() => { if (!cancelled) setError('load'); });
    return () => { cancelled = true; generation.current += 1; };
  }, [request, refresh]);
  const exportTickets = async () => {
    if (!result || exporting) return;
    const current = generation.current;
    const { page: _page, pageSize: _pageSize, ...filters } = request;
    setExporting(true);
    try {
      const exported = await exportCoManagedTicketQueueAction(filters);
      if (generation.current !== current) return;
      const url = URL.createObjectURL(new Blob([exported.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.id = 'co-queue-export-download'; link.href = url; link.download = exported.filename;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
    } catch {
      if (generation.current === current) { setResult(null); setError('export'); }
    } finally {
      if (generation.current === current) setExporting(false);
    }
  };
  const change = (patch: Partial<CoManagedTicketQueueRequest>) => setRequest(current => ({ ...current, ...patch, page: 1 }));
  const unknown = t('coManaged.ticket.restricted');
  return <div className="mx-auto max-w-7xl space-y-5 p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div>
      <h1 className="text-2xl font-semibold">{t('coManaged.queue.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t(`coManaged.queue.${request.view}Description`)}</p>
    </div><div className="flex gap-2">
      <Button id="co-queue-export" variant="outline" disabled={!result || exporting} onClick={() => void exportTickets()}>{t(exporting ? 'coManaged.queue.exporting' : 'coManaged.queue.export')}</Button>
      <Button id="co-queue-refresh" variant="outline" onClick={() => setRefresh(value => value + 1)}>{t('coManaged.provisioning.refresh')}</Button>
    </div></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <CustomSelect id="co-queue-view" label={t('coManaged.queue.view')} value={request.view}
        options={['working', 'oversight'].map(value => ({ value, label: t(`coManaged.queue.${value}`) }))} onValueChange={value => change({ view: value as 'working' | 'oversight', workspaceTenant: undefined })} />
      <CustomSelect id="co-queue-workspace" label={t('coManaged.queue.workspace')} value={request.workspaceTenant ?? 'all'} disabled={!result}
        options={[{ value: 'all', label: t('coManaged.queue.allWorkspaces') }, ...(result?.workspaces ?? []).map(item => ({ value: item.tenant, label: item.name }))]}
        onValueChange={value => change({ workspaceTenant: value === 'all' ? undefined : value })} />
      <CustomSelect id="co-queue-state" label={t('coManaged.queue.state')} value={request.state!}
        options={['open', 'closed', 'all'].map(value => ({ value, label: t(`coManaged.queue.${value}`) }))} onValueChange={value => change({ state: value as 'open' | 'closed' | 'all' })} />
      <CustomSelect id="co-queue-sort" label={t('coManaged.queue.sort')} value={request.sort!}
        options={['updated', 'created', 'title', 'number'].map(value => ({ value, label: t(`coManaged.queue.sortFields.${value}`) }))}
        onValueChange={value => change({ sort: value as CoManagedTicketQueueRequest['sort'] })} />
      <CustomSelect id="co-queue-direction" label={t('coManaged.queue.direction')} value={request.direction!}
        options={['asc', 'desc'].map(value => ({ value, label: t(`coManaged.queue.${value}`) }))} onValueChange={value => change({ direction: value as 'asc' | 'desc' })} />
    </div>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); change({ search }); }}>
      <div className="min-w-64 flex-1"><Label htmlFor="co-queue-search">{t('coManaged.queue.search')}</Label><Input id="co-queue-search" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} /></div>
      <Button id="co-queue-search-submit" type="submit">{t('coManaged.queue.search')}</Button>
    </form>
    {error ? <p role="alert" className="text-destructive">{t(error === 'export' ? 'coManaged.queue.exportError' : 'coManaged.queue.loadError')}</p> : !result ? <p role="status">{t('coManaged.ticket.loading')}</p> : <>
      <p role="status" className="text-sm text-muted-foreground">{t('coManaged.queue.counts', { total: result.totalCount, open: result.openCount, closed: result.closedCount })}</p>
      <CoManagedTicketBulkHandback items={result.items} onDone={() => setRefresh(value => value + 1)} />
      {!result.items.length ? <p>{t('coManaged.queue.empty')}</p> : <div className="overflow-x-auto rounded-lg border">
        <Table><TableHeader><TableRow>{['ticket', 'workspace', 'state', 'priority', 'responsibility', 'updated'].map(field => <TableHead key={field}>{t(`coManaged.queue.columns.${field}`)}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{result.items.map((item, index) => <TableRow key={`${item.tenant}:${item.relationshipId ?? 'native'}:${item.ticketId}`}>
            <TableCell><Link id={`co-queue-open-${index}`} className="text-primary underline" href={item.relationshipId
              ? `/msp/co-management/tickets/${item.tenant}/${item.relationshipId}/${item.ticketId}` : `/msp/tickets/${item.ticketId}`}>
              {[item.fields.ticket_number, item.fields.title].filter(Boolean).join(' · ') || unknown}</Link></TableCell>
            <TableCell>{item.workspaceName}</TableCell><TableCell>{item.fields.status_name ?? unknown}</TableCell><TableCell>{item.fields.priority_name ?? unknown}</TableCell>
            <TableCell>{item.fields.responsibility ? t(`coManaged.queue.organizations.${item.fields.responsibility}`) : unknown}</TableCell>
            <TableCell>{item.fields.updated_at ? formatDate(new Date(item.fields.updated_at)) : unknown}</TableCell>
          </TableRow>)}</TableBody></Table>
      </div>}
      <div className="flex items-center justify-between gap-3"><Button id="co-queue-previous" variant="outline" disabled={result.page <= 1}
        onClick={() => setRequest(current => ({ ...current, page: result.page - 1 }))}>{t('coManaged.provisioning.previous')}</Button>
        <p>{t('coManaged.queue.page', { page: result.page })}</p>
        <Button id="co-queue-next" variant="outline" disabled={result.page * result.pageSize >= result.totalCount}
          onClick={() => setRequest(current => ({ ...current, page: result.page + 1 }))}>{t('coManaged.provisioning.next')}</Button></div>
    </>}
  </div>;
}
