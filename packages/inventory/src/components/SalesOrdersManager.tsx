'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
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
import { toast } from 'react-hot-toast';
import type {
  ColumnDefinition,
  ISalesOrder,
  SalesOrderInvoiceMode,
  SalesOrderAllocationMode,
} from '@alga-psa/types';
import {
  listSalesOrders,
  createSalesOrder,
  confirmSalesOrder,
  cancelSalesOrder,
} from '../actions';

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
): Promise<void> {
  try {
    const query = documentType === 'sales-order' ? '' : `?type=${documentType}`;
    const res = await fetch(`/api/inventory/sales-orders/${soId}/document${query}`);
    if (!res.ok) {
      let message = "Couldn't generate the document.";
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
    toast.error("Couldn't generate the document.");
  }
}

const INVOICE_MODE_OPTIONS: { value: SalesOrderInvoiceMode; label: string }[] = [
  { value: 'on_fulfillment', label: 'On fulfillment' },
  { value: 'manual', label: 'Manual' },
];
const ALLOCATION_MODE_OPTIONS: { value: SalesOrderAllocationMode; label: string }[] = [
  { value: 'soft', label: 'Soft' },
  { value: 'hard', label: 'Hard' },
];

const STATUS_BADGES: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'secondary' },
  confirmed: { label: 'Confirmed', variant: 'warning' },
  partially_fulfilled: { label: 'Partially fulfilled', variant: 'warning' },
  fulfilled: { label: 'Fulfilled', variant: 'success' },
  invoiced: { label: 'Invoiced', variant: 'success' },
  closed: { label: 'Closed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'error' },
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

export function SalesOrdersManager({ initialSos }: { initialSos: ISalesOrder[] }) {
  const [sos, setSos] = useState<ISalesOrder[]>(initialSos || []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ISalesOrder | null>(null);
  const [emailTarget, setEmailTarget] = useState<ISalesOrder | null>(null);
  const [emailing, setEmailing] = useState(false);

  const reload = useCallback(async () => {
    try {
      setSos(await listSalesOrders({}));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load sales orders');
    }
  }, []);

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
      toast.error('Client is required');
      return;
    }
    if (!form.currency_code.trim()) {
      toast.error('Currency code is required');
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
        toast.error('Each line quantity must be greater than 0');
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
      toast.success('Sales order created');
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const confirm = async (so: ISalesOrder) => {
    try {
      await confirmSalesOrder(so.so_id);
      toast.success('Sales order confirmed');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Confirm failed');
    }
  };

  const cancel = async (so: ISalesOrder) => {
    try {
      await cancelSalesOrder(so.so_id);
      toast.success('Sales order cancelled');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Cancel failed');
    } finally {
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
        toast.success(`Confirmation emailed to ${(body.recipients || []).join(', ')}`);
      } else {
        toast.error(body?.error || "Couldn't email the confirmation.");
      }
    } catch {
      toast.error("Couldn't email the confirmation.");
    } finally {
      setEmailing(false);
      setEmailTarget(null);
    }
  };

  const columns: ColumnDefinition<ISalesOrder>[] = [
    { title: 'SO Number', dataIndex: 'so_number' },
    {
      title: 'Client',
      dataIndex: 'client_name',
      render: (_: any, rec: ISalesOrder) => rec.client_name?.trim() || rec.client_id,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: any) => {
        const meta = STATUS_BADGES[value] ?? {
          label: String(value),
          variant: 'secondary' as BadgeVariant,
        };
        return (
          <Badge variant={meta.variant} size="sm">
            {meta.label}
          </Badge>
        );
      },
    },
    { title: 'Invoice Mode', dataIndex: 'invoice_mode' },
    { title: 'Currency', dataIndex: 'currency_code' },
    {
      title: 'Actions',
      dataIndex: 'so_id',
      width: '260px',
      render: (_: any, rec: ISalesOrder) => (
        <div className="flex gap-2">
          <Button
            id={`confirm-so-${rec.so_id}`}
            variant="soft"
            size="sm"
            onClick={() => confirm(rec)}
            disabled={rec.status !== 'draft'}
          >
            Confirm
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
                Document
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SO_DOCUMENT_TYPES.map((d) => (
                <DropdownMenuItem
                  key={d.type}
                  id={`document-so-${rec.so_id}-${d.type}`}
                  onClick={() => downloadSalesOrderDocument(rec.so_id, rec.so_number, d.type, d.suffix)}
                >
                  {d.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                id={`email-confirmation-so-${rec.so_id}`}
                onClick={() => setEmailTarget(rec)}
              >
                Email confirmation to client…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            id={`cancel-so-${rec.so_id}`}
            variant="ghost"
            size="sm"
            onClick={() => setCancelTarget(rec)}
            disabled={rec.status === 'cancelled'}
          >
            Cancel
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="sales-orders-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sales Orders</h1>
        <Button id="sales-orders-add-button" onClick={openCreate}>
          Add Sales Order
        </Button>
      </div>

      <DataTable id="sales-orders-table" data={sos} columns={columns} />

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Add Sales Order"
        id="sales-order-dialog"
      >
        <div className="space-y-4 p-1">
          <Input
            id="sales-order-client-id"
            label="Client ID"
            required
            value={form.client_id}
            onChange={(e) => setForm({ ...form, client_id: e.target.value })}
          />
          <Input
            id="sales-order-currency-code"
            label="Currency code"
            required
            value={form.currency_code}
            onChange={(e) => setForm({ ...form, currency_code: e.target.value })}
          />
          <CustomSelect
            id="sales-order-invoice-mode"
            label="Invoice mode"
            options={INVOICE_MODE_OPTIONS}
            value={form.invoice_mode}
            onValueChange={(value) =>
              setForm({ ...form, invoice_mode: value as SalesOrderInvoiceMode })
            }
          />
          <CustomSelect
            id="sales-order-allocation-mode"
            label="Allocation mode"
            options={ALLOCATION_MODE_OPTIONS}
            value={form.allocation_mode}
            onValueChange={(value) =>
              setForm({ ...form, allocation_mode: value as SalesOrderAllocationMode })
            }
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium">Lines</label>
              <Button id="sales-order-add-line" variant="outline" size="sm" onClick={addLine}>
                Add Line
              </Button>
            </div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5">
                  <label className="block text-xs mb-1">Service ID</label>
                  <Input
                    id={`sales-order-line-service-${idx}`}
                    value={line.service_id}
                    onChange={(e) => setLine(idx, { service_id: e.target.value })}
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs mb-1">Qty</label>
                  <Input
                    id={`sales-order-line-qty-${idx}`}
                    type="number"
                    value={line.quantity_ordered}
                    onChange={(e) => setLine(idx, { quantity_ordered: e.target.value })}
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs mb-1">Unit Price ($)</label>
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
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button id="sales-order-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button id="sales-order-save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmationDialog
        id="cancel-so-confirm"
        isOpen={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => (cancelTarget ? cancel(cancelTarget) : undefined)}
        title="Cancel sales order"
        message={
          cancelTarget
            ? `Cancel sales order ${cancelTarget.so_number}? This cannot be undone.`
            : ''
        }
        confirmLabel="Cancel sales order"
        cancelLabel="Keep order"
      />

      <ConfirmationDialog
        id="email-so-confirm"
        isOpen={emailTarget !== null}
        onClose={() => (emailing ? undefined : setEmailTarget(null))}
        onConfirm={() => (emailTarget ? emailConfirmation(emailTarget) : undefined)}
        title="Email order confirmation"
        message={
          emailTarget
            ? `Email the Order Confirmation for ${emailTarget.so_number} to the client's billing contact?`
            : ''
        }
        confirmLabel="Send email"
        cancelLabel="Cancel"
        isConfirming={emailing}
      />
    </div>
  );
}
