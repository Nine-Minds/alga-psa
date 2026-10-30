'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import { listCoManagedCustomerTicketsAction } from '@/lib/actions/coManagedWorkActions';

type Page = Awaited<ReturnType<typeof listCoManagedCustomerTicketsAction>>;
type Row = Page['rows'][number];
const PAGE_SIZE = 25;

/** Display text of a summary field; redacted or empty fields are simply absent. */
const display = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' ? String(value)
    : value && typeof value === 'object' && 'name' in value ? ((value as { name: string | null }).name ?? null) : null;

/**
 * Customer Tickets: every ticket customers have shared with this MSP that the
 * signed-in technician may read right now (customer grant, staff assignment, home
 * permission and relationship state are all re-checked server-side on each load).
 */
export default function CoManagedCustomerTickets() {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<Page | null>(null);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    void listCoManagedCustomerTicketsAction({ page, pageSize: PAGE_SIZE }).then(
      next => { if (generation.current === current) { setResult(next); setError(false); } },
      () => { if (generation.current === current) { setResult(null); setError(true); } });
    return () => { generation.current += 1; };
  }, [page]);

  const hrefFor = (row: Row) => `/msp/co-management/customer-tickets/${encodeURIComponent(row.resource.relationshipId)}/${encodeURIComponent(row.resource.id)}`;
  const dash = (value: string | null) => value ?? '—';
  const columns: ColumnDefinition<Row>[] = [
    { title: t('coManaged.customerTickets.number', { defaultValue: 'Ticket' }), dataIndex: 'fields', id: 'ticket_number', sortable: false,
      render: (_v, row) => <Link id={`co-managed-customer-ticket-${row.resource.id}`} href={hrefFor(row)}
        className="font-semibold text-[rgb(var(--color-primary-700))] hover:underline">{dash(display(row.fields.ticket_number))}</Link> },
    { title: t('coManaged.customerTickets.titleColumn', { defaultValue: 'Title' }), dataIndex: 'fields', id: 'title', sortable: false,
      render: (_v, row) => dash(display(row.fields.title)) },
    { title: t('coManaged.customerTickets.customer', { defaultValue: 'Customer' }), dataIndex: 'customerName', sortable: false,
      render: (_v, row) => dash(row.customerName || null) },
    { title: t('coManaged.customerTickets.board', { defaultValue: 'Board' }), dataIndex: 'fields', id: 'board', sortable: false,
      render: (_v, row) => dash(display(row.fields.board)) },
    { title: t('coManaged.customerTickets.status', { defaultValue: 'Status' }), dataIndex: 'fields', id: 'status', sortable: false,
      render: (_v, row) => dash(display(row.fields.status)) },
    { title: t('coManaged.customerTickets.priority', { defaultValue: 'Priority' }), dataIndex: 'fields', id: 'priority', sortable: false,
      render: (_v, row) => dash(display(row.fields.priority)) },
    { title: t('coManaged.customerTickets.entered', { defaultValue: 'Entered' }), dataIndex: 'fields', id: 'entered_at', sortable: false,
      render: (_v, row) => { const entered = display(row.fields.entered_at); return entered ? formatDate(new Date(entered), { dateStyle: 'medium' }) : '—'; } },
  ];

  return <div id="co-managed-customer-tickets" className="min-w-0 space-y-4">
    <header>
      <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">{t('coManaged.customerTickets.heading', { defaultValue: 'Customer Tickets' })}</h1>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
        {t('coManaged.customerTickets.description', { defaultValue: 'Tickets your co-managed customers have shared with you.' })}</p>
    </header>
    {error && <Alert variant="destructive"><AlertDescription id="co-managed-customer-tickets-error">
      {t('coManaged.customerTickets.loadError', { defaultValue: 'Could not load customer tickets.' })}</AlertDescription></Alert>}
    {!result && !error && <p role="status">{t('coManaged.loading')}</p>}
    {result && result.rows.length === 0 && <p id="co-managed-customer-tickets-empty">
      {t('coManaged.customerTickets.empty', { defaultValue: 'No customer tickets are shared with you right now.' })}</p>}
    {result && result.rows.length > 0 && <>
      <DataTable id="co-managed-customer-tickets-table" data={result.rows} columns={columns} pagination={false} />
      <div className="flex items-center gap-2">
        <Button id="co-managed-customer-tickets-previous" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
          {t('coManaged.customerTickets.previous', { defaultValue: 'Previous' })}</Button>
        <Button id="co-managed-customer-tickets-next" variant="outline" size="sm" disabled={!result.hasMore} onClick={() => setPage(page + 1)}>
          {t('coManaged.customerTickets.next', { defaultValue: 'Next' })}</Button>
      </div>
    </>}
  </div>;
}
