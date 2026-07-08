'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
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
import { ChevronDown, Trash2 } from 'lucide-react';
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

interface LineForm {
  service_id: string;
  quantity_ordered: string;
  unit_price: string; // major units (e.g. dollars), converted to minor units on save
  fulfillment_type: SalesOrderLineFulfillmentType;
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
}

const emptyLine = (): LineForm => ({
  service_id: '',
  quantity_ordered: '1',
  unit_price: '',
  fulfillment_type: 'from_stock',
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
  defaultCurrencyCode?: string;
}

export function SalesOrdersManager({
  initialSos,
  locations = [],
  clients = [],
  services = [],
  fulfillAndInvoice,
  generateInvoice,
  confirmDropShip,
  defaultCurrencyCode = 'USD',
}: SalesOrdersManagerProps) {
  const router = useRouter();
  const { t } = useTranslation('features/inventory');
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
  // client and render it read-only (falling back to the tenant default when the client has none).
  const onClientSelect = (clientId: string | null) => {
    const picked = clientId ? clients.find((c) => c.client_id === clientId) : undefined;
    setForm((f) => ({
      ...f,
      client_id: clientId ?? '',
      currency_code: picked?.default_currency_code || (clientId ? defaultCurrencyCode : ''),
    }));
  };

  const setLine = (idx: number, patch: Partial<LineForm>) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  };

  // Picking a service both binds a real service_id (a picker can't yield a non-existent one) and
  // seeds the editable unit price from its catalog default_rate (stored in minor units).
  const onServicePicked = (idx: number, serviceId: string) => {
    const svc = serviceById.get(serviceId);
    const currency = form.currency_code || defaultCurrencyCode;
    const seededPrice =
      svc?.default_rate != null
        ? String(svc.default_rate / Math.pow(10, currencyFractionDigits(currency)))
        : undefined;
    setLine(idx, { service_id: serviceId, ...(seededPrice !== undefined ? { unit_price: seededPrice } : {}) });
  };

  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (idx: number) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));

  const currency = form.currency_code || defaultCurrencyCode;
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
  const lineIsValid = (l: LineForm) => Boolean(l.service_id) && Number(l.quantity_ordered) > 0;
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
      .map((l) => ({
        service_id: l.service_id.trim(),
        quantity_ordered: Number(l.quantity_ordered),
        // Convert the major-unit price to the currency's integer minor units (JPY ×1, USD ×100).
        unit_price: toMinorUnits(Number(l.unit_price || 0), undefined, form.currency_code),
        fulfillment_type: l.fulfillment_type,
      }));
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
      width: '260px',
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
                {t('salesOrders.actions.document', 'Document')}
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
          <Button
            id={`cancel-so-${rec.so_id}`}
            variant="ghost"
            size="sm"
            onClick={() => setCancelTarget(rec)}
            disabled={rec.status === 'cancelled' || busy !== null}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
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

      <DataTable id="sales-orders-table" data={sos} columns={columns} />

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
              <div className="w-32 text-right">
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
                    <div className="w-32">
                      <CurrencyInput
                        id={`sales-order-line-price-${idx}`}
                        currencyCode={currency}
                        className="text-right tabular-nums"
                        value={line.unit_price ? Number(line.unit_price) : undefined}
                        onChange={(value) => setLine(idx, { unit_price: value == null ? '' : String(value) })}
                      />
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
