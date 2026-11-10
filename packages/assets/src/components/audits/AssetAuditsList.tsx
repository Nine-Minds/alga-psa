'use client';

import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import type {
  AssetAuditListFilters,
  AssetAuditRecord,
  AssetAuditStatus,
  ColumnDefinition,
  IClientLocation,
} from '@alga-psa/types';
import { BentoChip } from '@alga-psa/ui/components/bento';
import { Button } from '@alga-psa/ui/components/Button';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { DateRangePicker, type DateRange } from '@alga-psa/ui/components/DateRangePicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getClientLocationsForAssets } from '../../actions/clientLookupActions';
import { dayRangeBounds } from '../../lib/audits/dayRange';
import {
  auditErrorText,
  auditStatusLabel,
  auditStatusTone,
  formatAuditDate,
  formatAuditRef,
  useAssetAuditCapability,
  useAssetAuditList,
} from './auditClient';
import { NO_LOCATION_VALUE, StartAuditDialog } from './StartAuditDialog';

const DEFAULT_PAGE_SIZE = 25;
const AUDIT_STATUSES: AssetAuditStatus[] = ['in_progress', 'completed', 'cancelled'];

/**
 * One of the four result counts. Missing and unexpected carry a tone when
 * non-zero: a run that found everything should read as quietly as it went.
 *
 * Counted columns are narrow and shrinkable: a percentage width is never taken
 * below the width its own title would need, so four of them at 7% claimed
 * 168px each and pushed "Started by", "Started" and "Completed" off the table
 * on a 1600px screen.
 */
function countColumn(
  key: 'expected_count' | 'present_count' | 'missing_count' | 'unexpected_count',
  title: string,
  tone?: 'danger' | 'warning',
): ColumnDefinition<AssetAuditRecord> {
  return {
    title,
    dataIndex: key,
    width: '92px',
    minWidth: '64px',
    render: (value: unknown) => {
      const count = Number(value ?? 0);
      const emphasise = Boolean(tone) && count > 0;
      return (
        <span
          className={
            emphasise
              ? tone === 'danger'
                ? 'font-semibold text-red-600 dark:text-red-400'
                : 'font-semibold text-amber-700 dark:text-amber-400'
              : undefined
          }
        >
          {count}
        </span>
      );
    },
  };
}

export interface AssetAuditsListProps {
  /** Pre-filter to one client and hide the client filter (client drawer tab). */
  clientId?: string;
  /** Drop the page heading when the surface already has one (drawer tab). */
  embedded?: boolean;
  id?: string;
}

/**
 * Site audits for the tenant, or for one client inside the client drawer.
 *
 * Audits are client-keyed, so the same table serves both: the drawer passes
 * `clientId` and loses the client filter, everything else is identical. Newest
 * first, server-paged, and the row opens the run's detail page.
 */
export function AssetAuditsList({ clientId, embedded = false, id = 'asset-audits' }: AssetAuditsListProps) {
  const { t, i18n } = useTranslation('msp/assets');
  const router = useRouter();
  const { canUpdate } = useAssetAuditCapability();

  const [clientFilter, setClientFilter] = useState<string | null>(clientId ?? null);
  const [locationValue, setLocationValue] = useState('');
  const [status, setStatus] = useState<AssetAuditStatus | ''>('');
  const [range, setRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [startOpen, setStartOpen] = useState(false);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  const effectiveClientId = clientId ?? clientFilter ?? undefined;

  const filters = useMemo<AssetAuditListFilters>(
    () => ({
      page,
      limit: pageSize,
      ...(effectiveClientId ? { client_id: effectiveClientId } : {}),
      ...(locationValue === NO_LOCATION_VALUE
        ? { no_location: true }
        : locationValue
          ? { location_id: locationValue }
          : {}),
      ...(status ? { status } : {}),
      ...dayRangeBounds(range),
    }),
    [page, pageSize, effectiveClientId, locationValue, status, range],
  );

  const { data, error, isLoading, mutate } = useAssetAuditList(filters);

  // Locations are a per-client list, so the filter only has answers once a
  // client is in play — it stays disabled rather than offering every location
  // in the tenant, which would not narrow anything on its own.
  const { data: locations } = useSWR<IClientLocation[]>(
    effectiveClientId ? [id, 'locations', effectiveClientId] : null,
    async () => {
      const rows = await getClientLocationsForAssets(effectiveClientId!);
      return Array.isArray(rows) ? rows : [];
    },
  );

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const openAudit = (audit: AssetAuditRecord) => router.push(`/msp/assets/audits/${audit.audit_id}`);

  const columns: ColumnDefinition<AssetAuditRecord>[] = useMemo(
    () => [
      // The run itself comes first and is the obvious link: the client name used
      // to be the only thing on the row that looked clickable, which sent people
      // to the client drawer when they meant to open the audit.
      {
        title: t('assetAudits.columns.audit', { defaultValue: 'Audit' }),
        dataIndex: 'audit_id',
        sortable: false,
        width: '110px',
        minWidth: '96px',
        render: (_value: unknown, row: AssetAuditRecord) => (
          <button
            id={`${id}-audit-link-${row.audit_id}`}
            type="button"
            className="text-left font-mono text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              router.push(`/msp/assets/audits/${row.audit_id}`);
            }}
          >
            {formatAuditRef(row.audit_id)}
          </button>
        ),
      } as ColumnDefinition<AssetAuditRecord>,
      ...(clientId
        ? []
        : [
            {
              title: t('assetAudits.columns.client', { defaultValue: 'Client' }),
              dataIndex: 'client_name',
              minWidth: '140px',
              render: (_value: unknown, row: AssetAuditRecord) => (
                <button
                  id={`${id}-client-link-${row.audit_id}`}
                  type="button"
                  className="text-left text-[rgb(var(--color-primary-600))] hover:underline"
                  onClick={(event) => {
                    event.stopPropagation();
                    router.push(`/msp/clients/${row.client_id}?tab=audits`);
                  }}
                >
                  {row.client_name || '—'}
                </button>
              ),
            } as ColumnDefinition<AssetAuditRecord>,
          ]),
      {
        title: t('assetAudits.columns.location', { defaultValue: 'Location' }),
        dataIndex: 'location_name',
        minWidth: '120px',
        render: (_value: unknown, row: AssetAuditRecord) =>
          row.location_id
            ? row.location_name || '—'
            : t('assetAudits.noLocation', { defaultValue: 'No location' }),
      },
      {
        title: t('assetAudits.columns.status', { defaultValue: 'Status' }),
        dataIndex: 'status',
        width: '120px',
        minWidth: '100px',
        render: (value: unknown) => (
          <BentoChip tone={auditStatusTone(value as AssetAuditStatus)}>
            {auditStatusLabel(t, value as AssetAuditStatus)}
          </BentoChip>
        ),
      },
      {
        title: t('assetAudits.columns.startedBy', { defaultValue: 'Started by' }),
        dataIndex: 'started_by_name',
        minWidth: '120px',
        render: (value: unknown) => (value as string) || '—',
      },
      {
        title: t('assetAudits.columns.started', { defaultValue: 'Started' }),
        dataIndex: 'started_at',
        minWidth: '100px',
        render: (value: unknown) => formatAuditDate(value as string, i18n?.language),
      },
      {
        title: t('assetAudits.columns.completed', { defaultValue: 'Completed' }),
        dataIndex: 'completed_at',
        minWidth: '100px',
        render: (value: unknown) => formatAuditDate(value as string | null, i18n?.language),
      },
      countColumn('expected_count', t('assetAudits.columns.expected', { defaultValue: 'Expected' })),
      countColumn('present_count', t('assetAudits.columns.present', { defaultValue: 'Present' })),
      countColumn('missing_count', t('assetAudits.columns.missing', { defaultValue: 'Missing' }), 'danger'),
      countColumn(
        'unexpected_count',
        t('assetAudits.columns.unexpected', { defaultValue: 'Unexpected' }),
        'warning',
      ),
    ],
    [t, i18n?.language, clientId, id, router],
  );

  return (
    <div id={id} className={embedded ? 'space-y-4' : 'space-y-4 p-6'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {embedded ? null : (
          <h1 className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">
            {t('assetAudits.title', { defaultValue: 'Site audits' })}
          </h1>
        )}
        {canUpdate ? (
          <Button id={`${id}-start-audit-button`} onClick={() => setStartOpen(true)}>
            {t('assetAudits.startAudit', { defaultValue: 'Start audit' })}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {clientId ? null : (
          <ClientPicker
            id={`${id}-client-filter`}
            selectedClientId={clientFilter}
            onSelect={(value) => {
              setClientFilter(value);
              setLocationValue('');
              setPage(1);
            }}
            filterState={clientFilterState}
            onFilterStateChange={setClientFilterState}
            clientTypeFilter={clientTypeFilter}
            onClientTypeFilterChange={setClientTypeFilter}
            placeholder={t('assetAudits.filters.client', { defaultValue: 'Client' })}
            fitContent
            triggerVariant="ghost"
            triggerSize="sm"
          />
        )}
        <CustomSelect
          id={`${id}-location-filter`}
          value={locationValue}
          onValueChange={resetPage(setLocationValue)}
          disabled={!effectiveClientId}
          options={[
            { value: '', label: t('assetAudits.filters.allLocations', { defaultValue: 'All locations' }) },
            { value: NO_LOCATION_VALUE, label: t('assetAudits.noLocation', { defaultValue: 'No location' }) },
            ...(locations ?? []).map((location) => ({
              value: location.location_id,
              label: location.location_name || location.address_line1 || location.location_id,
            })),
          ]}
          className="min-w-[180px]"
        />
        <CustomSelect
          id={`${id}-status-filter`}
          value={status}
          onValueChange={resetPage((value: string) => setStatus(value as AssetAuditStatus | ''))}
          options={[
            { value: '', label: t('assetAudits.filters.allStatuses', { defaultValue: 'All statuses' }) },
            ...AUDIT_STATUSES.map((value) => ({ value, label: auditStatusLabel(t, value) })),
          ]}
          className="min-w-[160px]"
        />
        <DateRangePicker
          id={`${id}-started-filter`}
          label={t('assetAudits.filters.started', { defaultValue: 'Started' })}
          value={range}
          onChange={resetPage(setRange)}
          containerClassName="space-y-1"
        />
      </div>

      {error ? (
        <div
          id={`${id}-error`}
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-[rgb(var(--color-accent-300))] bg-[rgb(var(--color-accent-50))] p-3 text-sm text-[rgb(var(--color-accent-700))]"
        >
          <span>{auditErrorText(t, error)}</span>
          <Button id={`${id}-retry-button`} variant="outline" size="sm" onClick={() => void mutate()}>
            {t('common.actions.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      ) : null}

      <DataTable
        id={`${id}-table`}
        data={data?.audits ?? []}
        columns={columns}
        pagination
        currentPage={page}
        pageSize={pageSize}
        totalItems={data?.total ?? 0}
        onPageChange={setPage}
        onItemsPerPageChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onRowClick={openAudit}
        manualSorting={false}
      />

      {isLoading ? (
        <p id={`${id}-loading`} className="text-sm text-[rgb(var(--color-text-400))]">
          {t('assetAudits.loading', { defaultValue: 'Loading audits…' })}
        </p>
      ) : !error && (data?.audits?.length ?? 0) === 0 ? (
        <p id={`${id}-empty`} className="text-sm text-[rgb(var(--color-text-400))]">
          {t('assetAudits.empty', { defaultValue: 'No site audits match this view yet.' })}
        </p>
      ) : null}

      {startOpen ? (
        <StartAuditDialog
          open={startOpen}
          onOpenChange={setStartOpen}
          clientId={effectiveClientId ?? null}
          onStarted={(auditId) => {
            void mutate();
            router.push(`/msp/assets/audits/${auditId}`);
          }}
        />
      ) : null}
    </div>
  );
}

export default AssetAuditsList;
