'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCapability } from '@alga-psa/ui/hooks';
import type { ColumnDefinition } from '@alga-psa/types';
import { getCoManagedBillingState, getCoManagedClientOverviewAction } from '@/lib/actions/coManagedActions';

type Page = Awaited<ReturnType<typeof getCoManagedClientOverviewAction>>;
type Row = Page['rows'][number];
type Capacity = Awaited<ReturnType<typeof getCoManagedBillingState>>;
const PAGE_SIZE = 20;

/**
 * Cross-client co-managed overview: the sponsor's seat capacity and an
 * authorized, searchable table of its customer workspaces. Setup and recovery
 * are client-scoped, so rows link to the client record's co-managed tab.
 */
export default function CoManagedOverview({ initialClientId }: { initialClientId?: string }) {
  const { t } = useTranslation('msp/licensing');
  // Served shows what exists; the client record's co-managed tab (setup, seats)
  // only exists for an admitted sponsor, so links into it are admit-only.
  const { admitted } = useCapability('co-managed');
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page | null>(null);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  useEffect(() => { void getCoManagedBillingState().then(setCapacity, () => setCapacity(null)); }, []);

  useEffect(() => {
    const current = ++generation.current;
    void getCoManagedClientOverviewAction({ search, page, pageSize: PAGE_SIZE }).then(
      next => { if (generation.current === current) { setResult(next); setError(false); } },
      () => { if (generation.current === current) { setResult(null); setError(true); } },
    );
    return () => { generation.current += 1; };
  }, [search, page]);

  const hrefFor = useCallback((row: Row) =>
    `/msp/clients/${encodeURIComponent(row.clientId)}?tab=co-managed&relationshipId=${encodeURIComponent(row.relationshipId)}`, []);

  const columns: ColumnDefinition<Row>[] = [
    { title: t('coManaged.overview.client', { defaultValue: 'Client' }), dataIndex: 'clientName', sortable: false,
      render: (_value, row) => admitted
        ? <Link id={`co-managed-overview-client-${row.operationId}`}
          className="font-semibold text-[rgb(var(--color-primary-700))] hover:underline" href={hrefFor(row)}>
          {row.clientName ?? t('coManaged.overview.unnamed', { defaultValue: 'Client' })}</Link>
        : <span className="font-semibold">{row.clientName ?? t('coManaged.overview.unnamed', { defaultValue: 'Client' })}</span> },
    { title: t('coManaged.overview.workspace', { defaultValue: 'Workspace' }), dataIndex: 'workspaceName', sortable: false,
      render: (value) => value ?? '—' },
    { title: t('coManaged.overview.status', { defaultValue: 'Status' }), dataIndex: 'state', sortable: false,
      render: (_value, row) => <div>
        <span>{t(`coManaged.provisioning.states.${row.state}`, { defaultValue: row.state })}</span>
        {row.invitationExpired && <p className="text-muted-foreground">{t('coManaged.provisioning.invitationExpired')}</p>}
        {row.deliveryFailed && <p className="text-muted-foreground">{t('coManaged.provisioning.deliveryFailed')}</p>}
        {row.cleanupFailed && <p className="text-muted-foreground">{t('coManaged.provisioning.cleanupFailed')}</p>}
      </div> },
    { title: t('coManaged.overview.seats', { defaultValue: 'Seats' }), dataIndex: 'seats', sortable: false,
      render: (_value, row) => row.ended || row.state === 'cancelled'
        ? t('coManaged.client.seatsReleased', { defaultValue: 'Seats released' })
        : row.usedSeats != null
          ? t('coManaged.client.seatUsage', { count: row.seats, used: row.usedSeats, defaultValue: '{{used}} of {{count}} technician seats' })
          : t('coManaged.client.seatAllocation', { count: row.seats, defaultValue: '{{count}} allocated technician seats' }) },
    { title: t('coManaged.overview.actions', { defaultValue: 'Actions' }), dataIndex: 'operationId', id: 'actions', sortable: false,
      render: (_value, row) => admitted ? <Button id={`co-managed-overview-manage-${row.operationId}`} variant="outline" size="sm" asChild>
        <Link href={hrefFor(row)}>{t('coManaged.client.viewDetails', { defaultValue: 'View details' })}</Link>
      </Button> : null },
  ];

  return <div id="co-managed-overview" className="min-w-0 space-y-4">
    <header>
      <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">{t('coManaged.title')}</h1>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">{t('coManaged.description')}</p>
    </header>
    {!admitted && <p id="co-managed-overview-readonly" role="status" className="text-sm text-[rgb(var(--color-text-600))]">
      {t('coManaged.overview.readOnly', { defaultValue: 'Co-managed IT is read-only for this workspace. Existing relationships are shown; new setup is not available.' })}
    </p>}
    {capacity && <p id="co-managed-overview-capacity" role="status" className="text-sm text-[rgb(var(--color-text-600))]">
      {t('coManaged.overview.capacity', { allocated: capacity.allocated, count: capacity.capacity,
        defaultValue: '{{allocated}} of {{count}} co-managed seats allocated.' })}
    </p>}
    {admitted && initialClientId && <p>
      <Link id="co-managed-overview-selected-client" className="text-primary underline"
        href={`/msp/clients/${encodeURIComponent(initialClientId)}?tab=co-managed`}>
        {t('coManaged.overview.openClient', { defaultValue: 'Set up co-managed IT for this client' })}
      </Link>
    </p>}
    <div className="space-y-2">
      <Label htmlFor="co-managed-overview-search">{t('coManaged.overview.search', { defaultValue: 'Search clients' })}</Label>
      <Input id="co-managed-overview-search" type="search" maxLength={200} value={search}
        onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
    </div>
    {error && <Alert variant="destructive"><AlertDescription id="co-managed-overview-error">
      {t('coManaged.overview.loadError', { defaultValue: 'Could not load co-managed clients.' })}</AlertDescription></Alert>}
    {!result && !error && <p role="status">{t('coManaged.loading')}</p>}
    {result && result.rows.length === 0 && <p>{t('coManaged.overview.empty', { defaultValue: 'No co-managed clients match this search.' })}</p>}
    {result && result.rows.length > 0 && <DataTable id="co-managed-client-overview" data={result.rows} columns={columns}
      pagination currentPage={page} onPageChange={setPage} pageSize={PAGE_SIZE} totalItems={result.totalCount} />}
  </div>;
}
