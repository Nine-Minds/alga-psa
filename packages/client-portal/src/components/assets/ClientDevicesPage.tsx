'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset, ColumnDefinition } from '@alga-psa/types';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import {
  Laptop,
  Server,
  Smartphone,
  Printer,
  Network,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  Search,
  MoreVertical,
  PlusCircle,
} from 'lucide-react';
import {
  listClientAssets,
  type ClientAssetType,
  type ClientAssetSortField,
  type ListClientAssetsResponse,
} from '@alga-psa/client-portal/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useSetClientPortalHeader } from '../layout/ClientPortalPageContext';
import { AssetDetails } from './AssetDetails';
import { ClientAddTicket } from '../tickets/ClientAddTicket';

type TranslateFn = ReturnType<typeof useTranslation>['t'];

function iconForType(type: Asset['asset_type']) {
  switch (type) {
    case 'workstation':
      return Laptop;
    case 'server':
      return Server;
    case 'mobile_device':
      return Smartphone;
    case 'printer':
      return Printer;
    case 'network_device':
      return Network;
    default:
      return HardDrive;
  }
}

function labelForType(type: Asset['asset_type'], t: TranslateFn) {
  switch (type) {
    case 'workstation':
      return t('devices.types.workstation', 'Workstations');
    case 'server':
      return t('devices.types.server', 'Servers');
    case 'mobile_device':
      return t('devices.types.mobile', 'Mobile');
    case 'printer':
      return t('devices.types.printer', 'Printers');
    case 'network_device':
      return t('devices.types.network', 'Network');
    default:
      return t('devices.types.unknown', 'Other');
  }
}

const PAGE_SIZE = 10;

export function ClientDevicesPage() {
  const { t } = useTranslation('client-portal');

  // Set the dynamic page header for routes that want to override the default.
  useSetClientPortalHeader(
    { title: t('devices.pageTitle', 'My devices') },
    [t],
  );

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ClientAssetType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [sortBy, setSortBy] = useState<ClientAssetSortField>('updated_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const [response, setResponse] = useState<ListClientAssetsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [ticketAsset, setTicketAsset] = useState<Asset | null>(null);

  // Debounce search input.
  useEffect(() => {
    const trimmed = search.trim();
    const handle = window.setTimeout(() => setDebouncedSearch(trimmed), 250);
    return () => window.clearTimeout(handle);
  }, [search]);

  // Reset to page 1 when filters change.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, typeFilter, statusFilter]);

  // Fetch.
  useEffect(() => {
    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    setLoading(true);
    (async () => {
      try {
        const result = await listClientAssets({
          page,
          limit: pageSize,
          search: debouncedSearch || undefined,
          asset_type: typeFilter === 'all' ? undefined : typeFilter,
          status: statusFilter === 'all' ? undefined : statusFilter,
          sort_by: sortBy,
          sort_direction: sortDirection,
        });
        if (requestIdRef.current === id) {
          setResponse(result);
          setError(null);
        }
      } catch (err) {
        console.error('Failed to load assets', err);
        if (requestIdRef.current === id) {
          setError(err instanceof Error ? err.message : 'Failed to load devices');
        }
      } finally {
        if (requestIdRef.current === id) setLoading(false);
      }
    })();
  }, [page, pageSize, debouncedSearch, typeFilter, statusFilter, sortBy, sortDirection]);

  const summaryTiles = useMemo(() => {
    if (!response) return [];
    // by_type is computed server-side across the entire client, so the tile
    // counts stay correct regardless of paging or filters.
    return (Object.keys(response.by_type) as Array<Asset['asset_type']>)
      .map((type) => ({ type, count: response.by_type[type] }))
      .filter((entry) => entry.count > 0);
  }, [response]);

  const columns: ColumnDefinition<Asset>[] = [
    {
      title: t('devices.columns.name', 'Name'),
      dataIndex: 'name',
      render: (value: string, record: Asset) => (
        <button
          type="button"
          className="font-medium text-left hover:text-[rgb(var(--color-primary-600))]"
          onClick={() => setSelectedAsset(record)}
        >
          {value}
        </button>
      ),
    },
    {
      title: t('devices.columns.type', 'Type'),
      dataIndex: 'asset_type',
      render: (value: Asset['asset_type']) => labelForType(value, t),
    },
    {
      title: t('devices.columns.status', 'Status'),
      dataIndex: 'status',
      render: (value: string) => {
        const isInactive = value === 'inactive';
        return (
          <Badge variant={isInactive ? 'default' : 'success'}>
            {isInactive
              ? t('devices.status.inactive', 'Inactive')
              : t('devices.status.active', 'Active')}
          </Badge>
        );
      },
    },
    {
      title: t('devices.columns.location', 'Location'),
      dataIndex: 'location',
      render: (value?: string) => value || t('devices.notAvailable', 'N/A'),
    },
    {
      title: t('devices.columns.updated', 'Updated'),
      dataIndex: 'updated_at',
      render: (value: string) => {
        try {
          const d = new Date(value);
          return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
        } catch {
          return '—';
        }
      },
    },
    {
      title: t('devices.columns.actions', 'Actions'),
      dataIndex: 'asset_id',
      sortable: false,
      render: (_value: string, record: Asset) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`devices-row-actions-${record.asset_id}`}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
              aria-label={t('devices.rowActionsLabel', 'Row actions')}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`devices-create-ticket-${record.asset_id}`}
              onSelect={() => setTicketAsset(record)}
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              {t('devices.createTicket', 'Create ticket')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (error && !response) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-[rgb(var(--color-text-700))]">
          {error}
        </CardContent>
      </Card>
    );
  }

  const assets = response?.assets ?? [];
  const total = response?.total ?? 0;
  const activeCount = response?.active ?? 0;
  const inactiveCount = response?.inactive ?? 0;
  const allActive = inactiveCount === 0 && activeCount > 0;

  const showEmptyState = !loading && total === 0 && !debouncedSearch && typeFilter === 'all' && statusFilter === 'all';

  return (
    <div className="space-y-6">
      {/* Status banner */}
      {response && activeCount + inactiveCount > 0 && (
        allActive ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-emerald-900">
                {t('devices.statusOkTitle', 'All devices active')}
              </div>
              <div className="text-xs text-emerald-700">
                {t('devices.statusOkBody', { defaultValue: '{{count}} devices reporting in', count: activeCount })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-amber-900">
                {t('devices.statusWarnTitle', 'Some devices inactive')}
              </div>
              <div className="text-xs text-amber-700">
                {t('devices.statusWarnBody', {
                  defaultValue: '{{active}} active · {{inactive}} inactive',
                  active: activeCount,
                  inactive: inactiveCount,
                })}
              </div>
            </div>
          </div>
        )
      )}

      {/* Summary tiles (current page) */}
      {summaryTiles.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {summaryTiles.map(({ type, count }) => {
            const Icon = iconForType(type);
            return (
              <div
                key={type}
                className="rounded-xl border border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-card))] px-4 py-3"
              >
                <div className="flex items-center gap-2 text-[rgb(var(--color-text-600))]">
                  <Icon className="h-4 w-4" />
                  <span className="text-xs">{labelForType(type, t)}</span>
                </div>
                <div className="mt-1 text-2xl font-semibold text-[rgb(var(--color-text-900))]">
                  {count}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--color-text-400))]" />
              <Input
                id="devices-search"
                placeholder={t('devices.searchPlaceholder', 'Search by name, tag, or serial')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <CustomSelect
              data-automation-id="devices-type-filter"
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v as ClientAssetType | 'all')}
              options={[
                { value: 'all', label: t('devices.filters.allTypes', 'All types') },
                { value: 'workstation', label: t('devices.types.workstation', 'Workstations') },
                { value: 'server', label: t('devices.types.server', 'Servers') },
                { value: 'mobile_device', label: t('devices.types.mobile', 'Mobile') },
                { value: 'printer', label: t('devices.types.printer', 'Printers') },
                { value: 'network_device', label: t('devices.types.network', 'Network') },
                { value: 'unknown', label: t('devices.types.unknown', 'Other') },
              ]}
            />
            <CustomSelect
              data-automation-id="devices-status-filter"
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'all' | 'active' | 'inactive')}
              options={[
                { value: 'all', label: t('devices.filters.allStatuses', 'All statuses') },
                { value: 'active', label: t('devices.status.active', 'Active') },
                { value: 'inactive', label: t('devices.status.inactive', 'Inactive') },
              ]}
            />
            {(search || typeFilter !== 'all' || statusFilter !== 'all') && (
              <Button
                id="devices-clear-filters"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setTypeFilter('all');
                  setStatusFilter('all');
                }}
              >
                {t('devices.clearFilters', 'Clear filters')}
              </Button>
            )}
          </div>

          {showEmptyState ? (
            <div className="p-8 text-center">
              <HardDrive className="mx-auto mb-3 h-12 w-12 text-[rgb(var(--color-text-400))]" />
              <div className="text-base font-medium text-[rgb(var(--color-text-900))]">
                {t('devices.empty.title', 'No devices yet')}
              </div>
              <p className="mt-1 text-sm text-[rgb(var(--color-text-600))]">
                {t('devices.empty.body', 'Devices your provider manages will appear here.')}
              </p>
            </div>
          ) : loading && !response ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              id="client-portal-devices-table"
              data={assets}
              columns={columns}
              pagination
              currentPage={page}
              onPageChange={setPage}
              pageSize={pageSize}
              onItemsPerPageChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              totalItems={total}
              manualSorting={true}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSortChange={(field, direction) => {
                if (field in { name: 1, asset_type: 1, status: 1, updated_at: 1 }) {
                  setSortBy(field as ClientAssetSortField);
                  setSortDirection(direction);
                }
              }}
              onRowClick={(asset) => setSelectedAsset(asset as Asset)}
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        isOpen={!!selectedAsset}
        onClose={() => setSelectedAsset(null)}
        title={selectedAsset?.name || t('devices.detailsTitle', 'Asset details')}
      >
        {selectedAsset && (
          <AssetDetails
            asset={selectedAsset}
            onCreateTicket={(asset) => {
              setSelectedAsset(null);
              setTicketAsset(asset);
            }}
          />
        )}
      </Dialog>

      <ClientAddTicket
        open={!!ticketAsset}
        onOpenChange={(o) => {
          if (!o) setTicketAsset(null);
        }}
        assetId={ticketAsset?.asset_id}
        assetName={ticketAsset?.name}
      />
    </div>
  );
}

export default ClientDevicesPage;
