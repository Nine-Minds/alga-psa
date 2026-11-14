'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { BentoStat } from '@alga-psa/ui/components/bento';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import { getCoManagedCombinedOverviewAction } from '@/lib/actions/coManagedSeatActions';

type Page = Awaited<ReturnType<typeof getCoManagedCombinedOverviewAction>>;
type Row = Page['rows'][number];
const PAGE_SIZE = 20;

/**
 * The overview's table when the seat shape is open: workspace and seat arrangements in one list, with
 * the pool's totals beside it. Client name and link, never an id. It replaces the workspace-only table
 * and its pool line; with the seat capability closed the overview renders the original instead.
 */
export default function CoManagedCombinedOverview({ search, admitted }: { search: string; admitted: boolean }) {
  const { t } = useTranslation('msp/licensing');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page | null>(null);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => {
    const current = ++generation.current;
    void getCoManagedCombinedOverviewAction({ search, page, pageSize: PAGE_SIZE }).then(
      (next) => { if (generation.current === current) { setResult(next); setError(false); } },
      () => { if (generation.current === current) { setResult(null); setError(true); } },
    );
    return () => { generation.current += 1; };
  }, [search, page]);

  const hrefFor = useCallback((row: Row) => `/msp/clients/${encodeURIComponent(row.clientId)}?tab=co-managed${row.relationshipId
    ? `&relationshipId=${encodeURIComponent(row.relationshipId)}` : ''}`, []);
  const name = (row: Row) => row.clientName ?? t('coManaged.overview.unnamed', { defaultValue: 'Client' });

  const columns: ColumnDefinition<Row>[] = [
    { title: t('coManaged.overview.client', { defaultValue: 'Client' }), dataIndex: 'clientName', sortable: false,
      render: (_value, row) => admitted
        ? <Link id={`co-managed-overview-client-${row.key}`} className="font-semibold text-[rgb(var(--color-primary-700))] hover:underline" href={hrefFor(row)}>{name(row)}</Link>
        : <span className="font-semibold">{name(row)}</span> },
    { title: t('coManaged.overview.shape', { defaultValue: 'Shape' }), dataIndex: 'shape', sortable: false,
      render: (_value, row) => row.shape === 'seat'
        ? t('coManaged.seat.chooser.seat', { defaultValue: 'Seat' })
        : t('coManaged.seat.chooser.workspace', { defaultValue: 'Workspace' }) },
    { title: t('coManaged.overview.state', { defaultValue: 'State' }), dataIndex: 'state', sortable: false,
      render: (_value, row) => row.shape === 'seat'
        ? t(`coManaged.seat.states.${row.state}`, { defaultValue: row.state })
        : t(`coManaged.provisioning.states.${row.state}`, { defaultValue: row.state }) },
    { title: t('coManaged.overview.seatsUsed', { defaultValue: 'Seats used' }), dataIndex: 'usedSeats', sortable: false,
      render: (_value, row) => row.usedSeats ?? '—' },
    { title: t('coManaged.overview.seatsAllocated', { defaultValue: 'Seats allocated' }), dataIndex: 'seats', sortable: false,
      render: (_value, row) => row.seats },
    { title: t('coManaged.overview.actions', { defaultValue: 'Actions' }), dataIndex: 'key', id: 'actions', sortable: false,
      render: (_value, row) => admitted ? <Button id={`co-managed-overview-manage-${row.key}`} variant="outline" size="sm" asChild>
        <Link href={hrefFor(row)}>{t('coManaged.client.viewDetails', { defaultValue: 'View details' })}</Link></Button> : null },
  ];

  return (
    <div id="co-managed-combined-overview" className="space-y-4">
      {result && (
        <div id="co-managed-overview-pool" className="flex flex-wrap gap-x-8 gap-y-3">
          <BentoStat value={result.pool.purchased} label={t('coManaged.capacity', { defaultValue: 'Purchased' })} />
          <BentoStat value={result.pool.allocated} label={t('coManaged.allocated', { defaultValue: 'Allocated' })} />
          <BentoStat value={result.pool.available} label={t('coManaged.available', { defaultValue: 'Available' })} />
        </div>
      )}
      {error && <Alert variant="destructive"><AlertDescription id="co-managed-overview-error">
        {t('coManaged.overview.loadError', { defaultValue: 'Could not load co-managed clients.' })}</AlertDescription></Alert>}
      {!result && !error && <p role="status">{t('coManaged.loading')}</p>}
      {result && result.rows.length === 0 && <p>{t('coManaged.overview.empty', { defaultValue: 'No co-managed clients match this search.' })}</p>}
      {result && result.rows.length > 0 && <DataTable id="co-managed-client-overview" data={result.rows} columns={columns}
        pagination currentPage={page} onPageChange={setPage} pageSize={PAGE_SIZE} totalItems={result.totalCount} />}
    </div>
  );
}
