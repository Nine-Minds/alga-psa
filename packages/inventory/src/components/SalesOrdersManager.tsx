'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
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
import { ChevronDown } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toast } from 'react-hot-toast';
import type {
  ColumnDefinition,
  IClient,
  ISalesOrder,
  IStockLocation,
  SalesOrderInvoiceMode,
  SalesOrderAllocationMode,
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
  { type: 'sales-order', label: 'Order Confirmation', suffix: '' },
  { type: 'packing-slip', label: 'Packing Slip', suffix: '-packing-slip' },
  { type: 'pick-list', label: 'Pick List', suffix: '-pick-list' },
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
  unit_price: string; // dollars
}

interface FormState {
  client_id: string;
  currency_code: string;
  invoice_mode: SalesOrderInvoiceMode;
  allocation_mode: SalesOrderAllocationMode;
  lines: LineForm[];
}

const emptyLine = (): LineForm => ({ service_id: '', quantity_ordered: '1', unit_price: '0' });

const emptyForm = (): FormState => ({
  client_id: '',
  currency_code: 'USD',
  invoice_mode: 'on_fulfillment',
  allocation_mode: 'soft',
  lines: [emptyLine()],
});

export interface SalesOrdersManagerProps {
  initialSos: ISalesOrder[];
  /** Active stock locations for the fulfill dialog's source selector. */
  locations?: IStockLocation[];
  /** Clients for the create-SO client picker. */
  clients?: IClient[];
  /** Billing-owned actions passed from the page (billing → inventory dependency). */
  fulfillAndInvoice: FulfillAndInvoiceFn;
  generateInvoice: GenerateInvoiceFn;
  confirmDropShip: ConfirmDropShipFn;
}

export function SalesOrdersManager({
  initialSos,
  locations = [],
  clients = [],
  fulfillAndInvoice,
  generateInvoice,
  confirmDropShip,
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

  const setLine = (idx: number, patch: Partial<LineForm>) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  };

  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (idx: number) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));

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
        // Money is integer cents — convert dollars to cents.
        unit_price: Math.round(Number(l.unit_price) * 100),
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
                  {documentLabels[d.type] ?? d.label}
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
          <div className="space-y-1">
            <label className="block text-sm font-medium">{t('salesOrders.columns.client', 'Client')}</label>
            <ClientPicker
              id="sales-order-client"
              clients={clients}
              selectedClientId={form.client_id || null}
              onSelect={(clientId) => setForm({ ...form, client_id: clientId ?? '' })}
              filterState={clientFilterState}
              onFilterStateChange={setClientFilterState}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={setClientTypeFilter}
            />
          </div>
          <Input
            id="sales-order-currency-code"
            label={t('salesOrders.fields.currencyCode', 'Currency code')}
            required
            value={form.currency_code}
            onChange={(e) => setForm({ ...form, currency_code: e.target.value })}
          />
          <CustomSelect
            id="sales-order-invoice-mode"
            label={t('salesOrders.fields.invoiceMode', 'Invoice mode')}
            options={INVOICE_MODE_OPTIONS}
            value={form.invoice_mode}
            onValueChange={(value) =>
              setForm({ ...form, invoice_mode: value as SalesOrderInvoiceMode })
            }
          />
          <CustomSelect
            id="sales-order-allocation-mode"
            label={t('salesOrders.fields.allocationMode', 'Allocation mode')}
            options={ALLOCATION_MODE_OPTIONS}
            value={form.allocation_mode}
            onValueChange={(value) =>
              setForm({ ...form, allocation_mode: value as SalesOrderAllocationMode })
            }
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium">{t('salesOrders.fields.lines', 'Lines')}</label>
              <Button id="sales-order-add-line" variant="outline" size="sm" onClick={addLine}>
                {t('salesOrders.actions.addLine', 'Add Line')}
              </Button>
            </div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5">
                  <label className="block text-xs mb-1">{t('salesOrders.fields.serviceId', 'Service ID')}</label>
                  <Input
                    id={`sales-order-line-service-${idx}`}
                    value={line.service_id}
                    onChange={(e) => setLine(idx, { service_id: e.target.value })}
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs mb-1">{t('salesOrders.fields.qty', 'Qty')}</label>
                  <Input
                    id={`sales-order-line-qty-${idx}`}
                    type="number"
                    value={line.quantity_ordered}
                    onChange={(e) => setLine(idx, { quantity_ordered: e.target.value })}
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs mb-1">{t('salesOrders.fields.unitPrice', 'Unit Price ($)')}</label>
                  <Input
                    id={`sales-order-line-price-${idx}`}
                    type="number"
                    value={line.unit_price}
                    onChange={(e) => setLine(idx, { unit_price: e.target.value })}
                  />
                </div>
                <div className="col-span-1">
                  <Button
                    id={`sales-order-line-remove-${idx}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLine(idx)}
                    disabled={form.lines.length <= 1}
                  >
                    {t('common.remove', 'Remove')}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button id="sales-order-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="sales-order-save" onClick={save} disabled={saving}>
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
