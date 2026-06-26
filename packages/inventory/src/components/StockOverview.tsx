'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IProductInventorySettings, IStockLocation } from '@alga-psa/types';
import {
  listInventoryProducts,
  listStockLocations,
  getStockLevelsForProduct,
  receiveStockManual,
} from '../actions';

type InventoryProduct = IProductInventorySettings & {
  service_name: string | null;
  sku: string | null;
  on_hand: number;
  available: number;
  needs_reorder: boolean;
  any_out: boolean;
  out_locations: number;
  low_locations: number;
};

type StockStatus = 'out' | 'low' | 'ok';

/** "Out · 1 site" / "Low · 2 sites" — per-location scope so a summed total never
 *  silently contradicts the pill (e.g. 8 available, but out at one location). */
function statusLabel(p: InventoryProduct, s: Exclude<StockStatus, 'ok'>): string {
  const n = s === 'out' ? p.out_locations : p.low_locations;
  const word = s === 'out' ? 'Out' : 'Low';
  return n > 0 ? `${word} · ${n} site${n === 1 ? '' : 's'}` : word;
}

const stockStatus = (p: InventoryProduct): StockStatus =>
  p.any_out ? 'out' : p.needs_reorder ? 'low' : 'ok';

interface StockLevelRow {
  location_id: string;
  location_name: string | null;
  quantity_on_hand: number;
  reserved_quantity: number;
  held_quantity: number;
  available: number;
}

const dollars = (cents?: number | null): string =>
  cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;

interface ReceiveForm {
  service_id: string;
  location_id: string;
  quantity: string;
  unit_cost: string;
}

const EMPTY_RECEIVE: ReceiveForm = { service_id: '', location_id: '', quantity: '', unit_cost: '' };

const productLabel = (p: { service_name: string | null; sku: string | null }): string =>
  `${p.service_name || 'Unnamed product'}${p.sku ? ` — ${p.sku}` : ''}`;

const NUM_HEADER = 'text-right';
const NUM_CELL = 'text-right tabular-nums';

export function StockOverview({ initialProducts }: { initialProducts: InventoryProduct[] }) {
  const [products, setProducts] = useState<InventoryProduct[]>(initialProducts || []);
  const [locations, setLocations] = useState<IStockLocation[]>([]);

  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveForm, setReceiveForm] = useState<ReceiveForm>(EMPTY_RECEIVE);
  const [saving, setSaving] = useState(false);

  const [levelsOpen, setLevelsOpen] = useState(false);
  const [levelsProduct, setLevelsProduct] = useState<InventoryProduct | null>(null);
  const [levels, setLevels] = useState<StockLevelRow[]>([]);
  const [levelsLoading, setLevelsLoading] = useState(false);
  const [levelsError, setLevelsError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setProducts(await listInventoryProducts());
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Couldn't load products.");
    }
  }, []);

  const loadLocations = useCallback(async () => {
    try {
      setLocations(await listStockLocations({ includeInactive: false }));
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Couldn't load locations.");
    }
  }, []);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const openReceive = (product?: InventoryProduct) => {
    setReceiveForm({
      ...EMPTY_RECEIVE,
      service_id: product?.service_id ?? '',
      location_id: product?.default_location_id ?? '',
    });
    setReceiveOpen(true);
  };

  const saveReceive = async () => {
    if (!receiveForm.service_id) {
      toast.error('Pick a product.');
      return;
    }
    if (!receiveForm.location_id) {
      toast.error('Pick a location.');
      return;
    }
    const quantity = Number(receiveForm.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      toast.error('Quantity must be a positive whole number.');
      return;
    }
    const unitDollars = Number(receiveForm.unit_cost);
    if (!Number.isFinite(unitDollars) || unitDollars < 0) {
      toast.error("Unit cost can't be negative.");
      return;
    }
    setSaving(true);
    try {
      const result = await receiveStockManual({
        service_id: receiveForm.service_id,
        location_id: receiveForm.location_id,
        quantity,
        unit_cost: Math.round(unitDollars * 100),
      });
      toast.success('Stock received.');
      if (result?.warnings?.length) {
        result.warnings.forEach((w) => toast.error(w.message));
      }
      setReceiveOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't receive stock.");
    } finally {
      setSaving(false);
    }
  };

  const loadLevels = async (product: InventoryProduct) => {
    setLevelsLoading(true);
    setLevelsError(null);
    try {
      setLevels((await getStockLevelsForProduct(product.service_id)) as StockLevelRow[]);
    } catch (e: any) {
      setLevelsError(e?.message || "Couldn't load stock levels.");
    } finally {
      setLevelsLoading(false);
    }
  };

  const openLevels = async (product: InventoryProduct) => {
    setLevelsProduct(product);
    setLevels([]);
    setLevelsOpen(true);
    await loadLevels(product);
  };

  const selectedProduct = products.find((p) => p.service_id === receiveForm.service_id) || null;

  const columns: ColumnDefinition<InventoryProduct>[] = [
    {
      title: 'Product',
      dataIndex: 'service_name',
      // Product is the wide identifier column; pin it so the responsive table spends
      // slack here (name + Serial badge) rather than hiding a column.
      width: '240px',
      render: (v: any, rec: InventoryProduct) => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate">{v || 'Unnamed product'}</span>
          {rec.is_serialized && (
            <Badge variant="secondary" size="sm" className="shrink-0">
              Serial
            </Badge>
          )}
        </div>
      ),
    },
    { title: 'SKU', dataIndex: 'sku', render: (v: any) => v || '—' },
    {
      // Lead with Available — the sellable number every judgment (status pill,
      // filter, reorder) is computed from. Physical on-hand lives in the levels dialog.
      title: 'Available',
      dataIndex: 'available',
      headerClassName: NUM_HEADER,
      cellClassName: `${NUM_CELL} font-semibold text-gray-900`,
      render: (v: any) => Number(v ?? 0).toLocaleString(),
    },
    {
      title: 'Status',
      dataIndex: 'any_out',
      sortable: false,
      render: (_: any, rec: InventoryProduct) => {
        const s = stockStatus(rec);
        if (s === 'ok') return null;
        return (
          <Badge variant={s === 'out' ? 'error' : 'warning'} size="sm">
            {statusLabel(rec, s)}
          </Badge>
        );
      },
    },
    {
      title: 'Actions',
      dataIndex: 'service_id',
      headerClassName: 'text-right',
      render: (_: any, rec: InventoryProduct) => (
        <div className="flex justify-end">
          <Button
            id={`receive-stock-${rec.service_id}`}
            variant="outline"
            size="sm"
            onClick={(e?: React.MouseEvent) => {
              e?.stopPropagation();
              openReceive(rec);
            }}
          >
            Receive
          </Button>
        </div>
      ),
    },
  ];

  // Lead with the two numbers a stock decision needs: physical On hand and the
  // sellable Available (= on hand − reserved − held). The reserved/held split is
  // granular allocation detail, not a peer column here.
  const levelColumns: ColumnDefinition<StockLevelRow>[] = [
    { title: 'Location', dataIndex: 'location_name', render: (v: any) => v || '—' },
    { title: 'On hand', dataIndex: 'quantity_on_hand', headerClassName: NUM_HEADER, cellClassName: NUM_CELL },
    {
      title: 'Available',
      dataIndex: 'available',
      headerClassName: NUM_HEADER,
      cellClassName: `${NUM_CELL} font-semibold text-gray-900`,
    },
  ];

  const outCount = products.filter((p) => stockStatus(p) === 'out').length;
  const lowCount = products.filter((p) => stockStatus(p) === 'low').length;

  const q = search.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (lowOnly && stockStatus(p) === 'ok') return false;
    if (!q) return true;
    return (
      (p.service_name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 space-y-4" id="stock-overview-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stock</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {products.length} product{products.length === 1 ? '' : 's'}
            {outCount > 0 && <span className="text-red-600 font-medium"> · {outCount} out</span>}
            {lowCount > 0 && <span className="text-amber-600 font-medium"> · {lowCount} low</span>}
          </p>
        </div>
        <Button id="stock-overview-add-button" onClick={() => openReceive()}>
          Receive stock
        </Button>
      </div>

      {products.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="w-72">
            <Input
              id="stock-overview-search"
              placeholder="Search products or SKU"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {/* "Needs attention" (not "low only"): the predicate keeps both low AND out. */}
          <Button
            id="stock-overview-low-filter"
            variant={lowOnly ? 'soft' : 'outline'}
            onClick={() => setLowOnly((v) => !v)}
          >
            Needs attention
          </Button>
          {(q || lowOnly) && (
            <span className="text-sm text-gray-500">
              {filtered.length} of {products.length} products
            </span>
          )}
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState
          title="No products track stock yet"
          description="Turn on inventory tracking for a product in Billing → Products, then receive stock."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No products match"
          action={
            <Button
              id="stock-clear-filters"
              variant="link"
              onClick={() => {
                setSearch('');
                setLowOnly(false);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <DataTable
          id="stock-overview-table"
          data={filtered}
          columns={columns}
          onRowClick={openLevels}
        />
      )}

      <Dialog
        isOpen={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        title="Receive stock"
        id="receive-stock-dialog"
      >
        <div className="space-y-4 p-1">
          <CustomSelect
            id="receive-stock-product"
            label="Product"
            required
            value={receiveForm.service_id}
            placeholder="Select a product…"
            options={products.map((p) => ({ value: p.service_id, label: productLabel(p) }))}
            onValueChange={(v: string) => setReceiveForm({ ...receiveForm, service_id: v })}
          />
          <CustomSelect
            id="receive-stock-location"
            label="Location"
            required
            value={receiveForm.location_id}
            placeholder="Select a location…"
            options={locations.map((loc) => ({ value: loc.location_id, label: loc.name }))}
            onValueChange={(v: string) => setReceiveForm({ ...receiveForm, location_id: v })}
          />
          <Input
            id="receive-stock-quantity"
            label="Quantity"
            required
            type="number"
            min="1"
            step="1"
            value={receiveForm.quantity}
            onChange={(e) => setReceiveForm({ ...receiveForm, quantity: e.target.value })}
          />
          <Input
            id="receive-stock-unit-cost"
            label="Unit cost (USD)"
            type="number"
            min="0"
            step="0.01"
            value={receiveForm.unit_cost}
            onChange={(e) => setReceiveForm({ ...receiveForm, unit_cost: e.target.value })}
          />
          {selectedProduct?.is_serialized && (
            <p className="text-xs text-[rgb(var(--color-text-500))]">
              Receive serialized products one serial at a time.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button id="receive-stock-cancel" variant="outline" onClick={() => setReceiveOpen(false)}>
              Cancel
            </Button>
            <Button id="receive-stock-save" onClick={saveReceive} disabled={saving}>
              {saving ? 'Receiving…' : 'Receive'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={levelsOpen}
        onClose={() => setLevelsOpen(false)}
        title={`Stock levels — ${levelsProduct?.service_name || ''}`}
        id="stock-levels-dialog"
      >
        <div className="space-y-4 p-1">
          {levelsLoading ? (
            <p className="text-sm text-[rgb(var(--color-text-500))]">Loading stock…</p>
          ) : levelsError ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-sm text-red-700">{levelsError}</p>
              {levelsProduct && (
                <Button id="stock-levels-retry" variant="outline" size="sm" onClick={() => loadLevels(levelsProduct)}>
                  Retry
                </Button>
              )}
            </div>
          ) : levels.length === 0 ? (
            <p className="text-sm text-[rgb(var(--color-text-500))]">No stock recorded for this product.</p>
          ) : (
            <DataTable
              id="stock-levels-table"
              data={levels}
              columns={levelColumns}
              rowClassName={(r) =>
                levelsProduct?.reorder_point != null && r.available <= levelsProduct.reorder_point
                  ? 'bg-amber-50'
                  : ''
              }
            />
          )}
          <div className="flex justify-end gap-2 pt-2">
            {levelsProduct && (
              <Button
                id="stock-levels-receive"
                onClick={() => {
                  setLevelsOpen(false);
                  openReceive(levelsProduct);
                }}
              >
                Receive stock
              </Button>
            )}
            <Button id="stock-levels-close" variant="outline" onClick={() => setLevelsOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
