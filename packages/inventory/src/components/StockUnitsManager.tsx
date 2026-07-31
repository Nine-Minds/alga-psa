'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ClientNameCell } from '@alga-psa/ui/components/ClientNameCell';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { AsyncSearchableSelect, type SelectOption } from '@alga-psa/ui/components/AsyncSearchableSelect';
import { PackageSearch } from 'lucide-react';
import { UnitHistoryDialog, type UnitDetail } from './UnitHistoryDialog';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError, type ActionMessageError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import { toMinorUnits } from '@alga-psa/core';
import type { ColumnDefinition, IClient, IStockLocation, IStockMovement, IStockUnit } from '@alga-psa/types';
import {
  getUnitDetail,
  listInventoryProducts,
  listStockLocations,
  listStockUnits,
  searchUnitsByMac,
  searchUnitsBySerial,
} from '../actions';

type SearchMode = 'serial' | 'mac';
const isReturnedActionError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);

// Restock-to-sellable + restocking-fee is a billing composite (billing → inventory), so the
// inventory component can't import it. The page passes it in as a typed prop (plan §W3).
export interface RestockReturnWithFeeResult {
  movement: IStockMovement;
  restocking_fee_cents: number | null;
  fee_invoice?: { invoice_id: string; invoice_number: string | null };
  fee_invoice_error?: string;
}
export type RestockReturnWithFeeAction = (input: {
  unit_id?: string;
  service_id?: string;
  location_id?: string;
  quantity?: number;
  restocking_fee_cents?: number | null;
  client_id?: string;
}) => Promise<RestockReturnWithFeeResult | ActionMessageError | ActionPermissionError>;

type RestockMode = 'unit' | 'quantity';
interface InventoryProduct {
  service_id: string;
  service_name: string | null;
  sku: string | null;
  is_serialized?: boolean;
}

function fmtDate(v?: string | Date | null): string {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
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

export function StockUnitsManager({
  initialUnits,
  clients = [],
  defaultCurrencyCode = 'USD',
  restockReturnWithFee,
}: {
  initialUnits: IStockUnit[];
  clients?: IClient[];
  defaultCurrencyCode?: string;
  restockReturnWithFee?: RestockReturnWithFeeAction;
}) {
  const { t } = useTranslation('features/inventory');
  const router = useRouter();
  const { money } = useCurrencyFormat();

  // Render blank — not a misleading "$0.00" — when a unit has no recorded cost.
  // pg returns bigint columns as strings, so coerce before handing minor units
  // to `money`, which applies the tenant locale and the unit's own currency.
  const fmtCost = useCallback(
    (v?: number | string | null, currency?: string | null): string => {
      if (v === null || v === undefined || v === '') return '';
      const n = Number(v);
      return Number.isFinite(n) ? money(n, currency ?? undefined) : '';
    },
    [money],
  );

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

  const STATUS_FILTER_OPTIONS = [
    { value: '', label: t('stockUnits.filter.allStatuses', 'All statuses') },
    ...Object.entries(UNIT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  ];

  const [units, setUnits] = useState<IStockUnit[]>(initialUnits || []);
  const [searchMode, setSearchMode] = useState<SearchMode>('serial');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [clientFilter, setClientFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<IStockLocation[] | null>(null);
  const [historyDetail, setHistoryDetail] = useState<UnitDetail | null>(null);
  const [historyLoadingUnitId, setHistoryLoadingUnitId] = useState<string | null>(null);

  // Restock-a-return dialog (returns opened-but-unused good stock to sellable, with fee).
  const [restockOpen, setRestockOpen] = useState(false);
  const [restockMode, setRestockMode] = useState<RestockMode>('unit');
  const [restockUnitId, setRestockUnitId] = useState('');
  const [restockUnitLabel, setRestockUnitLabel] = useState('');
  const [restockServiceId, setRestockServiceId] = useState('');
  const [restockLocationId, setRestockLocationId] = useState('');
  const [restockQuantity, setRestockQuantity] = useState('');
  const [restockFee, setRestockFee] = useState<string>('');
  const [restockClientId, setRestockClientId] = useState<string | null>(null);
  const [restockClientFilter, setRestockClientFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [restockClientType, setRestockClientType] = useState<'all' | 'company' | 'individual'>('all');
  const [restockSaving, setRestockSaving] = useState(false);
  const [products, setProducts] = useState<InventoryProduct[]>([]);

  // Status/client filters apply client-side over the loaded set (the reader
  // loads all units for the tenant, so this narrows without another round-trip).
  const visibleUnits = useMemo(
    () =>
      units.filter(
        (u) =>
          (!statusFilter || u.status === statusFilter) &&
          (!clientFilter || (u.client_name || '') === clientFilter),
      ),
    [units, statusFilter, clientFilter],
  );
  const isFiltered = query.trim() !== '' || statusFilter !== '' || clientFilter !== '';

  // Client options built from the clients actually present in the loaded units,
  // so the filter only offers clients that have gear.
  const CLIENT_FILTER_OPTIONS = useMemo(() => {
    const names = Array.from(
      new Set(units.map((u) => u.client_name).filter((n): n is string => !!n)),
    ).sort((a, b) => a.localeCompare(b));
    return [
      { value: '', label: t('stockUnits.filter.allClients', 'All clients') },
      ...names.map((n) => ({ value: n, label: n })),
    ];
  }, [units, t]);
  const totalValueCents = useMemo(
    () => visibleUnits.reduce((sum, u) => sum + (Number(u.unit_cost) || 0), 0),
    [visibleUnits],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listStockUnits({});
      if (isReturnedActionError(result)) {
        setUnits([]);
        toast.error(getErrorMessage(result));
        return;
      }
      setUnits(result);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('stockUnits.loadFailed', "Couldn't load stock units. Try Refresh."));
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
      if (isReturnedActionError(results)) {
        setUnits([]);
        toast.error(getErrorMessage(results));
        return;
      }
      setUnits(results);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('stockUnits.searchFailed', "Couldn't run that search. Check the serial or MAC address and try again."));
    } finally {
      setLoading(false);
    }
  }, [query, searchMode, reload, t]);

  const clearSearch = useCallback(async () => {
    setQuery('');
    await reload();
  }, [reload]);

  const clearFilters = useCallback(async () => {
    setStatusFilter('');
    setClientFilter('');
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
        if (isReturnedActionError(detail)) {
          toast.error(getErrorMessage(detail));
          return;
        }
        if (!detail) {
          toast.error(t('stockUnits.historyNotFound', 'No history recorded for this unit yet.'));
          return;
        }
        if (locations === null) {
          if (isReturnedActionError(loadedLocations)) {
            toast.error(getErrorMessage(loadedLocations));
            return;
          }
          setLocations(loadedLocations);
        }
        setHistoryDetail(detail);
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || t('stockUnits.historyLoadFailed', "Couldn't load this unit's history. Try again."));
      } finally {
        setHistoryLoadingUnitId(null);
      }
    },
    [locations, t],
  );

  // Locations are loaded lazily (history/restock both need them); load once on demand.
  const ensureLocations = useCallback(async () => {
    if (locations !== null) return;
    const loaded = await listStockLocations();
    if (isReturnedActionError(loaded)) {
      toast.error(getErrorMessage(loaded));
      return;
    }
    setLocations(loaded);
  }, [locations]);

  const loadProducts = useCallback(async () => {
    const result = await listInventoryProducts();
    if (isReturnedActionError(result)) {
      toast.error(getErrorMessage(result));
      return;
    }
    // Non-serialized products only — serialized stock is restocked by unit, not quantity.
    setProducts((result as InventoryProduct[]).filter((p) => !p.is_serialized));
  }, []);

  const resetRestockForm = useCallback(() => {
    setRestockUnitId('');
    setRestockUnitLabel('');
    setRestockServiceId('');
    setRestockLocationId('');
    setRestockQuantity('');
    setRestockFee('');
    setRestockClientId(null);
    setRestockClientFilter('active');
    setRestockClientType('all');
    setRestockSaving(false);
  }, []);

  // Header entry: pick any delivered/returned unit (or a product quantity) to restock.
  const openRestock = useCallback(() => {
    resetRestockForm();
    setRestockMode('unit');
    setRestockOpen(true);
    void ensureLocations();
    void loadProducts();
  }, [resetRestockForm, ensureLocations, loadProducts]);

  // Row entry: the unit is already known, so prefill it and skip the lookup.
  const openRestockForUnit = useCallback(
    (unit: IStockUnit) => {
      resetRestockForm();
      setRestockMode('unit');
      setRestockUnitId(unit.unit_id);
      setRestockUnitLabel(unit.serial_number || unit.unit_id);
      setRestockOpen(true);
      void ensureLocations();
    },
    [resetRestockForm, ensureLocations],
  );

  // Typeahead for the serialized restock path: only delivered/returned units qualify.
  const loadRestockUnitOptions = useCallback(
    async ({ search }: { search: string; page: number; limit: number }): Promise<{ options: SelectOption[]; total: number }> => {
      const term = search.trim();
      if (!term) return { options: [], total: 0 };
      const bySerial = await searchUnitsBySerial(term);
      const serialUnits = isReturnedActionError(bySerial) ? [] : bySerial;
      const byMac = await searchUnitsByMac(term);
      const macUnits = isReturnedActionError(byMac) ? [] : byMac;
      const merged = new Map<string, IStockUnit>();
      for (const u of [...serialUnits, ...macUnits]) {
        if (u.status === 'delivered' || u.status === 'returned') merged.set(u.unit_id, u);
      }
      const options: SelectOption[] = Array.from(merged.values()).map((u) => ({
        value: u.unit_id,
        label: u.product_name ? `${u.serial_number} — ${u.product_name}` : u.serial_number,
      }));
      return { options, total: options.length };
    },
    [],
  );

  const submitRestock = useCallback(async () => {
    if (!restockReturnWithFee) return;
    // Parse the optional fee (dollars → integer minor units in the tenant currency).
    const feeText = restockFee.trim();
    let feeCents: number | null = null;
    if (feeText) {
      const parsed = Number(feeText);
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast.error(t('stockUnits.restock.feeInvalid', 'Restocking fee must be a non-negative amount.'));
        return;
      }
      feeCents = toMinorUnits(parsed, undefined, defaultCurrencyCode);
    }

    const input: Parameters<RestockReturnWithFeeAction>[0] = { restocking_fee_cents: feeCents };
    if (restockMode === 'unit') {
      if (!restockUnitId) {
        toast.error(t('stockUnits.restock.chooseUnit', 'Choose a unit to restock.'));
        return;
      }
      input.unit_id = restockUnitId;
      // Empty = use the unit's current location (a meaningful default, not arbitrary).
      if (restockLocationId) input.location_id = restockLocationId;
    } else {
      if (!restockServiceId) {
        toast.error(t('stockUnits.restock.chooseProduct', 'Choose a product to restock.'));
        return;
      }
      if (!restockLocationId) {
        toast.error(t('stockUnits.restock.chooseLocation', 'Choose a location to restock into.'));
        return;
      }
      const qty = Number(restockQuantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        toast.error(t('stockUnits.restock.quantityInvalid', 'Enter a quantity greater than zero.'));
        return;
      }
      input.service_id = restockServiceId;
      input.location_id = restockLocationId;
      input.quantity = qty;
      // A non-serialized fee needs a client to bill — the serialized path derives it from the unit.
      if (feeCents && feeCents > 0) {
        if (!restockClientId) {
          toast.error(t('stockUnits.restock.chooseClient', 'Choose the client to bill the restocking fee to.'));
          return;
        }
        input.client_id = restockClientId;
      }
    }

    setRestockSaving(true);
    try {
      const result = await restockReturnWithFee(input);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      // Never silent about money: report the fee invoice, or exactly why it wasn't created.
      const productName =
        restockMode === 'quantity'
          ? products.find((p) => p.service_id === restockServiceId)?.service_name ?? t('stockUnits.restock.theProduct', 'the product')
          : restockUnitLabel;
      if (result.fee_invoice) {
        const amount = feeCents != null ? money(feeCents, defaultCurrencyCode) : '';
        toast.success(
          t('stockUnits.restock.doneWithInvoice', 'Unit restocked. Draft invoice {{number}} created for the {{amount}} restocking fee.', {
            number: result.fee_invoice.invoice_number ?? result.fee_invoice.invoice_id,
            amount,
          }),
        );
      } else if (result.fee_invoice_error) {
        toast(
          t('stockUnits.restock.doneFeeFailed', 'Unit restocked, but the restocking fee wasn\'t billed: {{reason}} Create it manually.', {
            reason: result.fee_invoice_error,
          }),
          { icon: '⚠️' },
        );
      } else if (restockMode === 'quantity') {
        toast.success(
          t('stockUnits.restock.doneQuantity', '{{qty}} × {{product}} restocked.', { qty: restockQuantity, product: productName }),
        );
      } else {
        toast.success(t('stockUnits.restock.done', 'Unit restocked.'));
      }
      setRestockOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('stockUnits.restock.failed', "Couldn't restock the return."));
    } finally {
      setRestockSaving(false);
    }
  }, [
    restockReturnWithFee, restockFee, restockMode, restockUnitId, restockUnitLabel, restockServiceId,
    restockLocationId, restockQuantity, restockClientId, products, defaultCurrencyCode, money, reload, t,
  ]);

  const exportCsv = useCallback(() => {
    // Export exactly what the table shows: resolved names, humanized status —
    // not raw FK UUIDs or enum values.
    const headers = [
      t('stockUnits.columns.serialNumber', 'Serial Number'),
      t('stockUnits.columns.product', 'Product'),
      t('stockUnits.columns.macAddress', 'MAC Address'),
      t('common.status', 'Status'),
      t('stockUnits.columns.location', 'Location'),
      t('stockUnits.columns.client', 'Client'),
      t('stockUnits.columns.warrantyExpires', 'Warranty Expires'),
      t('stockUnits.columns.unitCost', 'Unit Cost'),
    ];
    const rows = visibleUnits.map((unit) => [
      unit.serial_number,
      unit.product_name,
      fmtMac(unit.mac_address),
      humanizeStatus(unit.status),
      unit.location_name,
      unit.client_name,
      fmtDate(unit.warranty_expires_at),
      fmtCost(unit.unit_cost, unit.cost_currency),
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
  }, [visibleUnits, t, fmtCost]);

  const emptyCell = <span className="text-[rgb(var(--color-text-400))]">{t('common.emptyValue', '—')}</span>;

  const columns: ColumnDefinition<IStockUnit>[] = [
    {
      title: t('stockUnits.columns.serialNumber', 'Serial Number'),
      dataIndex: 'serial_number',
      render: (value: string | null | undefined) =>
        value ? <span className="font-mono">{value}</span> : emptyCell,
    },
    {
      title: t('stockUnits.columns.product', 'Product'),
      dataIndex: 'product_name',
      render: (_value: unknown, record: IStockUnit) =>
        record.product_name ? <span>{record.product_name}</span> : emptyCell,
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
      title: t('stockUnits.columns.unitCost', 'Unit Cost'),
      dataIndex: 'unit_cost',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
      render: (value: number | string | null | undefined, record: IStockUnit) => {
        const c = fmtCost(value, record.cost_currency);
        return c ? <span className="font-mono">{c}</span> : emptyCell;
      },
    },
    {
      title: t('common.actions', 'Actions'),
      dataIndex: 'unit_id',
      width: '300px',
      headerClassName: 'text-right',
      sortable: false,
      render: (_value: unknown, rec: IStockUnit) => (
        <div className="flex justify-end gap-1">
          {restockReturnWithFee && (rec.status === 'delivered' || rec.status === 'returned') && (
            <Button
              id={`unit-restock-${rec.unit_id}`}
              variant="outline"
              size="sm"
              onClick={() => openRestockForUnit(rec)}
            >
              {t('stockUnits.restock.action', 'Restock')}
            </Button>
          )}
          {rec.asset_id && (
            <Button
              id={`unit-asset-${rec.unit_id}`}
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/msp/assets/${rec.asset_id}`)}
            >
              {t('stockUnits.viewAsset', 'View asset')}
            </Button>
          )}
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
            {visibleUnits.length === 1
              ? t('stockUnits.summary.one', '{{n}} unit', { n: visibleUnits.length })
              : t('stockUnits.summary.many', '{{n}} units', { n: visibleUnits.length })}
            {totalValueCents > 0 && (
              <span>{t('stockUnits.summary.valueSuffix', ' · {{value}} value', { value: fmtCost(totalValueCents) })}</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {restockReturnWithFee && (
            <Button id="stock-units-restock-button" variant="outline" onClick={openRestock}>
              {t('stockUnits.restock.headerAction', 'Restock a return')}
            </Button>
          )}
          <Button id="stock-units-refresh-button" variant="outline" onClick={reload} disabled={loading}>
            {t('common.refresh', 'Refresh')}
          </Button>
        </div>
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
        <div>
          <CustomSelect
            id="stock-units-status-filter"
            label={t('stockUnits.filter.status', 'Status')}
            options={STATUS_FILTER_OPTIONS}
            value={statusFilter}
            onValueChange={setStatusFilter}
          />
        </div>
        <div>
          <CustomSelect
            id="stock-units-client-filter"
            label={t('stockUnits.filter.client', 'Client')}
            options={CLIENT_FILTER_OPTIONS}
            value={clientFilter}
            onValueChange={setClientFilter}
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
        <Button id="stock-units-export-csv" variant="outline" onClick={exportCsv} disabled={visibleUnits.length === 0}>
          {t('stockUnits.exportCsv', 'Export CSV')}
        </Button>
      </div>

      {!loading && visibleUnits.length === 0 ? (
        isFiltered ? (
          <EmptyState
            icon={<PackageSearch size={20} />}
            title={
              query.trim()
                ? t('stockUnits.empty.noMatchTitle', 'No units match "{{term}}"', { term: query.trim() })
                : t('stockUnits.empty.noFilterMatchTitle', 'No units match this filter')
            }
            description={t('stockUnits.empty.noMatchDescription', 'Clear the search and filters to see all units.')}
            action={
              <Button id="stock-units-empty-clear" variant="link" onClick={clearFilters}>
                {t('stockUnits.empty.clearFilters', 'Clear filters')}
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
        <DataTable id="stock-units-table" data={visibleUnits} columns={columns} />
      )}

      {restockReturnWithFee && (
        <Dialog
          isOpen={restockOpen}
          onClose={() => setRestockOpen(false)}
          title={t('stockUnits.restock.dialogTitle', 'Restock a returned unit')}
          id="stock-units-restock-dialog"
        >
          <div className="space-y-4 p-1">
            <CustomSelect
              id="restock-mode"
              label={t('stockUnits.restock.mode', 'What are you restocking?')}
              options={[
                { value: 'unit', label: t('stockUnits.restock.modeUnit', 'A specific returned unit') },
                { value: 'quantity', label: t('stockUnits.restock.modeQuantity', 'A quantity of a product') },
              ]}
              value={restockMode}
              onValueChange={(v) => setRestockMode(v as RestockMode)}
            />

            {restockMode === 'unit' ? (
              <>
                <AsyncSearchableSelect
                  id="restock-unit"
                  label={t('stockUnits.restock.unit', 'Unit')}
                  required
                  value={restockUnitId}
                  selectedLabel={restockUnitLabel || undefined}
                  loadOptions={loadRestockUnitOptions}
                  dropdownMode="overlay"
                  placeholder={t('stockUnits.restock.unitPlaceholder', 'Search a delivered or returned unit…')}
                  emptyMessage={t('stockUnits.restock.noUnits', 'No delivered or returned units match')}
                  onChange={(value, option) => {
                    setRestockUnitId(value);
                    setRestockUnitLabel(option?.label ?? '');
                  }}
                />
                <CustomSelect
                  id="restock-unit-location"
                  label={t('stockUnits.restock.location', 'Restock to location')}
                  value={restockLocationId}
                  options={[
                    { value: '', label: t('stockUnits.restock.useCurrentLocation', "Use unit's current location") },
                    ...(locations || []).map((loc) => ({ value: loc.location_id, label: loc.name })),
                  ]}
                  onValueChange={(v) => setRestockLocationId(v)}
                />
              </>
            ) : (
              <>
                <CustomSelect
                  id="restock-product"
                  label={t('stockUnits.restock.product', 'Product')}
                  required
                  value={restockServiceId}
                  placeholder={t('stockUnits.restock.productPlaceholder', 'Select a product…')}
                  options={products.map((p) => ({
                    value: p.service_id,
                    label: p.sku ? `${p.service_name ?? p.service_id} · ${p.sku}` : p.service_name ?? p.service_id,
                  }))}
                  onValueChange={(v) => setRestockServiceId(v)}
                />
                <CustomSelect
                  id="restock-quantity-location"
                  label={t('stockUnits.restock.location', 'Restock to location')}
                  required
                  value={restockLocationId}
                  placeholder={t('stockUnits.restock.locationPlaceholder', 'Select a location…')}
                  options={(locations || []).map((loc) => ({ value: loc.location_id, label: loc.name }))}
                  onValueChange={(v) => setRestockLocationId(v)}
                />
                <Input
                  id="restock-quantity"
                  label={t('stockUnits.restock.quantity', 'Quantity')}
                  type="number"
                  min={1}
                  value={restockQuantity}
                  onChange={(e) => setRestockQuantity(e.target.value)}
                />
              </>
            )}

            <CurrencyInput
              id="restock-fee"
              label={t('stockUnits.restock.fee', 'Restocking fee')}
              currencyCode={defaultCurrencyCode}
              value={restockFee ? Number(restockFee) : undefined}
              onChange={(value) => setRestockFee(value == null ? '' : String(value))}
            />

            {/* A non-serialized fee needs a client to bill; the serialized path derives it from the unit. */}
            {restockMode === 'quantity' && restockFee.trim() !== '' && Number(restockFee) > 0 && (
              <div className="space-y-1">
                <label className="block text-sm font-medium">{t('stockUnits.restock.feeClient', 'Bill restocking fee to')}</label>
                <ClientPicker
                  id="restock-client"
                  clients={clients}
                  selectedClientId={restockClientId}
                  onSelect={(id) => setRestockClientId(id)}
                  filterState={restockClientFilter}
                  onFilterStateChange={setRestockClientFilter}
                  clientTypeFilter={restockClientType}
                  onClientTypeFilterChange={setRestockClientType}
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button id="restock-cancel" variant="outline" onClick={() => setRestockOpen(false)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button id="restock-save" onClick={submitRestock} disabled={restockSaving}>
                {restockSaving ? t('stockUnits.restock.restocking', 'Restocking…') : t('stockUnits.restock.submit', 'Restock')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      <UnitHistoryDialog
        detail={historyDetail}
        onClose={() => setHistoryDetail(null)}
        locations={locations || []}
      />
    </div>
  );
}
