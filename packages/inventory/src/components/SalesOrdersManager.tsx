'use client';

import React, { useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { ChevronDown, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toast } from 'react-hot-toast';
import { formatCurrencyFromMinorUnits, toMinorUnits, currencyFractionDigits } from '@alga-psa/core';
import type {
  ColumnDefinition,
  IClient,
  ISalesOrder,
  IStockLocation,
  SalesOrderInvoiceMode,
  SalesOrderAllocationMode,
  SalesOrderLineFulfillmentType,
} from '@alga-psa/types';
import {
  listSalesOrders,
  createSalesOrder,
  confirmSalesOrder,
  cancelSalesOrder,
} from '../actions';
import {
  SalesOrderDetail,
  type ConfirmDropShipFn,
  type FulfillAndInvoiceFn,
  type GenerateInvoiceFn,
} from './SalesOrderDetail';

/**
 * The Sales Order document types a user can download. All three render from the same SO data;
 * the server picks the standard (or tenant/client override) template per type.
 */
const SO_DOCUMENT_TYPES = [
  { type: 'sales-order', suffix: '' },
  { type: 'packing-slip', suffix: '-packing-slip' },
  { type: 'pick-list', suffix: '-pick-list' },
] as const;

/**
 * Trigger a browser download of a Sales Order document PDF (confirmation, packing slip, or pick
 * list). Fetches the endpoint so a failure (not found / permission / render error) surfaces as a
 * toast instead of navigating the user to a raw JSON error body.
 */
async function downloadSalesOrderDocument(
  soId: string,
  soNumber: string,
  documentType: string = 'sales-order',
  fileSuffix: string = '',
  t: ReturnType<typeof useTranslation>['t'],
): Promise<void> {
  try {
    const query = documentType === 'sales-order' ? '' : `?type=${documentType}`;
    const res = await fetch(`/api/inventory/sales-orders/${soId}/document${query}`);
    if (!res.ok) {
      let message = t('salesOrders.documentFailed', "Couldn't generate the document.");
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        /* non-JSON error body — keep the generic message */
      }
      toast.error(message);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${soNumber || soId}${fileSuffix}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    toast.error(t('salesOrders.documentFailed', "Couldn't generate the document."));
  }
}

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  draft: 'secondary',
  confirmed: 'warning',
  partially_fulfilled: 'warning',
  fulfilled: 'success',
  invoiced: 'success',
  closed: 'success',
  cancelled: 'error',
};

const NUM_HEADER = 'text-right';
const NUM_CELL = 'text-right tabular-nums';

const asNumber = (value: unknown): number => Number(value ?? 0);

const money = (cents: unknown, currency?: string | null): string =>
  formatCurrencyFromMinorUnits(asNumber(cents), 'en-US', currency || 'USD');

interface LineForm {
  service_id: string;
  quantity_ordered: string;
  unit_price: string; // major units (e.g. dollars), converted to minor units on save
  fulfillment_type: SalesOrderLineFulfillmentType;
  is_kit: boolean;
  kit_pricing_mode: 'sum' | 'fixed' | null;
  kit_currency: string | null;
  resolved_unit_price: string | null;
  price_overridden: boolean;
}

interface FormState {
  client_id: string;
  /** Derived from the picked client, never free-typed. */
  currency_code: string;
  invoice_mode: SalesOrderInvoiceMode;
  allocation_mode: SalesOrderAllocationMode;
  client_po_number: string;
  expected_ship_date: string; // yyyy-mm-dd, optional
  notes: string;
  lines: LineForm[];
}

/**
 * A sellable catalog entry for the line-item picker. Fetched by the page via billing's
 * `getServices` and passed down (inventory can't import billing directly). `default_rate` is in
 * the currency's minor units (e.g. cents) and seeds the editable unit price.
 */
export interface SalesOrderServiceOption {
  service_id: string;
  service_name: string | null;
  sku: string | null;
  default_rate: number | null;
  is_kit?: boolean;
  kit_pricing_mode?: 'sum' | 'fixed' | null;
  resolved_kit_price?: number | null;
  kit_currency?: string | null;
}

const emptyLine = (): LineForm => ({
  service_id: '',
  quantity_ordered: '1',
  unit_price: '',
  fulfillment_type: 'from_stock',
  is_kit: false,
  kit_pricing_mode: null,
  kit_currency: null,
  resolved_unit_price: null,
  price_overridden: false,
});

const emptyForm = (): FormState => ({
  client_id: '',
  currency_code: '',
  invoice_mode: 'on_fulfillment',
  allocation_mode: 'soft',
  client_po_number: '',
  expected_ship_date: '',
  notes: '',
  lines: [emptyLine()],
});

export interface SalesOrdersManagerProps {
  initialSos: ISalesOrder[];
  /** Active stock locations for the fulfill dialog's source selector. */
  locations?: IStockLocation[];
  /** Clients for the create-SO client picker. */
  clients?: IClient[];
  /** Sellable services/products for the line-item picker (fetched by the page from billing). */
  services?: SalesOrderServiceOption[];
  /** Billing-owned actions passed from the page (billing → inventory dependency). */
  fulfillAndInvoice: FulfillAndInvoiceFn;
  generateInvoice: GenerateInvoiceFn;
  confirmDropShip: ConfirmDropShipFn;
}

export function SalesOrdersManager({
  initialSos,
  locations = [],
  clients = [],
  services = [],
  fulfillAndInvoice,
  generateInvoice,
  confirmDropShip,
}: SalesOrdersManagerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation('features/inventory');
  const attentionFilter = searchParams?.get('attention');
  const showInvoiceableOnly = attentionFilter === 'invoiceable';
  const requestedServiceId = searchParams?.get('service_id') || null;
  const createRequested = searchParams?.get('create') === '1';
  const INVOICE_MODE_OPTIONS: { value: SalesOrderInvoiceMode; label: string }[] = [
    { value: 'on_fulfillment', label: t('salesOrders.invoiceMode.onFulfillment', 'On fulfillment') },
    { value: 'manual', label: t('salesOrders.invoiceMode.manual', 'Manual') },
  ];
  const ALLOCATION_MODE_OPTIONS: { value: SalesOrderAllocationMode; label: string }[] = [
    { value: 'soft', label: t('salesOrders.allocationMode.soft', 'Soft') },
    { value: 'hard', label: t('salesOrders.allocationMode.hard', 'Hard') },
  ];
  const FULFILLMENT_OPTIONS: { value: SalesOrderLineFulfillmentType; label: string }[] = [
    { value: 'from_stock', label: t('salesOrders.fulfillment.fromStock', 'From stock') },
    { value: 'drop_ship', label: t('salesOrders.fulfillment.dropShip', 'Drop-ship') },
  ];
  const serviceOptions = services.map((s) => ({
    value: s.service_id,
    label: s.sku
      ? `${s.service_name ?? t('salesOrders.unnamedService', 'Unnamed')} (${s.sku})`
      : s.service_name ?? t('salesOrders.unnamedService', 'Unnamed'),
  }));
  const serviceById = React.useMemo(
    () => new Map(services.map((s) => [s.service_id, s])),
    [services],
  );
  const requestedService = requestedServiceId ? serviceById.get(requestedServiceId) : undefined;
  const documentLabels: Record<string, string> = {
    'sales-order': t('salesOrders.documents.salesOrder', 'Order Confirmation'),
    'packing-slip': t('salesOrders.documents.packingSlip', 'Packing Slip'),
    'pick-list': t('salesOrders.documents.pickList', 'Pick List'),
  };
  const statusLabel = (status: string): string => {
    switch (status) {
      case 'draft':
        return t('salesOrders.status.draft', 'Draft');
      case 'confirmed':
        return t('salesOrders.status.confirmed', 'Confirmed');
      case 'partially_fulfilled':
        return t('salesOrders.status.partiallyFulfilled', 'Partially fulfilled');
      case 'fulfilled':
        return t('salesOrders.status.fulfilled', 'Fulfilled');
      case 'invoiced':
        return t('salesOrders.status.invoiced', 'Invoiced');
      case 'closed':
        return t('salesOrders.status.closed', 'Closed');
      case 'cancelled':
        return t('salesOrders.status.cancelled', 'Cancelled');
      default:
        return status;
    }
  };
  const [sos, setSos] = useState<ISalesOrder[]>(initialSos || []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ISalesOrder | null>(null);
  const [emailTarget, setEmailTarget] = useState<ISalesOrder | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [detailSoId, setDetailSoId] = useState<string | null>(null);
  // One in-flight mutation at a time (F017): a double-click cannot fire twice, and
  // every action button disables while any mutation is pending.
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSos(await listSalesOrders({}));
    } catch (e) {
      console.error(e);
      toast.error(t('salesOrders.loadError', 'Failed to load sales orders'));
    }
  }, [t]);

  const openCreate = () => {
    setForm(emptyForm());
    setDialogOpen(true);
  };

  // Currency is a property of who you bill, not a per-order choice: derive it from the picked
  // client and render it read-only (falling back to USD only when the client has none).
  const onClientSelect = (clientId: string | null) => {
    const picked = clientId ? clients.find((c) => c.client_id === clientId) : undefined;
    const nextCurrency = picked?.default_currency_code || (clientId ? 'USD' : '');
    setForm((f) => ({
      ...f,
      client_id: clientId ?? '',
      currency_code: nextCurrency,
      lines: f.lines.map((line) => {
        if (!line.is_kit || !line.service_id || !nextCurrency) return line;
        const service = serviceById.get(line.service_id);
        const currencyMismatch = Boolean(
          service?.kit_currency && service.kit_currency.toUpperCase() !== nextCurrency.toUpperCase(),
        );
        const resolved = !currencyMismatch && service?.resolved_kit_price != null
          ? String(service.resolved_kit_price / Math.pow(10, currencyFractionDigits(nextCurrency)))
          : null;
        return {
          ...line,
          unit_price: resolved ?? '',
          resolved_unit_price: resolved,
          price_overridden: false,
        };
      }),
    }));
  };

  const setLine = (idx: number, patch: Partial<LineForm>) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  };

  const lineForService = useCallback((serviceId: string, requestedCurrency?: string): LineForm => {
    const svc = serviceById.get(serviceId);
    const currency = requestedCurrency || svc?.kit_currency || 'USD';
    const kitCurrencyMismatch = Boolean(
      svc?.is_kit && svc.kit_currency && svc.kit_currency.toUpperCase() !== currency.toUpperCase(),
    );
    const priceMinor = svc?.is_kit
      ? kitCurrencyMismatch ? null : svc.resolved_kit_price
      : svc?.default_rate;
    const seededPrice =
      priceMinor != null
        ? String(priceMinor / Math.pow(10, currencyFractionDigits(currency)))
        : undefined;
    return {
      ...emptyLine(),
      service_id: serviceId,
      unit_price: seededPrice ?? '',
      is_kit: Boolean(svc?.is_kit),
      kit_pricing_mode: svc?.kit_pricing_mode ?? null,
      kit_currency: svc?.kit_currency ?? null,
      resolved_unit_price: svc?.is_kit ? seededPrice ?? null : null,
      price_overridden: false,
    };
  }, [serviceById]);

  // The browser shows the current resolved kit price, but an untouched kit line is resolved again
  // inside the write transaction. That prevents a stale picker value from becoming an accidental
  // override when component prices change before save.
  const onServicePicked = (idx: number, serviceId: string) => {
    setLine(idx, lineForService(serviceId, form.currency_code || undefined));
  };

  React.useEffect(() => {
    if (!createRequested || !requestedServiceId || !serviceById.has(requestedServiceId)) return;
    setForm({
      ...emptyForm(),
      lines: [lineForService(requestedServiceId)],
    });
    setDialogOpen(true);
  }, [createRequested, lineForService, requestedServiceId, serviceById]);

  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (idx: number) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));

  const currency = form.currency_code || 'USD';
  // Running total: Σ quantity × unit price, in the resolved currency's minor units. Lines without
  // a picked service or a positive quantity don't contribute.
  const totalMinor = form.lines.reduce((sum, l) => {
    const qty = Number(l.quantity_ordered);
    const price = Number(l.unit_price);
    if (!l.service_id || !(qty > 0) || !Number.isFinite(price)) return sum;
    return sum + toMinorUnits(price, undefined, currency) * qty;
  }, 0);
  // A line is "priced" once a service is picked with a positive quantity. Save needs a client and
  // at least one such line; individual invalid lines are marked inline rather than via a toast.
  const lineIsValid = (l: LineForm) =>
    Boolean(l.service_id) &&
    Number(l.quantity_ordered) > 0 &&
    l.unit_price.trim() !== '' &&
    Number.isFinite(Number(l.unit_price)) &&
    Number(l.unit_price) >= 0;
  const canSave = Boolean(form.client_id) && form.lines.some(lineIsValid) && !saving;

  const save = async () => {
    if (!form.client_id.trim()) {
      toast.error(t('salesOrders.clientRequired', 'Client is required'));
      return;
    }
    if (!form.currency_code.trim()) {
      toast.error(t('salesOrders.currencyRequired', 'Currency code is required'));
      return;
    }
    const lines = form.lines
      .filter((l) => l.service_id.trim())
      .map((l) => {
        const unitPrice = toMinorUnits(Number(l.unit_price || 0), undefined, form.currency_code);
        return {
          service_id: l.service_id.trim(),
          quantity_ordered: Number(l.quantity_ordered),
          // A kit price is omitted unless the user deliberately changed this order line. The
          // server then resolves untouched kit lines again inside the create transaction.
          unit_price: l.is_kit ? undefined : unitPrice,
          kit_unit_price_override: l.is_kit && l.price_overridden ? unitPrice : undefined,
          fulfillment_type: l.fulfillment_type,
        };
      });
    for (const l of lines) {
      if (!(l.quantity_ordered > 0)) {
        toast.error(t('salesOrders.lineQtyPositive', 'Each line quantity must be greater than 0'));
        return;
      }
    }
    setSaving(true);
    try {
      await createSalesOrder({
        client_id: form.client_id.trim(),
        currency_code: form.currency_code.trim(),
        invoice_mode: form.invoice_mode,
        allocation_mode: form.allocation_mode,
        client_po_number: form.client_po_number.trim() || null,
        expected_ship_date: form.expected_ship_date || null,
        notes: form.notes.trim() || null,
        lines,
      });
      toast.success(t('salesOrders.created', 'Sales order created'));
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('common.saveFailed', 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const confirm = async (so: ISalesOrder) => {
    if (busy) return;
    setBusy(`confirm:${so.so_id}`);
    try {
      await confirmSalesOrder(so.so_id);
      toast.success(t('salesOrders.confirmed', 'Sales order confirmed'));
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('salesOrders.confirmFailed', 'Confirm failed'));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (so: ISalesOrder) => {
    if (busy) return;
    setBusy(`cancel:${so.so_id}`);
    try {
      await cancelSalesOrder(so.so_id);
      toast.success(t('salesOrders.cancelled', 'Sales order cancelled'));
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('salesOrders.cancelFailed', 'Cancel failed'));
    } finally {
      setBusy(null);
      setCancelTarget(null);
    }
  };

  // Email the Order Confirmation PDF to the client (F205). Outward-facing, so it goes through a
  // confirmation dialog; the server resolves the recipient from the client's billing email.
  const emailConfirmation = async (so: ISalesOrder) => {
    setEmailing(true);
    try {
      const res = await fetch(`/api/inventory/sales-orders/${so.so_id}/email-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.success) {
        toast.success(
          t('salesOrders.emailSuccess', 'Confirmation emailed to {{recipients}}', {
            recipients: (body.recipients || []).join(', '),
          }),
        );
      } else {
        toast.error(body?.error || t('salesOrders.emailFailed', "Couldn't email the confirmation."));
      }
    } catch {
      toast.error(t('salesOrders.emailFailed', "Couldn't email the confirmation."));
    } finally {
      setEmailing(false);
      setEmailTarget(null);
    }
  };

  const visibleSos = React.useMemo(
    () => sos.filter((so) => !showInvoiceableOnly || asNumber(so.invoiceable_amount) > 0),
    [sos, showInvoiceableOnly],
  );

  const clearAttentionFilter = () => {
    router.push('/msp/inventory/sales-orders');
  };

  const columns: ColumnDefinition<ISalesOrder>[] = [
    {
      title: t('salesOrders.columns.soNumber', 'SO Number'),
      dataIndex: 'so_number',
      render: (_: any, rec: ISalesOrder) => (
        <button
          id={`view-so-${rec.so_id}`}
          type="button"
          className="text-primary-600 hover:underline font-medium"
          onClick={() => setDetailSoId(rec.so_id)}
        >
          {rec.so_number}
        </button>
      ),
    },
    {
      title: t('salesOrders.columns.client', 'Client'),
      dataIndex: 'client_name',
      render: (_: any, rec: ISalesOrder) => rec.client_name?.trim() || rec.client_id,
    },
    {
      title: t('salesOrders.columns.amount', 'Amount'),
      dataIndex: 'total_amount',
      headerClassName: NUM_HEADER,
      cellClassName: `${NUM_CELL} font-medium text-gray-900`,
      render: (_: any, rec: ISalesOrder) => money(rec.total_amount, rec.currency_code),
    },
    {
      title: t('salesOrders.columns.fulfillment', 'Fulfillment'),
      dataIndex: 'quantity_fulfilled_total',
      headerClassName: NUM_HEADER,
      cellClassName: NUM_CELL,
      render: (_: any, rec: ISalesOrder) => {
        const ordered = asNumber(rec.quantity_ordered_total);
        const fulfilled = asNumber(rec.quantity_fulfilled_total);
        if (ordered <= 0) return t('common.emptyValue', '—');
        return (
          <div className="flex items-center justify-end gap-2">
            <span>{fulfilled} / {ordered}</span>
            {asNumber(rec.drop_ship_line_count) > 0 && (
              <Badge variant="info" size="sm">
                {t('salesOrders.badges.dropShip', 'Drop-ship')}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      title: t('salesOrders.columns.invoiceable', 'Invoiceable'),
      dataIndex: 'invoiceable_amount',
      headerClassName: NUM_HEADER,
      cellClassName: NUM_CELL,
      render: (_: any, rec: ISalesOrder) => {
        const amount = asNumber(rec.invoiceable_amount);
        if (amount <= 0) return t('common.emptyValue', '—');
        return (
          <div className="flex items-center justify-end gap-2">
            <span className="font-medium text-gray-900">{money(amount, rec.currency_code)}</span>
            <Badge variant="success" size="sm">
              {t('salesOrders.badges.readyToInvoice', 'Ready')}
            </Badge>
          </div>
        );
      },
    },
    {
      title: t('common.status', 'Status'),
      dataIndex: 'status',
      render: (value: any) => {
        const variant = STATUS_VARIANTS[value] ?? ('secondary' as BadgeVariant);
        return (
          <Badge variant={variant} size="sm">
            {statusLabel(String(value))}
          </Badge>
        );
      },
    },
    { title: t('salesOrders.columns.invoiceMode', 'Invoice Mode'), dataIndex: 'invoice_mode' },
    { title: t('salesOrders.columns.currency', 'Currency'), dataIndex: 'currency_code' },
    {
      title: t('common.actions', 'Actions'),
      dataIndex: 'so_id',
      width: '300px',
      render: (_: any, rec: ISalesOrder) => (
        <div className="flex gap-2">
          <Button
            id={`confirm-so-${rec.so_id}`}
            variant="soft"
            size="sm"
            onClick={() => confirm(rec)}
            disabled={rec.status !== 'draft' || busy !== null}
          >
            {busy === `confirm:${rec.so_id}`
              ? t('salesOrders.actions.confirming', 'Confirming…')
              : t('common.confirm', 'Confirm')}
          </Button>
          {/* SO documents (confirmation / packing slip / pick list) — each renders from the same SO
              data via the server PDF route (inventory can't import billing, so the browser fetches
              the endpoint directly with ?type=). */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`document-so-${rec.so_id}`}
                variant="outline"
                size="sm"
                disabled={rec.status === 'cancelled'}
                className="gap-1"
              >
                {t('salesOrders.actions.orderPdfs', 'Order PDFs')}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SO_DOCUMENT_TYPES.map((d) => (
                <DropdownMenuItem
                  key={d.type}
                  id={`document-so-${rec.so_id}-${d.type}`}
                  onClick={() => downloadSalesOrderDocument(rec.so_id, rec.so_number, d.type, d.suffix, t)}
                >
                  {documentLabels[d.type]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                id={`email-confirmation-so-${rec.so_id}`}
                onClick={() => setEmailTarget(rec)}
              >
                {t('salesOrders.actions.emailConfirmation', 'Email confirmation to client…')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                id={`manage-layouts-so-${rec.so_id}`}
                onClick={() => router.push('/msp/document-templates/sales-order')}
              >
                {t('salesOrders.actions.manageLayouts', 'Manage layouts')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`more-so-${rec.so_id}`}
                variant="ghost"
                size="sm"
                aria-label={t('salesOrders.actions.moreActions', 'More actions')}
                disabled={busy !== null}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id={`cancel-so-${rec.so_id}`}
                disabled={rec.status === 'cancelled' || busy !== null}
                onClick={() => setCancelTarget(rec)}
                className="text-red-600 focus:text-red-700"
              >
                {t('salesOrders.actions.cancelSalesOrder', 'Cancel sales order')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="sales-orders-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('salesOrders.title', 'Sales Orders')}</h1>
        <Button id="sales-orders-add-button" onClick={openCreate}>
          {t('salesOrders.addSalesOrder', 'Add Sales Order')}
        </Button>
      </div>

      {showInvoiceableOnly && (
        <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="text-sm text-amber-900">
            {t('salesOrders.filters.invoiceableActive', 'Showing sales orders with fulfilled, uninvoiced items.')}
          </span>
          <Button id="sales-orders-clear-attention-filter" variant="link" size="sm" onClick={clearAttentionFilter}>
            {t('common.clear', 'Clear')}
          </Button>
        </div>
      )}

      {requestedServiceId && !createRequested && (
        <div className="flex items-center gap-3 rounded-md border border-[rgb(var(--color-primary-200))] bg-[rgb(var(--color-primary-50))] px-3 py-2">
          <span className="text-sm text-[rgb(var(--color-text-800))]">
            {t('salesOrders.filters.kitUsageActive', 'Showing sales orders using {{kit}}.', {
              kit: requestedService?.service_name || requestedServiceId,
            })}
          </span>
          <Button id="sales-orders-clear-service-filter" variant="link" size="sm" onClick={clearAttentionFilter}>
            {t('common.clear', 'Clear')}
          </Button>
        </div>
      )}

      <DataTable id="sales-orders-table" data={visibleSos} columns={columns} />

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t('salesOrders.addSalesOrder', 'Add Sales Order')}
        id="sales-order-dialog"
      >
        <div className="space-y-4 p-1">
          {/* Order details — who it's for (currency follows from that) and their reference. */}
          <div className="grid grid-cols-2 gap-3 items-start">
            <div className="space-y-1">
              <label className="block text-sm font-medium">{t('salesOrders.columns.client', 'Client')}</label>
              <ClientPicker
                id="sales-order-client"
                clients={clients}
                selectedClientId={form.client_id || null}
                onSelect={onClientSelect}
                filterState={clientFilterState}
                onFilterStateChange={setClientFilterState}
                clientTypeFilter={clientTypeFilter}
                onClientTypeFilterChange={setClientTypeFilter}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium">{t('salesOrders.columns.currency', 'Currency')}</label>
              {/* Read-only: currency is a property of who you bill, derived on client select. */}
              <div
                id="sales-order-currency"
                className="h-10 flex items-center rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-3 text-sm text-[rgb(var(--color-text-700))]"
              >
                {form.currency_code || t('salesOrders.currencyFromClient', 'Set from client')}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              id="sales-order-client-po"
              label={t('salesOrders.fields.clientPoNumber', 'Client PO number')}
              value={form.client_po_number}
              onChange={(e) => setForm({ ...form, client_po_number: e.target.value })}
            />
            <Input
              id="sales-order-expected-ship-date"
              label={t('salesOrders.fields.expectedShipDate', 'Expected ship date')}
              type="date"
              value={form.expected_ship_date}
              onChange={(e) => setForm({ ...form, expected_ship_date: e.target.value })}
            />
          </div>

          {/* Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium">{t('salesOrders.fields.items', 'Items')}</label>
              <Button id="sales-order-add-line" variant="outline" size="sm" onClick={addLine}>
                {t('salesOrders.actions.addLine', 'Add Line')}
              </Button>
            </div>
            {/* Column headers once, so each row carries inputs only. */}
            <div className="flex gap-2 items-center text-xs font-medium text-gray-600">
              <div className="flex-1">{t('salesOrders.fields.service', 'Service')}</div>
              <div className="w-32">{t('salesOrders.fields.fulfillment', 'Fulfillment')}</div>
              <div className="w-20 text-right">{t('salesOrders.fields.qty', 'Qty')}</div>
              <div className="w-56 text-right">
                {t('salesOrders.fields.unitPriceIn', 'Unit price ({{currency}})', { currency })}
              </div>
              <div className="w-8" />
            </div>
            {/* Keep the footer reachable when a large order pushes past the fold. */}
            <div className="max-h-[22rem] overflow-y-auto space-y-2 pr-1">
              {form.lines.map((line, idx) => {
                const missingService = !line.service_id && Number(line.quantity_ordered) > 0;
                const badQty = Boolean(line.service_id) && !(Number(line.quantity_ordered) > 0);
                return (
                  <div key={idx} className="flex gap-2 items-start" id={`sales-order-line-${idx}`}>
                    <div className="flex-1">
                      <SearchableSelect
                        id={`sales-order-line-service-${idx}`}
                        options={serviceOptions}
                        value={line.service_id}
                        onChange={(value) => onServicePicked(idx, value)}
                        placeholder={t('salesOrders.fields.selectService', 'Select a service…')}
                        searchPlaceholder={t('salesOrders.fields.searchService', 'Search services…')}
                        emptyMessage={t('salesOrders.fields.noService', 'No service found.')}
                        dropdownMode="overlay"
                        maxListHeight="250px"
                      />
                      {missingService && (
                        <p className="mt-1 text-xs text-[rgb(var(--color-accent-500))]">
                          {t('salesOrders.pickServiceForLine', 'Pick a service for this line.')}
                        </p>
                      )}
                    </div>
                    <div className="w-32">
                      <CustomSelect
                        id={`sales-order-line-fulfillment-${idx}`}
                        options={FULFILLMENT_OPTIONS}
                        value={line.fulfillment_type}
                        onValueChange={(value) =>
                          setLine(idx, { fulfillment_type: value as SalesOrderLineFulfillmentType })
                        }
                      />
                    </div>
                    <div className="w-20">
                      <Input
                        id={`sales-order-line-qty-${idx}`}
                        type="number"
                        min="1"
                        step="1"
                        className="text-right tabular-nums"
                        value={line.quantity_ordered}
                        onChange={(e) => setLine(idx, { quantity_ordered: e.target.value })}
                      />
                      {badQty && (
                        <p className="mt-1 text-xs text-[rgb(var(--color-accent-500))]">
                          {t('salesOrders.qtyPositive', 'Must be > 0.')}
                        </p>
                      )}
                    </div>
                    <div className="w-56">
                      <Input
                        id={`sales-order-line-price-${idx}`}
                        type="number"
                        min="0"
                        step="0.01"
                        className="text-right tabular-nums"
                        value={line.unit_price}
                        onChange={(e) => setLine(idx, {
                          unit_price: e.target.value,
                          price_overridden: line.is_kit ? true : line.price_overridden,
                        })}
                      />
                      {line.is_kit && (
                        <div className="mt-1 flex items-start justify-between gap-2 text-xs">
                          <span className={line.price_overridden ? 'text-[rgb(var(--color-accent-600))]' : 'text-[rgb(var(--color-text-500))]'}>
                            {line.kit_currency && line.kit_currency.toUpperCase() !== currency.toUpperCase() && !line.price_overridden
                              ? t('salesOrders.kitPrice.currencyMismatch', 'Kit price is configured in {{kitCurrency}}. Enter a {{orderCurrency}} price for this sales order.', {
                                  kitCurrency: line.kit_currency,
                                  orderCurrency: currency,
                                })
                              : line.price_overridden && line.resolved_unit_price === null
                                ? t('salesOrders.kitPrice.currencyOverride', 'Order-specific {{currency}} price', { currency })
                              : line.price_overridden && line.resolved_unit_price !== null
                              ? t('salesOrders.kitPrice.overridden', 'Overridden from {{price}} for this sales order', {
                                  price: money(
                                    toMinorUnits(Number(line.resolved_unit_price), undefined, currency),
                                    currency,
                                  ),
                                })
                              : line.kit_pricing_mode === 'fixed'
                                ? t('salesOrders.kitPrice.configured', 'Configured kit price')
                                : t('salesOrders.kitPrice.calculated', 'Calculated from components')}
                          </span>
                          {line.price_overridden && line.resolved_unit_price !== null && (
                            <Button
                              id={`sales-order-line-price-reset-${idx}`}
                              variant="ghost"
                              size="sm"
                              className="h-auto shrink-0 px-1 py-0 text-xs"
                              onClick={() => setLine(idx, {
                                unit_price: line.resolved_unit_price ?? '',
                                price_overridden: false,
                              })}
                            >
                              <RotateCcw className="mr-1 h-3 w-3" />
                              {t('salesOrders.kitPrice.reset', 'Reset to kit price')}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="w-8 flex justify-center pt-2">
                      <Button
                        id={`sales-order-line-remove-${idx}`}
                        variant="ghost"
                        size="sm"
                        aria-label={t('common.remove', 'Remove')}
                        onClick={() => removeLine(idx)}
                        disabled={form.lines.length <= 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Billing & allocation — kept visible; helper text spells out the consequence. */}
          <div className="space-y-3 rounded-md border border-[rgb(var(--color-border-200))] p-3">
            <label className="block text-sm font-medium">
              {t('salesOrders.billingAllocation', 'Billing & allocation')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <CustomSelect
                  id="sales-order-invoice-mode"
                  label={t('salesOrders.fields.invoiceMode', 'When to invoice')}
                  options={INVOICE_MODE_OPTIONS}
                  value={form.invoice_mode}
                  onValueChange={(value) =>
                    setForm({ ...form, invoice_mode: value as SalesOrderInvoiceMode })
                  }
                />
                <p className="text-xs text-gray-500">
                  {t(
                    'salesOrders.invoiceModeHelp',
                    'On fulfillment bills as items ship; Manual leaves invoicing to you.',
                  )}
                </p>
              </div>
              <div className="space-y-1">
                <CustomSelect
                  id="sales-order-allocation-mode"
                  label={t('salesOrders.fields.allocationMode', 'How to allocate stock')}
                  options={ALLOCATION_MODE_OPTIONS}
                  value={form.allocation_mode}
                  onValueChange={(value) =>
                    setForm({ ...form, allocation_mode: value as SalesOrderAllocationMode })
                  }
                />
                <p className="text-xs text-gray-500">
                  {t(
                    'salesOrders.allocationModeHelp',
                    'Soft reserves stock but leaves it visible to other orders; Hard holds it exclusively.',
                  )}
                </p>
              </div>
            </div>
          </div>

          <TextArea
            id="sales-order-notes"
            label={t('salesOrders.fields.notes', 'Notes')}
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />

          <div className="flex items-center justify-between border-t border-[rgb(var(--color-border-200))] pt-3">
            <span className="text-sm text-gray-600">{t('salesOrders.total', 'Total')}</span>
            <span id="sales-order-total" className="text-base font-semibold tabular-nums">
              {formatCurrencyFromMinorUnits(totalMinor, undefined, currency)}
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button id="sales-order-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="sales-order-save" onClick={save} disabled={!canSave}>
              {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmationDialog
        id="cancel-so-confirm"
        isOpen={cancelTarget !== null}
        onClose={() => (busy ? undefined : setCancelTarget(null))}
        onConfirm={() => (cancelTarget ? cancel(cancelTarget) : undefined)}
        title={t('salesOrders.cancelDialog.title', 'Cancel sales order')}
        message={
          cancelTarget
            ? t('salesOrders.cancelDialog.message', 'Cancel sales order {{number}}? This cannot be undone.', {
                number: cancelTarget.so_number,
              })
            : ''
        }
        confirmLabel={t('salesOrders.cancelDialog.confirm', 'Cancel sales order')}
        cancelLabel={t('salesOrders.cancelDialog.keep', 'Keep order')}
        isConfirming={busy?.startsWith('cancel:') ?? false}
      />

      <SalesOrderDetail
        soId={detailSoId}
        onClose={() => setDetailSoId(null)}
        onChanged={reload}
        locations={locations}
        fulfillAndInvoice={fulfillAndInvoice}
        generateInvoice={generateInvoice}
        confirmDropShip={confirmDropShip}
      />

      <ConfirmationDialog
        id="email-so-confirm"
        isOpen={emailTarget !== null}
        onClose={() => (emailing ? undefined : setEmailTarget(null))}
        onConfirm={() => (emailTarget ? emailConfirmation(emailTarget) : undefined)}
        title={t('salesOrders.emailDialog.title', 'Email order confirmation')}
        message={
          emailTarget
            ? t(
                'salesOrders.emailDialog.message',
                "Email the Order Confirmation for {{number}} to the client's billing contact?",
                { number: emailTarget.so_number },
              )
            : ''
        }
        confirmLabel={t('salesOrders.emailDialog.confirm', 'Send email')}
        cancelLabel={t('common.cancel', 'Cancel')}
        isConfirming={emailing}
      />
    </div>
  );
}
