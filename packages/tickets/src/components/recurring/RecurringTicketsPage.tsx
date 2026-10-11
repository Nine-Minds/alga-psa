'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { describeRule } from '@alga-psa/shared/lib/recurrence';
import type { ColumnDefinition } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listRecurringTicketDefinitions } from '../../actions/recurringTicketActions';
import type { RecurringDefinitionListItem } from '../../lib/recurring/types';
import { formatInstant, toDescribeTranslate, unwrapRecurring } from './recurringUi';
import { useRecurringTicketPermissions } from './useRecurringTicketPermissions';

type Filter = 'active' | 'paused' | 'archived' | 'all';
const FILTERS: Filter[] = ['active', 'paused', 'archived', 'all'];

const STATUS_BADGE = { active: 'success', paused: 'warning', archived: 'default-muted' } as const;

/** The recurring tickets list: schedule, clients, next due date and a warning when the last run failed. */
export function RecurringTicketsPage() {
  const { t, i18n } = useTranslation('features/tickets');
  const router = useRouter();
  const permissions = useRecurringTicketPermissions();
  const [filter, setFilter] = useState<Filter>('active');
  const [items, setItems] = useState<RecurringDefinitionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(unwrapRecurring(await listRecurringTicketDefinitions(filter)));
    } catch (loadError) {
      // Includes the permission message: a user without `recurring_ticket:read` sees it instead of a table.
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const columns = useMemo<ColumnDefinition<RecurringDefinitionListItem>[]>(() => {
    const describeT = toDescribeTranslate((key, options) => t(key, options));
    return [
      {
        title: t('recurring.list.columns.name', 'Name'),
        dataIndex: 'name',
        render: (value, row) => (
          <span className="flex items-center gap-2">
            {value}
            {row.has_failure && (
              <span title={t('recurring.list.hasFailure', 'The latest run failed. Open it to see why.')}>
                <AlertTriangle
                  id={`recurring-list-failure-${row.definition_id}`}
                  className="h-4 w-4 text-[rgb(var(--color-status-warning))]"
                  aria-label={t('recurring.list.hasFailure', 'The latest run failed. Open it to see why.')}
                />
              </span>
            )}
          </span>
        ),
      },
      {
        title: t('recurring.list.columns.schedule', 'Schedule'),
        dataIndex: 'recurrence',
        sortable: false,
        render: (_value, row) => describeRule(row.recurrence, describeT),
      },
      { title: t('recurring.list.columns.clients', 'Clients'), dataIndex: 'client_count' },
      {
        title: t('recurring.list.columns.nextDue', 'Next due'),
        dataIndex: 'next_due_at',
        render: (value, row) => formatInstant(value, i18n.language, row.time_zone) || '—',
      },
      {
        title: t('recurring.list.columns.status', 'Status'),
        dataIndex: 'status',
        render: (value: RecurringDefinitionListItem['status']) => (
          <Badge variant={STATUS_BADGE[value]}>{t(`recurring.status.${value}`, value)}</Badge>
        ),
      },
    ];
  }, [t, i18n.language]);

  return (
    <div id="recurring-tickets-page" className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('recurring.list.title', 'Recurring tickets')}</h1>
        <div className="flex items-center gap-3">
          <div className="w-44">
            <CustomSelect
              id="recurring-tickets-filter"
              value={filter}
              onValueChange={(value) => setFilter(value as Filter)}
              options={FILTERS.map((value) => ({
                value,
                label: t(`recurring.list.filter.${value}`, value),
              }))}
            />
          </div>
          {permissions.create && (
            <Button id="recurring-tickets-new" type="button" onClick={() => router.push('/msp/tickets/recurring/new')}>
              {t('recurring.list.new', 'New recurring ticket')}
            </Button>
          )}
        </div>
      </div>

      {error && <Alert id="recurring-tickets-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {loading ? (
        <p id="recurring-tickets-loading" className="text-sm text-[rgb(var(--color-text-500))]">{t('recurring.loading', 'Loading…')}</p>
      ) : !error && items.length === 0 ? (
        <p id="recurring-tickets-empty" className="text-sm text-[rgb(var(--color-text-500))]">
          {t('recurring.list.empty', 'No recurring tickets here yet.')}
        </p>
      ) : (
        <DataTable
          id="recurring-tickets-table"
          data={items}
          columns={columns}
          pagination
          onRowClick={(row) => router.push(`/msp/tickets/recurring/${row.definition_id}`)}
        />
      )}
    </div>
  );
}

export default RecurringTicketsPage;
