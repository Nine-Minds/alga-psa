'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Badge } from '@alga-psa/ui/components/Badge';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { CURRENCY_OPTIONS, toMinorUnits } from '@alga-psa/core';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toast } from 'react-hot-toast';
import { PoLandedCostDialog } from './PoLandedCostDialog';
import type {
  ColumnDefinition,
  IPurchaseOrder,
  IPurchaseOrderLine,
  IStockLocation,
  IVendor,
} from '@alga-psa/types';
import {
  listPurchaseOrders,
  createPurchaseOrder,
  submitPurchaseOrder,
  cancelPurchaseOrder,
  getPurchaseOrder,
  receivePoLine,
  listStockLocations,
  listVendors,
  listInventoryProducts,
  type PurchaseOrderListRow,
} from '../actions';

type ProductOption = {
  service_id: string;
  service_name?: string | null;
  sku?: string | null;
  is_serialized?: boolean;
};

interface LineForm {
  service_id: string;
  quantity_ordered: string;
  unit_cost: string; // dollars in the form; converted to integer cents on submit
}

interface FormState {
  vendor_id: string;
  currency_code: string;
  expected_date: string; // yyyy-mm-dd from the date input; '' = none
  lines: LineForm[];
}

const emptyLine = (): LineForm => ({ service_id: '', quantity_ordered: '1', unit_cost: '0' });

const emptyForm = (currencyCode: string): FormState => ({
  vendor_id: '',
  currency_code: currencyCode,
  expected_date: '',
  lines: [emptyLine()],
});

/** Per-line receive form keyed by po_line_id. */
interface ReceiveLineForm {
  location_id: string;
  quantity: string;
  serials: string; // newline-separated serial numbers; only used for serialized products
}

const RECEIVABLE_STATUSES = new Set(['open', 'partially_received']);

function formatDate(value?: string | Date | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}

const NUM_HEADER = 'text-right';
const NUM_CELL = 'text-right tabular-nums';

/** Operator-facing message from an unknown error, with a plain-language fallback. */
function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Turn a raw enum value ("partially_received") into a sentence-case label ("Partially received"). */
function humanize(value?: string | null): string {
  if (!value) return '';
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function statusVariant(status: string) {
  switch (status) {
    case 'cancelled':
      return 'error' as const;
    case 'received':
      return 'success' as const;
    // Open = placed, nothing received yet (in flight). Partially received = some stock
    // landed, balance still owed (mid-fulfillment, watch it). Distinct colors so a glance
    // tells "waiting" from "in progress" — they used to share one amber badge.
    case 'partially_received':
      return 'warning' as const;
    case 'open':
      return 'info' as const;
    default:
      return 'secondary' as const;
  }
}

/** Statuses that represent money still on order (counted in the header's open total). */
const OUTSTANDING_STATUSES = new Set(['open', 'partially_received']);

export function PurchaseOrdersManager({
  initialPos,
  loadError = false,
  defaultCurrencyCode = 'USD',
}: {
  initialPos: PurchaseOrderListRow[];
  loadError?: boolean;
  defaultCurrencyCode?: string;
}) {
  const { t } = useTranslation('features/inventory');
  const { money } = useCurrencyFormat();
  const STATUS_FILTER_OPTIONS = [
    { value: '', label: t('purchaseOrders.status.allStatuses', 'All statuses') },
    { value: 'draft', label: t('purchaseOrders.status.draft', 'Draft') },
    { value: 'open', label: t('purchaseOrders.status.open', 'Open') },
    { value: 'partially_received', label: t('purchaseOrders.status.partiallyReceived', 'Partially received') },
    { value: 'received', label: t('purchaseOrders.status.received', 'Received') },
    { value: 'cancelled', label: t('purchaseOrders.status.cancelled', 'Cancelled') },
  ];
  // Localized display label per raw PO status. Logic/variant lookups still use the raw
  // enum value; only the badge/toast text is translated. Unknown values fall back to humanize().
  const PO_STATUS_LABELS: Record<string, string> = {
    draft: t('purchaseOrders.status.draft', 'Draft'),
    open: t('purchaseOrders.status.open', 'Open'),
    partially_received: t('purchaseOrders.status.partiallyReceived', 'Partially received'),
    received: t('purchaseOrders.status.received', 'Received'),
    cancelled: t('purchaseOrders.status.cancelled', 'Cancelled'),
  };
  const statusLabel = (status?: string | null): string =>
    (status && PO_STATUS_LABELS[status]) || humanize(status);
  const [pos, setPos] = useState<PurchaseOrderListRow[]>(initialPos || []);
  // Seeded from the server: a failed SSR load must read as an error, not as "no POs".
  const [loadFailed, setLoadFailed] = useState(loadError);
  const [vendors, setVendors] = useState<IVendor[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm(defaultCurrencyCode));
  const [saving, setSaving] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<IPurchaseOrder | null>(null);
  const [landedCostPo, setLandedCostPo] = useState<IPurchaseOrder | null>(null);

  // Receive flow state.
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receivePo, setReceivePo] = useState<IPurchaseOrder | null>(null);
  const [locations, setLocations] = useState<IStockLocation[]>([]);
  const [receiveForms, setReceiveForms] = useState<Record<string, ReceiveLineForm>>({});
  const [receiving, setReceiving] = useState(false);

  const reload = useCallback(async () => {
    try {
      setPos(await listPurchaseOrders({}));
      setLoadFailed(false);
    } catch (e) {
      console.error(e);
      setLoadFailed(true);
      toast.error(t('purchaseOrders.loadError', "Couldn't load purchase orders."));
    }
  }, [t]);

  const loadVendors = useCallback(async () => {
    try {
      setVendors(await listVendors({}));
    } catch (e) {
      console.error(e);
      toast.error(t('purchaseOrders.vendorsLoadError', "Couldn't load vendors."));
    }
  }, [t]);

  const loadProducts = useCallback(async () => {
    try {
      setProducts((await listInventoryProducts()) as ProductOption[]);
    } catch (e) {
      console.error(e);
      toast.error(t('purchaseOrders.productsLoadError', "Couldn't load products."));
    }
  }, [t]);

  useEffect(() => {
    void loadVendors();
    void loadProducts();
  }, [loadVendors, loadProducts]);

  const vendorName = useCallback(
    (vendorId: string) => vendors.find((v) => v.vendor_id === vendorId)?.vendor_name || vendorId,
    [vendors],
  );

  const productName = useCallback(
    (serviceId: string) => products.find((p) => p.service_id === serviceId)?.service_name || serviceId,
    [products],
  );

  const isSerialized = useCallback(
    (serviceId: string) => products.find((p) => p.service_id === serviceId)?.is_serialized ?? false,
    [products],
  );

  const productOptions = products.map((p) => ({
    value: p.service_id,
    label: `${p.service_name || t('purchaseOrders.unnamedProduct', 'Unnamed product')}${p.sku ? ` — ${p.sku}` : ''}`,
  }));

  const openCreate = () => {
    setForm(emptyForm(defaultCurrencyCode));
    setDialogOpen(true);
  };

  const updateLine = (idx: number, patch: Partial<LineForm>) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  };

  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));

  const removeLine = (idx: number) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));

  const save = async () => {
    if (!form.vendor_id) {
      toast.error(t('purchaseOrders.vendorRequired', 'Vendor is required'));
      return;
    }
    if (!form.currency_code.trim()) {
      toast.error(t('purchaseOrders.currencyRequired', 'Currency is required'));
      return;
    }
    const lines = form.lines
      .filter((l) => l.service_id.trim())
      .map((l) => ({
        service_id: l.service_id.trim(),
        quantity_ordered: Number(l.quantity_ordered),
        unit_cost: toMinorUnits(Number(l.unit_cost || 0), undefined, form.currency_code),
      }));
    for (const l of lines) {
      if (!(l.quantity_ordered > 0)) {
        toast.error(t('purchaseOrders.lineQtyRequired', 'Each line quantity must be greater than 0'));
        return;
      }
    }
    setSaving(true);
    try {
      await createPurchaseOrder({
        vendor_id: form.vendor_id,
        currency_code: form.currency_code.trim(),
        expected_date: form.expected_date || null,
        lines,
      });
      toast.success(t('purchaseOrders.created', 'Purchase order created.'));
      setDialogOpen(false);
      await reload();
    } catch (e) {
      toast.error(errMessage(e, t('purchaseOrders.createFailed', "Couldn't create the purchase order.")));
    } finally {
      setSaving(false);
    }
  };

  const submit = async (po: IPurchaseOrder) => {
    try {
      await submitPurchaseOrder(po.po_id);
      toast.success(t('purchaseOrders.submitted', 'Purchase order submitted.'));
      await reload();
    } catch (e) {
      toast.error(errMessage(e, t('purchaseOrders.submitFailed', "Couldn't submit the purchase order.")));
    }
  };

  const cancel = async (po: IPurchaseOrder) => {
    try {
      await cancelPurchaseOrder(po.po_id);
      toast.success(t('purchaseOrders.cancelled', 'Purchase order cancelled.'));
      await reload();
    } catch (e) {
      toast.error(errMessage(e, t('purchaseOrders.cancelFailed', "Couldn't cancel the purchase order.")));
    }
  };

  const openReceive = async (po: IPurchaseOrder) => {
    setReceiveOpen(true);
    setReceivePo(null);
    setReceiveForms({});
    try {
      const [full, locs] = await Promise.all([
        getPurchaseOrder(po.po_id),
        listStockLocations({ includeInactive: false }),
      ]);
      if (!full) {
        toast.error(t('purchaseOrders.notFound', 'Purchase order not found'));
        setReceiveOpen(false);
        return;
      }
      setLocations(locs);
      const defaultLocation = locs.find((l) => l.is_default)?.location_id ?? locs[0]?.location_id ?? '';
      const forms: Record<string, ReceiveLineForm> = {};
      for (const line of full.lines ?? []) {
        const remaining = Number(line.quantity_ordered) - Number(line.quantity_received);
        forms[line.po_line_id] = {
          location_id: defaultLocation,
          quantity: String(remaining > 0 ? remaining : 0),
          serials: '',
        };
      }
      setReceiveForms(forms);
      setReceivePo(full);
    } catch (e) {
      toast.error(errMessage(e, t('purchaseOrders.loadOneFailed', "Couldn't load the purchase order.")));
      setReceiveOpen(false);
    }
  };

  const updateReceiveLine = (poLineId: string, patch: Partial<ReceiveLineForm>) => {
    setReceiveForms((f) => ({ ...f, [poLineId]: { ...f[poLineId], ...patch } }));
  };

  const receiveLine = async (line: IPurchaseOrderLine) => {
    const rf = receiveForms[line.po_line_id];
    if (!rf) return;
    if (!rf.location_id) {
      toast.error(t('purchaseOrders.locationRequired', 'Location is required'));
      return;
    }
    const quantity = Number(rf.quantity);
    if (!(quantity > 0)) {
      toast.error(t('purchaseOrders.qtyRequired', 'Quantity must be greater than 0'));
      return;
    }
    const serialNumbers = rf.serials
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const serials = serialNumbers.length
      ? serialNumbers.map((serial_number) => ({ serial_number }))
      : undefined;

    setReceiving(true);
    try {
      const result = await receivePoLine(line.po_line_id, {
        location_id: rf.location_id,
        quantity,
        serials,
      });
      if (result.over_receipt) {
        toast(t('purchaseOrders.overReceived', "Received {{quantity}}. You've now received more than was ordered.", { quantity }), { icon: '⚠️' });
      } else {
        toast.success(t('purchaseOrders.receivedStatus', 'Received {{quantity}}. Purchase order is now {{status}}.', { quantity, status: statusLabel(result.po_status).toLowerCase() }));
      }
      // Refresh the open dialog and the list.
      const full = await getPurchaseOrder(line.po_id);
      if (full) {
        setReceivePo(full);
        setReceiveForms((prev) => {
          const next = { ...prev };
          for (const l of full.lines ?? []) {
            const remaining = Number(l.quantity_ordered) - Number(l.quantity_received);
            const existing = next[l.po_line_id];
            next[l.po_line_id] = {
              location_id: existing?.location_id || rf.location_id,
              quantity: String(remaining > 0 ? remaining : 0),
              serials: '',
            };
          }
          return next;
        });
      }
      await reload();
    } catch (e) {
      toast.error(errMessage(e, t('purchaseOrders.receiveFailed', "Couldn't receive this line.")));
    } finally {
      setReceiving(false);
    }
  };

  const columns: ColumnDefinition<PurchaseOrderListRow>[] = [
    {
      // The row's identity — the string operators say out loud and search for. Give it
      // weight so it out-ranks the data around it.
      title: t('purchaseOrders.columns.poNumber', 'PO Number'),
      dataIndex: 'po_number',
      render: (v: any) => <span className="font-medium text-gray-900">{v}</span>,
    },
    {
      title: t('purchaseOrders.columns.vendor', 'Vendor'),
      dataIndex: 'vendor_id',
      // Server-joined name first; the client-side vendors lookup is only a fallback
      // (it loads async, which used to flash raw UUIDs).
      render: (v: any, rec) => rec.vendor_name || vendorName(v),
    },
    {
      // The defining number of a purchase order: Σ(unit_cost × qty_ordered) across lines,
      // in the PO's own currency (which is why there's no separate constant "Currency" column).
      title: t('purchaseOrders.columns.amount', 'Amount'),
      dataIndex: 'total_amount',
      headerClassName: NUM_HEADER,
      cellClassName: `${NUM_CELL} font-medium text-gray-900`,
      render: (v: any, rec: PurchaseOrderListRow) => money(Number(v ?? 0), rec.currency_code),
    },
    {
      title: t('common.status', 'Status'),
      dataIndex: 'status',
      render: (v: any) => (
        <Badge variant={statusVariant(v)} size="sm">
          {statusLabel(v)}
        </Badge>
      ),
    },
    {
      // The magnitude the "Partially received" badge omits: how much of the order has landed.
      title: t('purchaseOrders.columns.received', 'Received'),
      dataIndex: 'qty_received',
      headerClassName: NUM_HEADER,
      cellClassName: NUM_CELL,
      sortable: false,
      render: (_: any, rec: PurchaseOrderListRow) =>
        rec.line_count === 0 ? t('common.emptyValue', '—') : `${rec.qty_received} / ${rec.qty_ordered}`,
    },
    {
      // "When is it arriving" — the question an open PO exists to answer.
      title: t('purchaseOrders.columns.expected', 'Expected'),
      dataIndex: 'expected_date',
      render: (v: any) => formatDate(v) || t('common.emptyValue', '—'),
    },
    {
      // Width matches the sibling managers (RMA/SO) so the labels never clip to
      // "Submi"/"Receiv". Only the actions that actually apply to a row's status are
      // rendered — Submit on drafts, Receive on receivable POs, Cancel until terminal —
      // instead of painting all three on every row and greying the inapplicable ones.
      title: t('common.actions', 'Actions'),
      dataIndex: 'po_id',
      width: '230px',
      render: (_: any, rec: IPurchaseOrder) => {
        const canSubmit = rec.status === 'draft';
        const canReceive = RECEIVABLE_STATUSES.has(rec.status);
        const canCancel = rec.status !== 'cancelled' && rec.status !== 'received';
        return (
          <div className="flex gap-2">
            {/* The primary verb for the row's state (Submit a draft, Receive an open PO) gets
                the emphasized soft variant; Cancel stays quiet. One clear action per row. */}
            {canSubmit && (
              <Button id={`submit-po-${rec.po_id}`} variant="soft" size="sm" onClick={() => submit(rec)}>
                {t('purchaseOrders.actions.submit', 'Submit')}
              </Button>
            )}
            {canReceive && (
              <Button id={`receive-po-${rec.po_id}`} variant="soft" size="sm" onClick={() => openReceive(rec)}>
                {t('purchaseOrders.actions.receive', 'Receive')}
              </Button>
            )}
            {(rec.status === 'partially_received' || rec.status === 'received') && (
              <Button
                id={`landed-cost-po-${rec.po_id}`}
                variant="outline"
                size="sm"
                onClick={() => setLandedCostPo(rec)}
              >
                {t('purchaseOrders.actions.landedCost', 'Landed cost')}
              </Button>
            )}
            {canCancel && (
              <Button id={`cancel-po-${rec.po_id}`} variant="ghost" size="sm" onClick={() => setPendingCancel(rec)}>
                {t('common.cancel', 'Cancel')}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const q = search.trim().toLowerCase();
  const filtered = pos.filter((p) => {
    if (statusFilter && p.status !== statusFilter) return false;
    if (vendorFilter && p.vendor_id !== vendorFilter) return false;
    if (!q) return true;
    return p.po_number.toLowerCase().includes(q) || vendorName(p.vendor_id).toLowerCase().includes(q);
  });

  // Money currently on order — the at-a-glance number for "what's outstanding".
  const outstanding = pos.filter((p) => OUTSTANDING_STATUSES.has(p.status));
  const outstandingCurrencies = new Set(outstanding.map((p) => p.currency_code || defaultCurrencyCode));
  const canShowOpenTotal = outstandingCurrencies.size <= 1;
  const openCurrency = outstanding[0]?.currency_code ?? defaultCurrencyCode;
  const openTotal = canShowOpenTotal
    ? outstanding.reduce((sum, p) => sum + Number(p.total_amount ?? 0), 0)
    : 0;
  const filtersActive = Boolean(q || statusFilter || vendorFilter);

  const vendorFilterOptions = [
    { value: '', label: t('purchaseOrders.allVendors', 'All vendors') },
    ...vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name })),
  ];

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setVendorFilter('');
  };

  return (
    <div className="p-6 space-y-4" id="purchase-orders-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('purchaseOrders.title', 'Purchase Orders')}</h1>
          {!loadFailed && (
            <p className="text-sm text-gray-500 mt-0.5">
              {pos.length === 1
                ? t('purchaseOrders.count', '{{count}} purchase order', { count: pos.length })
                : t('purchaseOrders.countPlural', '{{count}} purchase orders', { count: pos.length })}
              {outstanding.length > 0 && (
                <span className="font-medium text-gray-700">
                  {' '}
                  · {canShowOpenTotal
                    ? t('purchaseOrders.amountOnOrder', '{{amount}} on order', { amount: money(openTotal, openCurrency) })
                    : t('purchaseOrders.mixedCurrencyOnOrder', '{{count}} purchase orders on order across multiple currencies', { count: outstanding.length })}
                </span>
              )}
            </p>
          )}
        </div>
        <Button id="purchase-orders-add-button" onClick={openCreate}>
          {t('purchaseOrders.addPurchaseOrder', 'Add Purchase Order')}
        </Button>
      </div>

      {!loadFailed && pos.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="w-72">
            <SearchInput
              id="purchase-orders-search"
              placeholder={t('purchaseOrders.searchPlaceholder', 'Search PO number or vendor')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')}
            />
          </div>
          <div className="w-48">
            <CustomSelect
              id="purchase-orders-status-filter"
              value={statusFilter}
              options={STATUS_FILTER_OPTIONS}
              onValueChange={setStatusFilter}
              placeholder={t('purchaseOrders.status.allStatuses', 'All statuses')}
            />
          </div>
          <div className="w-56">
            <CustomSelect
              id="purchase-orders-vendor-filter"
              value={vendorFilter}
              options={vendorFilterOptions}
              onValueChange={setVendorFilter}
              placeholder={t('purchaseOrders.allVendors', 'All vendors')}
            />
          </div>
          {filtersActive && (
            <span className="text-sm text-gray-500">
              {t('purchaseOrders.filteredCount', '{{filtered}} of {{total}}', { filtered: filtered.length, total: pos.length })}
            </span>
          )}
        </div>
      )}

      {loadFailed ? (
        <EmptyState
          title={t('purchaseOrders.loadErrorTitle', "Couldn't load purchase orders")}
          description={t('purchaseOrders.loadErrorDescription', 'Something went wrong loading this page. Try again.')}
          action={
            <Button id="purchase-orders-retry" onClick={reload}>
              {t('common.retry', 'Retry')}
            </Button>
          }
        />
      ) : pos.length === 0 ? (
        <EmptyState
          title={t('purchaseOrders.emptyTitle', 'No purchase orders yet')}
          description={t('purchaseOrders.emptyDescription', "Create a purchase order to track what's on order from your vendors.")}
          action={
            <Button id="purchase-orders-empty-add" onClick={openCreate}>
              {t('purchaseOrders.addPurchaseOrder', 'Add Purchase Order')}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('purchaseOrders.noMatchTitle', 'No purchase orders match')}
          action={
            <Button id="purchase-orders-clear-filters" variant="link" onClick={clearFilters}>
              {t('purchaseOrders.clearFilters', 'Clear filters')}
            </Button>
          }
        />
      ) : (
        <DataTable id="purchase-orders-table" data={filtered} columns={columns} />
      )}

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t('purchaseOrders.addPurchaseOrder', 'Add Purchase Order')}
        id="purchase-order-dialog"
      >
        <div className="space-y-4 p-1">
          <CustomSelect
            id="purchase-order-vendor"
            label={t('purchaseOrders.fields.vendor', 'Vendor')}
            required
            placeholder={t('purchaseOrders.fields.selectVendor', 'Select a vendor…')}
            value={form.vendor_id}
            onValueChange={(value) => setForm({ ...form, vendor_id: value })}
            options={vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name }))}
          />

          <div className="grid grid-cols-2 gap-3">
            <CustomSelect
              id="purchase-order-currency"
              label={t('purchaseOrders.fields.currency', 'Currency')}
              required
              value={form.currency_code}
              onValueChange={(value) => setForm({ ...form, currency_code: value })}
              options={CURRENCY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
            <Input
              id="purchase-order-expected-date"
              label={t('purchaseOrders.fields.expectedDate', 'Expected date')}
              type="date"
              value={form.expected_date}
              onChange={(e) => setForm({ ...form, expected_date: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium">{t('purchaseOrders.fields.items', 'Items')}</label>
              <Button id="purchase-order-add-line" variant="outline" size="sm" onClick={addLine}>
                {t('purchaseOrders.actions.addItem', 'Add item')}
              </Button>
            </div>
            {/* Column headers once, so each line row carries inputs only — not a hand-rolled
                label per field repeated down the list. */}
            <div className="flex gap-2 items-center text-xs font-medium text-gray-600">
              <div className="flex-1">{t('purchaseOrders.columns.product', 'Product')}</div>
              <div className="w-24 text-right">{t('purchaseOrders.columns.qty', 'Qty')}</div>
              <div className="w-32 text-right">{t('purchaseOrders.columns.unitCost', 'Unit cost')}</div>
              <div className="w-20" />
            </div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="flex gap-2 items-center" id={`purchase-order-line-${idx}`}>
                <div className="flex-1">
                  <CustomSelect
                    id={`purchase-order-line-service-${idx}`}
                    placeholder={t('purchaseOrders.fields.selectProduct', 'Select a product…')}
                    value={line.service_id}
                    onValueChange={(value) => updateLine(idx, { service_id: value })}
                    options={productOptions}
                  />
                </div>
                <div className="w-24">
                  <Input
                    id={`purchase-order-line-qty-${idx}`}
                    type="number"
                    min="1"
                    step="1"
                    className="text-right tabular-nums"
                    value={line.quantity_ordered}
                    onChange={(e) => updateLine(idx, { quantity_ordered: e.target.value })}
                  />
                </div>
                <div className="w-32">
                  <CurrencyInput
                    id={`purchase-order-line-cost-${idx}`}
                    currencyCode={form.currency_code}
                    className="text-right tabular-nums"
                    value={Number(line.unit_cost || 0)}
                    onChange={(value) => updateLine(idx, { unit_cost: value == null ? '' : String(value) })}
                  />
                </div>
                <Button
                  id={`purchase-order-line-remove-${idx}`}
                  variant="ghost"
                  size="sm"
                  disabled={form.lines.length <= 1}
                  onClick={() => removeLine(idx)}
                >
                  {t('common.remove', 'Remove')}
                </Button>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button id="purchase-order-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="purchase-order-save" onClick={save} disabled={saving}>
              {saving ? t('common.saving', 'Saving…') : t('purchaseOrders.actions.create', 'Create')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        title={receivePo ? t('purchaseOrders.receiveTitle', 'Receive {{poNumber}}', { poNumber: receivePo.po_number }) : t('purchaseOrders.receiveTitleDefault', 'Receive Purchase Order')}
        id="receive-po-dialog"
      >
        <div className="space-y-4 p-1">
          {!receivePo ? (
            <p className="text-sm text-gray-500">{t('purchaseOrders.loadingPo', 'Loading purchase order…')}</p>
          ) : (receivePo.lines ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">{t('purchaseOrders.noLines', 'This purchase order has no lines.')}</p>
          ) : (
            (receivePo.lines ?? []).map((line) => {
              const rf = receiveForms[line.po_line_id];
              const remaining = Number(line.quantity_ordered) - Number(line.quantity_received);
              const fullyReceived = remaining <= 0;
              return (
                <div
                  key={line.po_line_id}
                  className="border rounded p-3 space-y-2"
                  id={`receive-line-${line.po_line_id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">
                      {productName(line.service_id)}
                      {line.vendor_sku && (
                        // The distributor's part number — what the vendor's paperwork shows (F057).
                        <span className="ml-2 text-xs text-gray-500 font-mono">{line.vendor_sku}</span>
                      )}
                    </span>
                    <span className="text-sm text-gray-600 tabular-nums">
                      {t('purchaseOrders.receivedOf', '{{received}} of {{ordered}} received', { received: Number(line.quantity_received), ordered: Number(line.quantity_ordered) })}
                    </span>
                  </div>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <CustomSelect
                        id={`receive-line-location-${line.po_line_id}`}
                        label={t('purchaseOrders.fields.location', 'Location')}
                        placeholder={t('purchaseOrders.fields.selectLocation', 'Select a location…')}
                        value={rf?.location_id ?? ''}
                        onValueChange={(value) => updateReceiveLine(line.po_line_id, { location_id: value })}
                        options={locations.map((loc) => ({ value: loc.location_id, label: loc.name }))}
                      />
                    </div>
                    <div className="w-24">
                      <Input
                        id={`receive-line-qty-${line.po_line_id}`}
                        label={t('purchaseOrders.columns.qty', 'Qty')}
                        type="number"
                        min="1"
                        className="text-right tabular-nums"
                        value={rf?.quantity ?? ''}
                        onChange={(e) => updateReceiveLine(line.po_line_id, { quantity: e.target.value })}
                      />
                    </div>
                    <Button
                      id={`receive-line-submit-${line.po_line_id}`}
                      size="sm"
                      disabled={receiving}
                      onClick={() => receiveLine(line)}
                    >
                      {receiving ? t('purchaseOrders.actions.receiving', 'Receiving…') : t('purchaseOrders.actions.receive', 'Receive')}
                    </Button>
                  </div>
                  {/* Serials only matter for serialized products — don't show the field (or its
                      "required for serialized products" hedge) on consumables that have no serials. */}
                  {isSerialized(line.service_id) && (
                    <TextArea
                      id={`receive-line-serials-${line.po_line_id}`}
                      label={t('purchaseOrders.fields.serialNumbers', 'Serial numbers (one per line)')}
                      rows={2}
                      value={rf?.serials ?? ''}
                      onChange={(e) => updateReceiveLine(line.po_line_id, { serials: e.target.value })}
                    />
                  )}
                  {fullyReceived && (
                    <p className="text-xs text-gray-500">{t('purchaseOrders.lineFullyReceived', 'This line is fully received.')}</p>
                  )}
                </div>
              );
            })
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button id="receive-po-close" variant="outline" onClick={() => setReceiveOpen(false)}>
              {t('common.close', 'Close')}
            </Button>
          </div>
        </div>
      </Dialog>

      <PoLandedCostDialog
        po={landedCostPo}
        onClose={() => setLandedCostPo(null)}
        onChanged={reload}
        productName={productName}
      />

      <ConfirmationDialog
        id="cancel-po-confirm"
        isOpen={!!pendingCancel}
        onClose={() => setPendingCancel(null)}
        title={t('purchaseOrders.cancelTitle', 'Cancel purchase order')}
        message={
          pendingCancel
            ? t('purchaseOrders.cancelConfirm', 'Are you sure you want to cancel purchase order {{poNumber}}? This cannot be undone.', { poNumber: pendingCancel.po_number })
            : ''
        }
        confirmLabel={t('purchaseOrders.cancelTitle', 'Cancel purchase order')}
        cancelLabel={t('purchaseOrders.keepPo', 'Keep purchase order')}
        onConfirm={async () => {
          if (pendingCancel) {
            await cancel(pendingCancel);
          }
          setPendingCancel(null);
        }}
      />
    </div>
  );
}
