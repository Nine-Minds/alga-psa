'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IProductInventorySettings, IStockLocation } from '@alga-psa/types';
import {
  listInventoryProducts,
  listStockLocations,
  getStockLevelsForProduct,
  receiveStockManual,
  rebuildStockCaches,
} from '../actions';
import { ImportOpeningBalances } from './ImportOpeningBalances';

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

const NUM_HEADER = 'text-right';
const NUM_CELL = 'text-right tabular-nums';

export function StockOverview({ initialProducts }: { initialProducts: InventoryProduct[] }) {
  const { t } = useTranslation('features/inventory');

  /** "Out · 1 site" / "Low · 2 sites" — per-location scope so a summed total never
   *  silently contradicts the pill (e.g. 8 available, but out at one location). */
  const statusLabel = (p: InventoryProduct, s: Exclude<StockStatus, 'ok'>): string => {
    const n = s === 'out' ? p.out_locations : p.low_locations;
    const word = s === 'out' ? t('stock.status.out', 'Out') : t('stock.status.low', 'Low');
    if (n <= 0) return word;
    return n === 1
      ? t('stock.status.wordSite', '{{word}} · {{n}} site', { word, n })
      : t('stock.status.wordSites', '{{word}} · {{n}} sites', { word, n });
  };

  const productLabel = (p: { service_name: string | null; sku: string | null }): string =>
    `${p.service_name || t('stock.unnamedProduct', 'Unnamed product')}${p.sku ? ` — ${p.sku}` : ''}`;

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
      toast.error(e?.message || t('stock.loadProductsFailed', "Couldn't load products."));
    }
  }, [t]);

  const loadLocations = useCallback(async () => {
    try {
      setLocations(await listStockLocations({ includeInactive: false }));
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('stock.loadLocationsFailed', "Couldn't load locations."));
    }
  }, [t]);

  const [rebuilding, setRebuilding] = useState(false);
  const rebuildCaches = useCallback(async () => {
    setRebuilding(true);
    try {
      const result = await rebuildStockCaches();
      const n = result.corrections.length;
      toast.success(
        n === 0
          ? t('stock.rebuild.consistent', 'Checked {{products}} products — caches already consistent.', { products: result.products_checked })
          : n === 1
            ? t('stock.rebuild.correctedOne', 'Checked {{products}} products and corrected {{n}} value.', { products: result.products_checked, n })
            : t('stock.rebuild.correctedMany', 'Checked {{products}} products and corrected {{n}} values.', { products: result.products_checked, n }),
      );
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('stock.rebuild.failed', "Couldn't rebuild stock caches."));
    } finally {
      setRebuilding(false);
    }
  }, [reload, t]);

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
      toast.error(t('stock.receive.pickProduct', 'Pick a product.'));
      return;
    }
    if (!receiveForm.location_id) {
      toast.error(t('stock.receive.pickLocation', 'Pick a location.'));
      return;
    }
    const quantity = Number(receiveForm.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      toast.error(t('stock.receive.qtyPositive', 'Quantity must be a positive whole number.'));
      return;
    }
    const unitDollars = Number(receiveForm.unit_cost);
    if (!Number.isFinite(unitDollars) || unitDollars < 0) {
      toast.error(t('stock.receive.costNonNegative', "Unit cost can't be negative."));
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
      toast.success(t('stock.receive.success', 'Stock received.'));
      if (result?.warnings?.length) {
        result.warnings.forEach((w) => toast.error(w.message));
      }
      setReceiveOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('stock.receive.failed', "Couldn't receive stock."));
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
      setLevelsError(e?.message || t('stock.levels.loadFailed', "Couldn't load stock levels."));
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
      title: t('stock.columns.product', 'Product'),
      dataIndex: 'service_name',
      // Product is the wide identifier column; pin it so the responsive table spends
      // slack here (name + Serial badge) rather than hiding a column.
      width: '240px',
      render: (v: any, rec: InventoryProduct) => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate">{v || t('stock.unnamedProduct', 'Unnamed product')}</span>
          {rec.is_serialized && (
            <Badge variant="secondary" size="sm" className="shrink-0">
              {t('stock.badge.serial', 'Serial')}
            </Badge>
          )}
        </div>
      ),
    },
    { title: t('stock.columns.sku', 'SKU'), dataIndex: 'sku', render: (v: any) => v || t('common.emptyValue', '—') },
    {
      // Lead with Available — the sellable number every judgment (status pill,
      // filter, reorder) is computed from. Physical on-hand lives in the levels dialog.
      title: t('stock.columns.available', 'Available'),
      dataIndex: 'available',
      headerClassName: NUM_HEADER,
      cellClassName: `${NUM_CELL} font-semibold text-gray-900`,
      render: (v: any) => Number(v ?? 0).toLocaleString(),
    },
    {
      title: t('common.status', 'Status'),
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
      title: t('common.actions', 'Actions'),
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
            {t('stock.actions.receive', 'Receive')}
          </Button>
        </div>
      ),
    },
  ];

  // Lead with the two numbers a stock decision needs: physical On hand and the
  // sellable Available (= on hand − reserved − held). The reserved/held split is
  // granular allocation detail, not a peer column here.
  const levelColumns: ColumnDefinition<StockLevelRow>[] = [
    { title: t('stock.columns.location', 'Location'), dataIndex: 'location_name', render: (v: any) => v || t('common.emptyValue', '—') },
    { title: t('stock.columns.onHand', 'On hand'), dataIndex: 'quantity_on_hand', headerClassName: NUM_HEADER, cellClassName: NUM_CELL },
    {
      title: t('stock.columns.available', 'Available'),
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
          <h1 className="text-2xl font-semibold">{t('stock.title', 'Stock')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {products.length === 1
              ? t('stock.summary.productOne', '{{n}} product', { n: products.length })
              : t('stock.summary.productMany', '{{n}} products', { n: products.length })}
            {outCount > 0 && <span className="text-red-600 font-medium">{t('stock.summary.outSuffix', ' · {{n}} out', { n: outCount })}</span>}
            {lowCount > 0 && <span className="text-amber-600 font-medium">{t('stock.summary.lowSuffix', ' · {{n}} low', { n: lowCount })}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Day-one migration path (Sam review P1): opening balances from CSV as real receipts. */}
          <ImportOpeningBalances onApplied={reload} />
          {/* Repair path for cache drift (F028): recompute on-hand + reserved/held from
              the ledger, unit statuses, and open SO reservations. */}
          <Button
            id="stock-overview-rebuild-button"
            variant="outline"
            disabled={rebuilding}
            onClick={rebuildCaches}
          >
            {rebuilding ? t('stock.rebuild.inProgress', 'Rebuilding…') : t('stock.rebuild.button', 'Rebuild stock caches')}
          </Button>
          <Button id="stock-overview-add-button" onClick={() => openReceive()}>
            {t('stock.receiveStock', 'Receive stock')}
          </Button>
        </div>
      </div>

      {products.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="w-72">
            <Input
              id="stock-overview-search"
              placeholder={t('stock.searchPlaceholder', 'Search products or SKU')}
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
            {t('stock.needsAttention', 'Needs attention')}
          </Button>
          {(q || lowOnly) && (
            <span className="text-sm text-gray-500">
              {t('stock.filteredCount', '{{shown}} of {{total}} products', { shown: filtered.length, total: products.length })}
            </span>
          )}
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState
          title={t('stock.empty.noProductsTitle', 'No products track stock yet')}
          description={t('stock.empty.noProductsDescription', 'Turn on inventory tracking for a product in Billing → Products, then receive stock.')}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('stock.empty.noMatchTitle', 'No products match')}
          action={
            <Button
              id="stock-clear-filters"
              variant="link"
              onClick={() => {
                setSearch('');
                setLowOnly(false);
              }}
            >
              {t('stock.clearFilters', 'Clear filters')}
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
        title={t('stock.receiveStock', 'Receive stock')}
        id="receive-stock-dialog"
      >
        <div className="space-y-4 p-1">
          <CustomSelect
            id="receive-stock-product"
            label={t('stock.fields.product', 'Product')}
            required
            value={receiveForm.service_id}
            placeholder={t('stock.receive.selectProduct', 'Select a product…')}
            options={products.map((p) => ({ value: p.service_id, label: productLabel(p) }))}
            onValueChange={(v: string) => setReceiveForm({ ...receiveForm, service_id: v })}
          />
          <CustomSelect
            id="receive-stock-location"
            label={t('stock.fields.location', 'Location')}
            required
            value={receiveForm.location_id}
            placeholder={t('stock.receive.selectLocation', 'Select a location…')}
            options={locations.map((loc) => ({ value: loc.location_id, label: loc.name }))}
            onValueChange={(v: string) => setReceiveForm({ ...receiveForm, location_id: v })}
          />
          <Input
            id="receive-stock-quantity"
            label={t('common.quantity', 'Quantity')}
            required
            type="number"
            min="1"
            step="1"
            value={receiveForm.quantity}
            onChange={(e) => setReceiveForm({ ...receiveForm, quantity: e.target.value })}
          />
          <Input
            id="receive-stock-unit-cost"
            label={t('stock.fields.unitCost', 'Unit cost (USD)')}
            type="number"
            min="0"
            step="0.01"
            value={receiveForm.unit_cost}
            onChange={(e) => setReceiveForm({ ...receiveForm, unit_cost: e.target.value })}
          />
          {selectedProduct?.is_serialized && (
            <p className="text-xs text-[rgb(var(--color-text-500))]">
              {t('stock.receive.serializedHint', 'Receive serialized products one serial at a time.')}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button id="receive-stock-cancel" variant="outline" onClick={() => setReceiveOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="receive-stock-save" onClick={saveReceive} disabled={saving}>
              {saving ? t('stock.receive.inProgress', 'Receiving…') : t('stock.actions.receive', 'Receive')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={levelsOpen}
        onClose={() => setLevelsOpen(false)}
        title={t('stock.levels.title', 'Stock levels — {{name}}', { name: levelsProduct?.service_name || '' })}
        id="stock-levels-dialog"
      >
        <div className="space-y-4 p-1">
          {levelsLoading ? (
            <p className="text-sm text-[rgb(var(--color-text-500))]">{t('stock.levels.loading', 'Loading stock…')}</p>
          ) : levelsError ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-sm text-red-700">{levelsError}</p>
              {levelsProduct && (
                <Button id="stock-levels-retry" variant="outline" size="sm" onClick={() => loadLevels(levelsProduct)}>
                  {t('common.retry', 'Retry')}
                </Button>
              )}
            </div>
          ) : levels.length === 0 ? (
            <p className="text-sm text-[rgb(var(--color-text-500))]">{t('stock.levels.empty', 'No stock recorded for this product.')}</p>
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
                {t('stock.receiveStock', 'Receive stock')}
              </Button>
            )}
            <Button id="stock-levels-close" variant="outline" onClick={() => setLevelsOpen(false)}>
              {t('common.close', 'Close')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
