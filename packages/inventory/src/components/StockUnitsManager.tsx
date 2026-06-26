'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IStockUnit } from '@alga-psa/types';
import { listStockUnits, searchUnitsBySerial, searchUnitsByMac } from '../actions';

type SearchMode = 'serial' | 'mac';

function fmtDate(v?: string | Date | null): string {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export function StockUnitsManager({ initialUnits }: { initialUnits: IStockUnit[] }) {
  const [units, setUnits] = useState<IStockUnit[]>(initialUnits || []);
  const [searchMode, setSearchMode] = useState<SearchMode>('serial');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

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

  const columns: ColumnDefinition<IStockUnit>[] = [
    { title: 'Serial Number', dataIndex: 'serial_number' },
    { title: 'MAC Address', dataIndex: 'mac_address', render: (v: any) => v || '' },
    { title: 'Status', dataIndex: 'status' },
    { title: 'Location', dataIndex: 'location_id', render: (v: any) => v || '' },
    { title: 'Client', dataIndex: 'client_id', render: (v: any) => v || '' },
    {
      title: 'Warranty Expires',
      dataIndex: 'warranty_expires_at',
      render: (v: any) => fmtDate(v),
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
          <label className="block text-sm font-medium mb-1">Search by</label>
          <select
            id="stock-units-search-mode"
            className="border rounded px-2 py-2 w-full"
            value={searchMode}
            onChange={(e) => setSearchMode(e.target.value as SearchMode)}
          >
            <option value="serial">Serial Number</option>
            <option value="mac">MAC Address</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium mb-1">Search term</label>
          <Input
            id="stock-units-search-input"
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
      </div>

      <DataTable id="stock-units-table" data={units} columns={columns} />
    </div>
  );
}
