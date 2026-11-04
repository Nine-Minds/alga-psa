'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Search } from 'lucide-react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { isTileActionError } from '@alga-psa/ui/components/bento';
import { getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import { unparseCSV } from '@alga-psa/core';
import type {
  ClientSoftwareSortField,
  ClientSoftwareSummaryParams,
  ClientSoftwareSummaryResponse,
  ClientSoftwareSummaryRow,
  ColumnDefinition,
} from '@alga-psa/types';
import { CLIENT_SOFTWARE_ASSET_PREVIEW_LIMIT, CLIENT_SOFTWARE_PAGE_SIZE } from '@alga-psa/types';
import { useFocusViewNavigation } from './FocusViewNavigation';

type TFn = (key: string, options?: Record<string, unknown>) => string;

export type GetClientSoftwareSummary = (
  params: ClientSoftwareSummaryParams
) => Promise<ClientSoftwareSummaryResponse | { actionError?: unknown; permissionError?: unknown }>;

interface ClientSoftwareViewProps {
  id: string;
  clientId: string;
  getSummary: GetClientSoftwareSummary;
  /**
   * Opens this client's Assets view for the empty-state link. Defaults to the
   * sibling Assets focus view when hosted in one; falls back to the assets list.
   */
  onOpenAssets?: (() => void) | null;
  t: TFn;
}

type Row = ClientSoftwareSummaryRow & { id: string };

const SEARCH_DEBOUNCE_MS = 300;

/** Per-asset Software tab, pre-filtered to the title (SoftwareInventoryTab reads ?software=). */
export const assetSoftwareHref = (assetId: string, title: string): string =>
  `/msp/assets/${assetId}?tab=software&software=${encodeURIComponent(title)}`;

/**
 * Software focus view: every title installed across the client's assets,
 * grouped by catalog id. Read-only; rows expand to the devices carrying it.
 */
export default function ClientSoftwareView({ id, clientId, getSummary, onOpenAssets, t }: ClientSoftwareViewProps) {
  const focusNavigation = useFocusViewNavigation();
  const openAssets = onOpenAssets
    ?? (focusNavigation?.hasView('assets') ? () => focusNavigation.openView('assets') : null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<ClientSoftwareSortField>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [data, setData] = useState<ClientSoftwareSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSummary({ clientId, search: search || undefined, page, sortBy, sortDir })
      .then((result) => {
        if (cancelled) return;
        if (isTileActionError(result)) {
          setError(getErrorMessage(result));
          return;
        }
        setData(result as ClientSoftwareSummaryResponse);
      })
      .catch((err: unknown) => {
        console.error('Failed to load client software:', err);
        if (!cancelled) setError(t('clientSoftware.loadError', { defaultValue: 'Could not load software inventory.' }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getSummary, clientId, search, page, sortBy, sortDir, t]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await getSummary({ clientId, search: search || undefined, page: 'all', sortBy, sortDir });
      if (isTileActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      const rows = (result as ClientSoftwareSummaryResponse).rows.map((row) => ({
        title: row.title,
        versions: row.versions.join('; '),
        assets: row.asset_count,
        last_seen: row.last_seen ?? '',
      }));
      const csv = unparseCSV(rows, ['title', 'versions', 'assets', 'last_seen']);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      // LEVERAGE: pattern csv-blob-download — third copy of the Blob/anchor/revoke download dance (Clients.tsx, SpendByBillingProfileReport.tsx).
      link.href = url;
      link.download = 'client-software.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export client software:', err);
      setError(t('clientSoftware.exportError', { defaultValue: 'Could not export software inventory.' }));
    } finally {
      setExporting(false);
    }
  }, [getSummary, clientId, search, sortBy, sortDir, t]);

  const rows = useMemo<Row[]>(() => (data?.rows ?? []).map((row) => ({ ...row, id: row.software_id })), [data]);
  const emptyValue = t('common.states.notAvailable', { defaultValue: '—' });

  const columns = useMemo<ColumnDefinition<Row>[]>(() => [
    {
      title: t('clientSoftware.columns.title', { defaultValue: 'Title' }),
      dataIndex: 'title',
      id: 'title',
      render: (title: string) => title,
    },
    {
      title: t('clientSoftware.columns.versions', { defaultValue: 'Versions' }),
      dataIndex: 'versions',
      id: 'versions',
      sortable: false,
      render: (versions: string[]) => (versions.length ? versions.join(', ') : emptyValue),
    },
    {
      title: t('clientSoftware.columns.assets', { defaultValue: 'Assets' }),
      dataIndex: 'asset_count',
      id: 'asset_count',
      render: (count: number) => <span className="tabular-nums">{count}</span>,
    },
    {
      title: t('clientSoftware.columns.lastSeen', { defaultValue: 'Last seen' }),
      dataIndex: 'last_seen',
      id: 'last_seen',
      sortable: false,
      render: (value: string | null) => (value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : emptyValue),
    },
  ], [t, emptyValue]);

  const renderExpanded = (row: Row): React.ReactNode => {
    if (expandedId !== row.software_id) return null;
    const hidden = row.asset_count - row.assets.length;
    return (
      <div id={`${id}-assets-${row.software_id}`} className="px-4 py-3 bg-[rgb(var(--color-border-50))]">
        <div className="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--color-text-500))] mb-2">
          {t('clientSoftware.installedOn', { defaultValue: 'Installed on' })}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {row.assets.map((asset) => (
            <li key={asset.asset_id}>
              <Link
                id={`${id}-asset-link-${row.software_id}-${asset.asset_id}`}
                href={assetSoftwareHref(asset.asset_id, row.title)}
                className="text-primary-600 hover:text-primary-800 hover:underline"
              >
                {asset.name}
              </Link>
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <p className="mt-2 text-xs text-[rgb(var(--color-text-500))]">
            {t('clientSoftware.moreAssets', {
              defaultValue: 'and {{count}} more (showing the first {{limit}} by name)',
              count: hidden,
              limit: CLIENT_SOFTWARE_ASSET_PREVIEW_LIMIT,
            })}
          </p>
        )}
      </div>
    );
  };

  const isEmpty = !loading && !error && data !== null && data.total === 0 && !search;

  return (
    <div id={id} className="bg-white p-6 rounded-lg shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
          <Input
            id={`${id}-search`}
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('clientSoftware.searchPlaceholder', { defaultValue: 'Search software...' })}
            aria-label={t('clientSoftware.searchPlaceholder', { defaultValue: 'Search software...' })}
          />
        </div>
        <Button
          id={`${id}-export-csv`}
          variant="outline"
          size="sm"
          onClick={() => void handleExport()}
          disabled={exporting || !data || data.total === 0}
        >
          <Download className="w-4 h-4 mr-1.5" aria-hidden="true" />
          {t('clientSoftware.exportCsv', { defaultValue: 'Export CSV' })}
        </Button>
      </div>

      {error && <p id={`${id}-error`} className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {isEmpty ? (
        <div id={`${id}-empty`} className="py-10 text-center text-sm text-[rgb(var(--color-text-600))]">
          <p>{t('clientSoftware.empty', { defaultValue: 'No software inventory yet — inventory is collected per device' })}</p>
          {openAssets ? (
            <button
              id={`${id}-empty-assets-link`}
              type="button"
              onClick={openAssets}
              className="mt-2 font-semibold text-primary-600 hover:text-primary-800 hover:underline"
            >
              {t('clientSoftware.emptyAssetsLink', { defaultValue: 'View assets' })}
            </button>
          ) : (
            <Link
              id={`${id}-empty-assets-link`}
              href="/msp/assets"
              className="mt-2 inline-block font-semibold text-primary-600 hover:text-primary-800 hover:underline"
            >
              {t('clientSoftware.emptyAssetsLink', { defaultValue: 'View assets' })}
            </Link>
          )}
        </div>
      ) : (
        <DataTable
          id={`${id}-table`}
          data={rows}
          columns={columns}
          pagination
          persistPageSize={false}
          pageSize={CLIENT_SOFTWARE_PAGE_SIZE}
          currentPage={page}
          onPageChange={(next) => { setPage(next); setExpandedId(null); }}
          totalItems={data?.total ?? 0}
          manualSorting
          sortBy={sortBy === 'assets' ? 'asset_count' : 'title'}
          sortDirection={sortDir}
          onSortChange={(columnId, direction) => {
            setSortBy(columnId === 'asset_count' ? 'assets' : 'title');
            setSortDir(direction);
            setPage(1);
            setExpandedId(null);
          }}
          onRowClick={(row) => setExpandedId((current) => (current === row.software_id ? null : row.software_id))}
          expandedRowRender={renderExpanded}
        />
      )}
    </div>
  );
}
