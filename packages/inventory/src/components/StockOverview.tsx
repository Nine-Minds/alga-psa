'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
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
};

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

export function StockOverview({ initialProducts }: { initialProducts: InventoryProduct[] }) {
  const [products, setProducts] = useState<InventoryProduct[]>(initialProducts || []);
  const [locations, setLocations] = useState<IStockLocation[]>([]);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveForm, setReceiveForm] = useState<ReceiveForm>(EMPTY_RECEIVE);
  const [saving, setSaving] = useState(false);

  const [levelsOpen, setLevelsOpen] = useState(false);
  const [levelsProduct, setLevelsProduct] = useState<InventoryProduct | null>(null);
  const [levels, setLevels] = useState<StockLevelRow[]>([]);
  const [levelsLoading, setLevelsLoading] = useState(false);

  const reload = useCallback(async () => {
    try {
      setProducts(await listInventoryProducts());
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load products');
    }
  }, []);

  const loadLocations = useCallback(async () => {
    try {
      setLocations(await listStockLocations({ includeInactive: false }));
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load locations');
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
      toast.error('Select a product');
      return;
    }
    if (!receiveForm.location_id) {
      toast.error('Select a location');
      return;
    }
    const quantity = Number(receiveForm.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      toast.error('Quantity must be a positive whole number');
      return;
    }
    const unitDollars = Number(receiveForm.unit_cost);
    if (!Number.isFinite(unitDollars) || unitDollars < 0) {
      toast.error('Unit cost must be a non-negative amount');
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
      toast.success('Stock received');
      if (result?.warnings?.length) {
        result.warnings.forEach((w) => toast.error(w.message));
      }
      setReceiveOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Receive failed');
    } finally {
      setSaving(false);
    }
  };

  const openLevels = async (product: InventoryProduct) => {
    setLevelsProduct(product);
    setLevels([]);
    setLevelsOpen(true);
    setLevelsLoading(true);
    try {
      setLevels((await getStockLevelsForProduct(product.service_id)) as StockLevelRow[]);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load stock levels');
    } finally {
      setLevelsLoading(false);
    }
  };

  const columns: ColumnDefinition<InventoryProduct>[] = [
    { title: 'Product', dataIndex: 'service_name', render: (v: any) => v || '(unnamed)' },
    { title: 'SKU', dataIndex: 'sku', render: (v: any) => v || '—' },
    { title: 'Serialized', dataIndex: 'is_serialized', render: (v: any) => (v ? 'Yes' : '') },
    { title: 'Reorder Point', dataIndex: 'reorder_point', render: (v: any) => (v == null ? '—' : v) },
    { title: 'Avg Cost', dataIndex: 'average_cost', render: (v: any) => dollars(v) },
    {
      title: 'Actions',
      dataIndex: 'service_id',
      render: (_: any, rec: InventoryProduct) => (
        <div className="flex gap-2">
          <Button
            id={`view-levels-${rec.service_id}`}
            variant="outline"
            size="sm"
            onClick={() => openLevels(rec)}
          >
            View levels
          </Button>
          <Button
            id={`receive-stock-${rec.service_id}`}
            variant="ghost"
            size="sm"
            onClick={() => openReceive(rec)}
          >
            Receive
          </Button>
        </div>
      ),
    },
  ];

  const levelColumns: ColumnDefinition<StockLevelRow>[] = [
    { title: 'Location', dataIndex: 'location_name', render: (v: any) => v || '—' },
    { title: 'On Hand', dataIndex: 'quantity_on_hand' },
    { title: 'Reserved', dataIndex: 'reserved_quantity' },
    { title: 'Held', dataIndex: 'held_quantity' },
    { title: 'Available', dataIndex: 'available' },
  ];

  return (
    <div className="p-6 space-y-4" id="stock-overview-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stock</h1>
        <Button id="stock-overview-add-button" onClick={() => openReceive()}>
          Receive Stock
        </Button>
      </div>

      <DataTable
        id="stock-overview-table"
        data={products}
        columns={columns}
        onRowClick={openLevels}
      />

      <Dialog
        isOpen={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        title="Receive Stock"
        id="receive-stock-dialog"
      >
        <div className="space-y-4 p-1">
          <div>
            <label className="block text-sm font-medium mb-1">Product *</label>
            <select
              id="receive-stock-product"
              className="border rounded px-2 py-2 w-full"
              value={receiveForm.service_id}
              onChange={(e) => setReceiveForm({ ...receiveForm, service_id: e.target.value })}
            >
              <option value="">Select a product…</option>
              {products.map((p) => (
                <option key={p.service_id} value={p.service_id}>
                  {p.service_name || '(unnamed)'}
                  {p.sku ? ` — ${p.sku}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Location *</label>
            <select
              id="receive-stock-location"
              className="border rounded px-2 py-2 w-full"
              value={receiveForm.location_id}
              onChange={(e) => setReceiveForm({ ...receiveForm, location_id: e.target.value })}
            >
              <option value="">Select a location…</option>
              {locations.map((loc) => (
                <option key={loc.location_id} value={loc.location_id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Quantity *</label>
            <Input
              id="receive-stock-quantity"
              type="number"
              min="1"
              step="1"
              value={receiveForm.quantity}
              onChange={(e) => setReceiveForm({ ...receiveForm, quantity: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Unit Cost (USD)</label>
            <Input
              id="receive-stock-unit-cost"
              type="number"
              min="0"
              step="0.01"
              value={receiveForm.unit_cost}
              onChange={(e) => setReceiveForm({ ...receiveForm, unit_cost: e.target.value })}
            />
          </div>
          <p className="text-xs text-gray-500">
            Serialized products require per-unit serials and cannot be received in bulk from this screen.
          </p>
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
        title={`Stock Levels — ${levelsProduct?.service_name || ''}`}
        id="stock-levels-dialog"
      >
        <div className="space-y-4 p-1">
          {levelsLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : levels.length === 0 ? (
            <p className="text-sm text-gray-500">No stock recorded for this product.</p>
          ) : (
            <DataTable
              id="stock-levels-table"
              data={levels.map((r) => ({
                ...r,
                _belowReorder:
                  levelsProduct?.reorder_point != null && r.available < levelsProduct.reorder_point,
              }))}
              columns={levelColumns}
              rowClassName={(r: any) => (r._belowReorder ? 'bg-red-50' : '')}
            />
          )}
          <div className="flex justify-end gap-2 pt-2">
            {levelsProduct && (
              <Button
                id="stock-levels-receive"
                variant="outline"
                onClick={() => {
                  setLevelsOpen(false);
                  openReceive(levelsProduct);
                }}
              >
                Receive Stock
              </Button>
            )}
            <Button id="stock-levels-close" onClick={() => setLevelsOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
