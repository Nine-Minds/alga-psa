'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
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

const SEARCH_MODE_OPTIONS = [
  { value: 'serial', label: 'Serial number' },
  { value: 'mac', label: 'MAC address' },
];

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

function csvValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function csvEscape(v: unknown): string {
  const s = csvValue(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

function humanizeStatus(v?: string | null): string {
  if (!v) return '—';
  return v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function statusVariant(v?: string | null) {
  switch (v) {
    case 'retired':
      return 'secondary' as const;
    case 'in_rma':
      return 'warning' as const;
    case 'delivered':
      return 'success' as const;
    case 'in_stock':
      return 'info' as const;
    default:
      return 'secondary' as const;
  }
}

export function StockUnitsManager({ initialUnits }: { initialUnits: IStockUnit[] }) {
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
      if (!locationId) return '—';
      return locationMap.get(locationId) || locationId;
    },
    [locationMap],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setUnits(await listStockUnits({}));
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load units');
    } finally {
      setLoading(false);
    }
  }, []);

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
      toast.error(e?.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [query, searchMode, reload]);

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
          toast.error('Unit history not found');
          return;
        }
        if (locations === null) {
          setLocations(loadedLocations);
        }
        setHistoryDetail(detail);
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || 'Failed to load unit history');
      } finally {
        setHistoryLoadingUnitId(null);
      }
    },
    [locations],
  );

  const exportCsv = useCallback(() => {
    const headers = [
      'serial_number',
      'mac_address',
      'service_id',
      'status',
      'location_id',
      'unit_cost_cents',
      'received_at',
    ];
    const rows = units.map((unit) => [
      unit.serial_number,
      unit.mac_address,
      unit.service_id,
      unit.status,
      unit.location_id,
      unit.unit_cost,
      unit.received_at,
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
  }, [units]);

  const columns: ColumnDefinition<IStockUnit>[] = [
    { title: 'Serial Number', dataIndex: 'serial_number' },
    { title: 'MAC Address', dataIndex: 'mac_address', render: (v: any) => v || '' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v: any) => (
        <Badge variant={statusVariant(v)} size="sm">
          {humanizeStatus(v)}
        </Badge>
      ),
    },
    { title: 'Location', dataIndex: 'location_id', render: (v: any) => v || '' },
    { title: 'Client', dataIndex: 'client_id', render: (v: any) => v || '' },
    {
      title: 'Warranty Expires',
      dataIndex: 'warranty_expires_at',
      render: (v: any) => fmtDate(v),
    },
    {
      title: 'Actions',
      dataIndex: 'unit_id',
      width: '120px',
      render: (_: any, rec: IStockUnit) => (
        <Button
          id={`unit-history-${rec.unit_id}`}
          variant="ghost"
          size="sm"
          onClick={() => openHistory(rec.unit_id)}
          disabled={historyLoadingUnitId !== null}
        >
          {historyLoadingUnitId === rec.unit_id ? 'Loading…' : 'History'}
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="stock-units-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stock Units</h1>
        <Button id="stock-units-refresh-button" variant="outline" onClick={reload} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="flex items-end gap-2">
        <div>
          <CustomSelect
            id="stock-units-search-mode"
            label="Search by"
            options={SEARCH_MODE_OPTIONS}
            value={searchMode}
            onValueChange={(value) => setSearchMode(value as SearchMode)}
          />
        </div>
        <div className="flex-1">
          <Input
            id="stock-units-search-input"
            label="Search term"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch();
            }}
            placeholder={searchMode === 'serial' ? 'Serial number…' : 'MAC address…'}
          />
        </div>
        <Button id="stock-units-search-button" onClick={runSearch} disabled={loading}>
          Search
        </Button>
        <Button id="stock-units-clear-button" variant="ghost" onClick={clearSearch} disabled={loading}>
          Clear
        </Button>
        <Button id="stock-units-export-csv" variant="outline" onClick={exportCsv} disabled={units.length === 0}>
          Export CSV
        </Button>
      </div>

      <DataTable id="stock-units-table" data={units} columns={columns} />

      <Dialog
        isOpen={historyDetail !== null}
        onClose={() => setHistoryDetail(null)}
        title={
          historyDetail
            ? `Unit ${historyDetail.unit.serial_number || historyDetail.unit.unit_id}`
            : 'Unit history'
        }
        id="unit-history-dialog"
        className="max-w-3xl"
      >
        {historyDetail && (
          <div className="space-y-4 p-1">
            <div className="rounded border bg-gray-50 p-3">
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <div className="text-xs text-gray-500">Serial</div>
                  <div className="font-mono">{historyDetail.unit.serial_number || '—'}</div>
                </div>
                {historyDetail.unit.mac_address && (
                  <div>
                    <div className="text-xs text-gray-500">MAC</div>
                    <div className="font-mono">{historyDetail.unit.mac_address}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-gray-500">Status</div>
                  <div>{humanizeStatus(historyDetail.unit.status)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Location</div>
                  <div className="font-mono text-xs">{locationName(historyDetail.unit.location_id)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Unit cost</div>
                  <div className="font-mono">{fmtCents(historyDetail.unit.unit_cost) || '—'}</div>
                </div>
                {historyDetail.unit.received_at && (
                  <div>
                    <div className="text-xs text-gray-500">Received</div>
                    <div className="font-mono">{fmtDate(historyDetail.unit.received_at)}</div>
                  </div>
                )}
                {historyDetail.unit.delivered_at && (
                  <div>
                    <div className="text-xs text-gray-500">Delivered</div>
                    <div className="font-mono">{fmtDate(historyDetail.unit.delivered_at)}</div>
                  </div>
                )}
              </div>
            </div>

            {historyDetail.movements.length === 0 ? (
              <p className="text-sm text-gray-500">No movements recorded.</p>
            ) : (
              <div className="space-y-3 border-l border-gray-200 pl-4">
                {historyDetail.movements.map((movement) => (
                  <div key={movement.movement_id} className="relative">
                    <div className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-gray-400" />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-sm font-medium">{movement.movement_type}</div>
                      <div className="font-mono text-xs text-gray-500">
                        {fmtDateTime(movement.created_at) || '—'}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-gray-600">
                      <span>
                        Qty <span className="font-mono">{movement.quantity}</span>
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
