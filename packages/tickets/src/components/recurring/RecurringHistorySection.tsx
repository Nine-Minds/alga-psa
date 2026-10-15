'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import { listRecurringTicketOccurrences } from '../../actions/recurringTicketActions';
import { RECURRING_OCCURRENCE_STATUSES } from '../../lib/recurring/definitionInput';
import type { RecurringDefinitionClientRecord, RecurringOccurrenceListItem } from '../../lib/recurring/types';
import { describeOccurrenceReason, formatCalendarDate, formatInstant, unwrapRecurring } from './recurringUi';

const PAGE_SIZE = 25;
const ALL = '';

const STATUS_BADGE: Record<RecurringOccurrenceListItem['status'], 'success' | 'default-muted' | 'warning' | 'error'> = {
  created: 'success',
  skipped: 'default-muted',
  missed: 'warning',
  failed: 'error',
};

export interface RecurringHistorySectionProps {
  definitionId: string;
  clients: RecurringDefinitionClientRecord[];
  timeZone: string;
  /** Bump to reload after the parent changed something that produces occurrences. */
  refreshKey?: number;
}

/** Every occurrence the generator recorded for the definition, with status/client filters. */
export function RecurringHistorySection({ definitionId, clients, timeZone, refreshKey = 0 }: RecurringHistorySectionProps) {
  const { t, i18n } = useTranslation('features/tickets');
  const [status, setStatus] = useState<string>(ALL);
  const [clientId, setClientId] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<RecurringOccurrenceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = unwrapRecurring(await listRecurringTicketOccurrences(definitionId, {
        page,
        pageSize: PAGE_SIZE,
        ...(status !== ALL ? { status: status as RecurringOccurrenceListItem['status'] } : {}),
        ...(clientId !== ALL ? { clientId } : {}),
      }));
      setItems(result.items);
      setTotal(result.total);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [definitionId, page, status, clientId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const columns = useMemo<ColumnDefinition<RecurringOccurrenceListItem>[]>(() => [
    {
      title: t('recurring.history.columns.due', 'Due'),
      dataIndex: 'due_at',
      sortable: false,
      render: (_value, row) => formatInstant(row.due_at, i18n.language, timeZone) || formatCalendarDate(row.due_date, i18n.language),
    },
    {
      title: t('recurring.history.columns.client', 'Client'),
      dataIndex: 'client_name',
      sortable: false,
      render: (value) => value ?? '—',
    },
    {
      title: t('recurring.history.columns.status', 'Status'),
      dataIndex: 'status',
      sortable: false,
      render: (value: RecurringOccurrenceListItem['status']) => (
        <Badge variant={STATUS_BADGE[value]}>{t(`recurring.history.status.${value}`, value)}</Badge>
      ),
    },
    {
      title: t('recurring.history.columns.ticket', 'Ticket'),
      dataIndex: 'ticket_id',
      sortable: false,
      render: (_value, row) => (row.ticket_id ? (
        <Link
          id={`recurring-history-ticket-${row.occurrence_id}`}
          href={`/msp/tickets/${row.ticket_id}`}
          className="text-[rgb(var(--color-primary-600))] hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.ticket_number ?? row.ticket_id}
        </Link>
      ) : '—'),
    },
    {
      title: t('recurring.history.columns.reason', 'Reason'),
      dataIndex: 'reason',
      sortable: false,
      render: (value) => describeOccurrenceReason(value, t) || '—',
    },
  ], [t, i18n.language, timeZone]);

  return (
    <section id="recurring-history-section" className="space-y-3">
      <h2 className="text-lg font-semibold">{t('recurring.sections.history', 'History')}</h2>
      <div className="flex flex-wrap gap-3">
        <div className="w-48">
          <CustomSelect
            id="recurring-history-status-filter"
            value={status}
            onValueChange={(value) => { setStatus(value); setPage(1); }}
            options={[
              { value: ALL, label: t('recurring.history.allStatuses', 'All statuses') },
              ...RECURRING_OCCURRENCE_STATUSES.map((value) => ({
                value,
                label: t(`recurring.history.status.${value}`, value),
              })),
            ]}
          />
        </div>
        <div className="w-64">
          <CustomSelect
            id="recurring-history-client-filter"
            value={clientId}
            onValueChange={(value) => { setClientId(value); setPage(1); }}
            options={[
              { value: ALL, label: t('recurring.history.allClients', 'All clients') },
              ...clients.map((client) => ({ value: client.client_id, label: client.client_name })),
            ]}
          />
        </div>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {!loading && items.length === 0 && !error ? (
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('recurring.history.empty', 'Nothing has been generated yet.')}
        </p>
      ) : (
        <DataTable
          id="recurring-history-table"
          data={items}
          columns={columns}
          pagination
          currentPage={page}
          onPageChange={setPage}
          pageSize={PAGE_SIZE}
          totalItems={total}
        />
      )}
    </section>
  );
}

export default RecurringHistorySection;
