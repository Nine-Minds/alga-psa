'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog } from '@alga-psa/ui/components/Dialog';
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

const INVOICE_MODES: SalesOrderInvoiceMode[] = ['on_fulfillment', 'manual'];
const ALLOCATION_MODES: SalesOrderAllocationMode[] = ['soft', 'hard'];

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
    }
  };

  const columns: ColumnDefinition<ISalesOrder>[] = [
    { title: 'SO Number', dataIndex: 'so_number' },
    { title: 'Client', dataIndex: 'client_id' },
    { title: 'Status', dataIndex: 'status' },
    { title: 'Invoice Mode', dataIndex: 'invoice_mode' },
    { title: 'Currency', dataIndex: 'currency_code' },
    {
      title: 'Actions',
      dataIndex: 'so_id',
      render: (_: any, rec: ISalesOrder) => (
        <div className="flex gap-2">
          <Button
            id={`confirm-so-${rec.so_id}`}
            variant="outline"
            size="sm"
            onClick={() => confirm(rec)}
            disabled={rec.status !== 'draft'}
          >
            Confirm
          </Button>
          <Button
            id={`cancel-so-${rec.so_id}`}
            variant="ghost"
            size="sm"
            onClick={() => cancel(rec)}
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
          <div>
            <label className="block text-sm font-medium mb-1">Client ID *</label>
            <Input
              id="sales-order-client-id"
              value={form.client_id}
              onChange={(e) => setForm({ ...form, client_id: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Currency Code *</label>
            <Input
              id="sales-order-currency-code"
              value={form.currency_code}
              onChange={(e) => setForm({ ...form, currency_code: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Invoice Mode</label>
            <select
              id="sales-order-invoice-mode"
              className="border rounded px-2 py-2 w-full"
              value={form.invoice_mode}
              onChange={(e) =>
                setForm({ ...form, invoice_mode: e.target.value as SalesOrderInvoiceMode })
              }
            >
              {INVOICE_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Allocation Mode</label>
            <select
              id="sales-order-allocation-mode"
              className="border rounded px-2 py-2 w-full"
              value={form.allocation_mode}
              onChange={(e) =>
                setForm({ ...form, allocation_mode: e.target.value as SalesOrderAllocationMode })
              }
            >
              {ALLOCATION_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

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
                    ×
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
    </div>
  );
}
