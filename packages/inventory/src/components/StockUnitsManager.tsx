'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ClientNameCell } from '@alga-psa/ui/components/ClientNameCell';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { PackageSearch } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IStockLocation, IStockMovement, IStockUnit } from '@alga-psa/types';
import {
  getUnitDetail,
  listStockLocations,
  listStockUnits,
  searchUnitsByMac,
  searchUnitsBySerial,
} from '../actions';

type SearchMode = 'serial' | 'mac';
type UnitDetail = { unit: IStockUnit; movements: IStockMovement[] };

function fmtDate(v?: string | Date | null): string {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

function fmtDateTime(v?: string | Date | null): string {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function fmtCents(v?: number | string | null): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v); // pg returns bigint columns as strings
  return Number.isFinite(n) ? `$${(n / 100).toFixed(2)}` : '';
}

/** Normalize a MAC to canonical upper-case, colon-grouped form for display. */
function fmtMac(v?: string | null): string {
  if (!v) return '';
  const hex = v.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return v.toUpperCase(); // leave unexpected shapes as-is
  return hex.match(/.{2}/g)!.join(':');
}

function csvValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function csvEscape(v: unknown): string {
  const s = csvValue(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

// A distinct, semantic variant for every one of the 8 unit statuses, so the
// status color is a reliable scan signal. The old map colored only 4 and let
// the other 4 (allocated/in_transit/on_loan/returned) silently share retired's
// grey. `default` is a visibly-neutral catch-all so a new status can never
// masquerade as an existing one.
function statusVariant(v?: string | null) {
  switch (v) {
    case 'in_stock':
      return 'info' as const; // available at a location
    case 'allocated':
      return 'primary' as const; // reserved to an order
    case 'in_transit':
      return 'outline' as const; // moving between locations
    case 'on_loan':
      return 'warning' as const; // out with a client, due back
    case 'delivered':
      return 'success' as const; // shipped to the client
    case 'returned':
      return 'secondary' as const; // came back from the client
    case 'in_rma':
      return 'error' as const; // out for repair/replacement
    case 'retired':
      return 'default-muted' as const; // end of life
    default:
      return 'default-muted' as const;
  }
}

export function StockUnitsManager({ initialUnits }: { initialUnits: IStockUnit[] }) {
  const { t } = useTranslation('features/inventory');

  const SEARCH_MODE_OPTIONS = [
    { value: 'serial', label: t('stockUnits.searchMode.serial', 'Serial number') },
    { value: 'mac', label: t('stockUnits.searchMode.mac', 'MAC address') },
  ];

  // Localized display label per raw unit status (statusVariant still keys off the raw value).
  // Unknown values fall back to the humanized raw string so behavior never regresses.
  const UNIT_STATUS_LABELS: Record<string, string> = {
    in_stock: t('stockUnits.status.inStock', 'In stock'),
    allocated: t('stockUnits.status.allocated', 'Allocated'),
    in_transit: t('stockUnits.status.inTransit', 'In transit'),
    on_loan: t('stockUnits.status.onLoan', 'On loan'),
    delivered: t('stockUnits.status.delivered', 'Delivered'),
    returned: t('stockUnits.status.returned', 'Returned'),
    in_rma: t('stockUnits.status.inRma', 'In RMA'),
    retired: t('stockUnits.status.retired', 'Retired'),
  };
  const humanizeStatus = (v?: string | null): string => {
    if (!v) return t('common.emptyValue', '—');
    return UNIT_STATUS_LABELS[v] ?? v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  };

  const [units, setUnits] = useState<IStockUnit[]>(initialUnits || []);
  const [searchMode, setSearchMode] = useState<SearchMode>('serial');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<IStockLocation[] | null>(null);
  const [historyDetail, setHistoryDetail] = useState<UnitDetail | null>(null);
  const [historyLoadingUnitId, setHistoryLoadingUnitId] = useState<string | null>(null);

  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of locations || []) {
      map.set(loc.location_id, loc.name);
    }
    return map;
  }, [locations]);

  const locationName = useCallback(
    (locationId?: string | null) => {
      if (!locationId) return t('common.emptyValue', '—');
      return locationMap.get(locationId) || locationId;
    },
    [locationMap, t],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setUnits(await listStockUnits({}));
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('stockUnits.loadFailed', 'Failed to load units'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const runSearch = useCallback(async () => {
    const term = query.trim();
    if (!term) {
      await reload();
      return;
    }
    setLoading(true);
    try {
      const results =
        searchMode === 'serial'
          ? await searchUnitsBySerial(term)
          : await searchUnitsByMac(term);
      setUnits(results);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('stockUnits.searchFailed', 'Search failed'));
    } finally {
      setLoading(false);
    }
  }, [query, searchMode, reload, t]);

  const clearSearch = useCallback(async () => {
    setQuery('');
    await reload();
  }, [reload]);

  const openHistory = useCallback(
    async (unitId: string) => {
      setHistoryLoadingUnitId(unitId);
      try {
        const [detail, loadedLocations] = await Promise.all([
          getUnitDetail(unitId),
          locations === null ? listStockLocations() : Promise.resolve(locations),
        ]);
        if (!detail) {
          toast.error(t('stockUnits.historyNotFound', 'Unit history not found'));
          return;
        }
        if (locations === null) {
          setLocations(loadedLocations);
        }
        setHistoryDetail(detail);
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || t('stockUnits.historyLoadFailed', 'Failed to load unit history'));
      } finally {
        setHistoryLoadingUnitId(null);
      }
    },
    [locations, t],
  );

  const exportCsv = useCallback(() => {
    // Export exactly what the table shows: resolved names, humanized status —
    // not raw FK UUIDs or enum values.
    const headers = [
      t('stockUnits.columns.serialNumber', 'Serial Number'),
      t('stockUnits.columns.macAddress', 'MAC Address'),
      t('common.status', 'Status'),
      t('stockUnits.columns.location', 'Location'),
      t('stockUnits.columns.client', 'Client'),
      t('stockUnits.columns.warrantyExpires', 'Warranty Expires'),
    ];
    const rows = units.map((unit) => [
      unit.serial_number,
      fmtMac(unit.mac_address),
      humanizeStatus(unit.status),
      unit.location_name,
      unit.client_name,
      fmtDate(unit.warranty_expires_at),
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.id = 'stock-units-export-csv-download';
    link.href = url;
    link.download = 'stock-units.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [units, t]);

  const emptyCell = <span className="text-[rgb(var(--color-text-400))]">{t('common.emptyValue', '—')}</span>;

  const columns: ColumnDefinition<IStockUnit>[] = [
    {
      title: t('stockUnits.columns.serialNumber', 'Serial Number'),
      dataIndex: 'serial_number',
      render: (value: string | null | undefined) =>
        value ? <span className="font-mono">{value}</span> : emptyCell,
    },
    {
      title: t('stockUnits.columns.macAddress', 'MAC Address'),
      dataIndex: 'mac_address',
      render: (value: string | null | undefined) => {
        const mac = fmtMac(value);
        return mac ? <span className="font-mono">{mac}</span> : emptyCell;
      },
    },
    {
      title: t('common.status', 'Status'),
      dataIndex: 'status',
      render: (v: any) => (
        <Badge variant={statusVariant(v)} size="sm">
          {humanizeStatus(v)}
        </Badge>
      ),
    },
    {
      title: t('stockUnits.columns.location', 'Location'),
      dataIndex: 'location_id',
      render: (_value: unknown, record: IStockUnit) =>
        record.location_name ? <span>{record.location_name}</span> : emptyCell,
    },
    {
      title: t('stockUnits.columns.client', 'Client'),
      dataIndex: 'client_id',
      render: (_value: unknown, record: IStockUnit) => (
        <ClientNameCell clientId={record.client_id} clientName={record.client_name} />
      ),
    },
    {
      title: t('stockUnits.columns.warrantyExpires', 'Warranty Expires'),
      dataIndex: 'warranty_expires_at',
      render: (value: string | Date | null | undefined) => {
        const d = fmtDate(value);
        return d ? <span>{d}</span> : emptyCell;
      },
    },
    {
      title: t('common.actions', 'Actions'),
      dataIndex: 'unit_id',
      width: '120px',
      headerClassName: 'text-right',
      sortable: false,
      render: (_value: unknown, rec: IStockUnit) => (
        <div className="flex justify-end">
          <Button
            id={`unit-history-${rec.unit_id}`}
            variant="ghost"
            size="sm"
            onClick={() => openHistory(rec.unit_id)}
            disabled={historyLoadingUnitId !== null}
          >
            {historyLoadingUnitId === rec.unit_id ? t('common.loading', 'Loading…') : t('stockUnits.history', 'History')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="stock-units-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('stockUnits.title', 'Stock Units')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {units.length === 1
              ? t('stockUnits.summary.one', '{{n}} unit', { n: units.length })
              : t('stockUnits.summary.many', '{{n}} units', { n: units.length })}
          </p>
        </div>
        <Button id="stock-units-refresh-button" variant="outline" onClick={reload} disabled={loading}>
          {t('common.refresh', 'Refresh')}
        </Button>
      </div>

      <div className="flex items-end gap-2">
        <div>
          <CustomSelect
            id="stock-units-search-mode"
            label={t('stockUnits.searchBy', 'Search by')}
            options={SEARCH_MODE_OPTIONS}
            value={searchMode}
            onValueChange={(value) => setSearchMode(value as SearchMode)}
          />
        </div>
        <div className="flex-1">
          <SearchInput
            id="stock-units-search-input"
            className="w-full"
            value={query}
            loading={loading}
            onChange={(e) => setQuery(e.target.value)}
            onClear={clearSearch}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch();
            }}
            placeholder={searchMode === 'serial' ? t('stockUnits.searchPlaceholder.serial', 'e.g. SSD990-0007') : t('stockUnits.searchPlaceholder.mac', 'e.g. AA:BB:CC:00:00:01')}
          />
        </div>
        <Button id="stock-units-search-button" onClick={runSearch} disabled={loading}>
          {t('common.search', 'Search')}
        </Button>
        <Button id="stock-units-export-csv" variant="outline" onClick={exportCsv} disabled={units.length === 0}>
          {t('stockUnits.exportCsv', 'Export CSV')}
        </Button>
      </div>

      {!loading && units.length === 0 ? (
        query.trim() ? (
          <EmptyState
            icon={<PackageSearch size={20} />}
            title={t('stockUnits.empty.noMatchTitle', 'No units match "{{term}}"', { term: query.trim() })}
            description={t('stockUnits.empty.noMatchDescription', 'Check the serial or MAC address, or clear the search to see all units.')}
            action={
              <Button id="stock-units-empty-clear" variant="link" onClick={clearSearch}>
                {t('stockUnits.empty.clearSearch', 'Clear search')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<PackageSearch size={20} />}
            title={t('stockUnits.empty.noUnitsTitle', 'No stock units yet')}
            description={t('stockUnits.empty.noUnitsDescription', 'Serialized units appear here once stock is received against a serialized product.')}
          />
        )
      ) : (
        <DataTable id="stock-units-table" data={units} columns={columns} />
      )}

      <Dialog
        isOpen={historyDetail !== null}
        onClose={() => setHistoryDetail(null)}
        title={
          historyDetail
            ? t('stockUnits.unitTitle', 'Unit {{id}}', { id: historyDetail.unit.serial_number || historyDetail.unit.unit_id })
            : t('stockUnits.unitHistoryTitle', 'Unit history')
        }
        id="unit-history-dialog"
        className="max-w-3xl"
      >
        {historyDetail && (
          <div className="space-y-4 p-1">
            <div className="rounded border bg-gray-50 p-3">
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <div className="text-xs text-gray-500">{t('stockUnits.detail.serial', 'Serial')}</div>
                  <div className="font-mono">{historyDetail.unit.serial_number || t('common.emptyValue', '—')}</div>
                </div>
                {historyDetail.unit.mac_address && (
                  <div>
                    <div className="text-xs text-gray-500">{t('stockUnits.detail.mac', 'MAC')}</div>
                    <div className="font-mono">{fmtMac(historyDetail.unit.mac_address)}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-gray-500">{t('common.status', 'Status')}</div>
                  <div>{humanizeStatus(historyDetail.unit.status)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t('stockUnits.detail.location', 'Location')}</div>
                  <div>{locationName(historyDetail.unit.location_id)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t('stockUnits.detail.unitCost', 'Unit cost')}</div>
                  <div className="font-mono">{fmtCents(historyDetail.unit.unit_cost) || t('common.emptyValue', '—')}</div>
                </div>
                {historyDetail.unit.received_at && (
                  <div>
                    <div className="text-xs text-gray-500">{t('stockUnits.detail.received', 'Received')}</div>
                    <div className="font-mono">{fmtDate(historyDetail.unit.received_at)}</div>
                  </div>
                )}
                {historyDetail.unit.delivered_at && (
                  <div>
                    <div className="text-xs text-gray-500">{t('stockUnits.detail.delivered', 'Delivered')}</div>
                    <div className="font-mono">{fmtDate(historyDetail.unit.delivered_at)}</div>
                  </div>
                )}
              </div>
            </div>

            {historyDetail.movements.length === 0 ? (
              <p className="text-sm text-gray-500">{t('stockUnits.noMovements', 'No movements recorded.')}</p>
            ) : (
              <div className="space-y-3 border-l border-gray-200 pl-4">
                {historyDetail.movements.map((movement) => (
                  <div key={movement.movement_id} className="relative">
                    <div className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-gray-400" />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-sm font-medium">{movement.movement_type}</div>
                      <div className="font-mono text-xs text-gray-500">
                        {fmtDateTime(movement.created_at) || t('common.emptyValue', '—')}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-gray-600">
                      <span>
                        {t('stockUnits.qty', 'Qty')} <span className="font-mono">{movement.quantity}</span>
                      </span>
                      <span className="font-mono text-gray-500">
                        {locationName(movement.from_location_id)} → {locationName(movement.to_location_id)}
                      </span>
                    </div>
                    {movement.reason && (
                      <div className="mt-1 text-xs text-gray-500">{movement.reason}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
