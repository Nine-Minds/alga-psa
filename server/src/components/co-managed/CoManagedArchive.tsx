'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import { getCoManagedArchive, listCoManagedArchiveSummaries } from '@/lib/actions/coManagedArchiveActions';
import type { CoManagedArchiveEntry, CoManagedArchiveHistory, CoManagedArchiveSummary } from '@alga-psa/co-managed';

/** The MSP's read-only archive of what it took part in. Rows are named by client, never by id. */
export default function CoManagedArchive() {
  const { t } = useTranslation('msp/co-managed-lifecycle');
  const { formatDate } = useFormatters();
  const [items, setItems] = useState<CoManagedArchiveSummary[] | null>(null);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [denied, setDenied] = useState(false);
  const [open, setOpen] = useState<CoManagedArchiveHistory | null>(null);
  const [openOperation, setOpenOperation] = useState<string | null>(null);
  const [entries, setEntries] = useState<CoManagedArchiveEntry[]>([]);

  const loadList = useCallback(async (page: number) => {
    const result = await listCoManagedArchiveSummaries(page);
    if (!result.ok) { setDenied(true); return; }
    setItems(previous => page === 0 ? result.items : [...(previous ?? []), ...result.items]);
    setNextPage(result.nextPage);
  }, []);
  useEffect(() => { void loadList(0); }, [loadList]);

  const view = async (operationId: string, page = 0) => {
    const result = await getCoManagedArchive({ operationId, page });
    if (!result.ok) { setDenied(true); return; }
    setOpenOperation(operationId); setOpen(result.history);
    setEntries(previous => page === 0 ? result.history.entries : [...previous, ...result.history.entries]);
  };

  const date = (value: string) => formatDate(new Date(value), { dateStyle: 'medium' });
  const reasonLabel = (reason: string) => ({
    class_not_allowlisted: t('archive.reason.class', { defaultValue: 'Not part of the retained record' }),
    audience_not_allowlisted: t('archive.reason.audience', { defaultValue: 'Private to the customer' }),
    after_cutoff: t('archive.reason.afterCutoff', { defaultValue: 'After the relationship ended' }),
  }[reason] ?? reason);

  const columns: ColumnDefinition<CoManagedArchiveSummary>[] = [
    { title: t('archive.columns.client', { defaultValue: 'Client' }), dataIndex: 'clientName', id: 'client',
      render: (_v, row) => row.clientName ?? t('archive.unknownClient', { defaultValue: 'Unnamed client' }) },
    { title: t('archive.columns.sealed', { defaultValue: 'Archived' }), dataIndex: 'sealedAt', id: 'sealed', render: (_v, row) => date(row.sealedAt) },
    { title: t('archive.columns.evidence', { defaultValue: 'Records' }), dataIndex: 'evidenceCount', id: 'evidence' },
    { title: t('archive.columns.files', { defaultValue: 'Files' }), dataIndex: 'fileCount', id: 'files' },
    { title: t('archive.columns.actions', { defaultValue: 'Actions' }), dataIndex: 'operationId', id: 'actions', sortable: false,
      render: (_v, row) => <Button id={`co-managed-archive-open-${row.operationId}`} variant="outline" size="sm" onClick={() => void view(row.operationId)}>
        {t('archive.open', { defaultValue: 'Open' })}</Button> },
  ];
  const entryColumns: ColumnDefinition<CoManagedArchiveEntry>[] = [
    { title: t('archive.entry.when', { defaultValue: 'Date' }), dataIndex: 'occurredAt', id: 'when', render: (_v, row) => date(row.occurredAt) },
    { title: t('archive.entry.author', { defaultValue: 'Author' }), dataIndex: 'author', id: 'author',
      render: (_v, row) => row.author ? `${row.author.name} · ${row.author.organization}` : '' },
    { title: t('archive.entry.content', { defaultValue: 'Content' }), dataIndex: 'markdown', id: 'content', sortable: false,
      render: (_v, row) => row.deleted ? t('archive.entry.deleted', { defaultValue: 'Removed by its author' }) : (row.markdown ?? row.note ?? '') },
  ];

  if (denied) return <Alert variant="destructive"><AlertDescription id="co-managed-archive-denied">
    {t('archive.denied', { defaultValue: 'You do not have permission to view this archive.' })}</AlertDescription></Alert>;
  if (!items) return <p role="status">{t('archive.loading', { defaultValue: 'Loading…' })}</p>;
  return <div id="co-managed-archive" className="space-y-4">
    {open ? <Card><CardContent className="space-y-4 pt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{open.archive.clientName ?? t('archive.unknownClient', { defaultValue: 'Unnamed client' })}</h2>
        <Button id="co-managed-archive-back" variant="outline" onClick={() => { setOpen(null); setEntries([]); }}>{t('archive.back', { defaultValue: 'Back' })}</Button>
      </div>
      <p className="text-sm">{t('archive.cutoff', { defaultValue: 'Records up to {{date}}. This archive is read-only.', date: date(open.archive.cutoffAt) })}</p>
      {entries.length ? <DataTable id="co-managed-archive-entries" data={entries} columns={entryColumns} pagination={false} />
        : <p id="co-managed-archive-entries-empty">{t('archive.entry.empty', { defaultValue: 'No records were retained.' })}</p>}
      {open.nextPage !== null && openOperation && <Button id="co-managed-archive-more" variant="outline" onClick={() => void view(openOperation, open.nextPage!)}>
        {t('archive.more', { defaultValue: 'Load more' })}</Button>}
      {open.files.length > 0 && <div id="co-managed-archive-files" className="space-y-1">
        <h3 className="font-medium">{t('archive.filesHeading', { defaultValue: 'Files' })}</h3>
        {open.files.map(file => <p key={file.archiveFileId}>
          <a className="text-[rgb(var(--color-primary-500))] underline" href={`/api/co-management/archive-files/${file.archiveFileId}`}>
            {file.fileName ?? t('archive.fileUnnamed', { defaultValue: 'Download file' })}</a></p>)}
      </div>}
      {open.exclusions.length > 0 && <div id="co-managed-archive-exclusions" className="space-y-1">
        <h3 className="font-medium">{t('archive.exclusionsHeading', { defaultValue: 'Not retained' })}</h3>
        <ul className="list-disc pl-5 text-sm">{open.exclusions.map(e => <li key={`${e.evidenceClass}-${e.reason}`}>
          {t('archive.exclusion', { defaultValue: '{{count}} · {{reason}}', count: e.count, reason: reasonLabel(e.reason) })}</li>)}</ul>
      </div>}
    </CardContent></Card>
    : <>
        {items.length ? <DataTable id="co-managed-archives" data={items} columns={columns} pagination={false} />
          : <p id="co-managed-archive-empty">{t('archive.empty', { defaultValue: 'No archives yet. One is created when a relationship ends.' })}</p>}
        {nextPage !== null && <Button id="co-managed-archive-list-more" variant="outline" onClick={() => void loadList(nextPage)}>{t('archive.more', { defaultValue: 'Load more' })}</Button>}
      </>}
  </div>;
}
