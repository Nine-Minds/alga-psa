'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IPurchaseOrder, IVendor } from '@alga-psa/types';
import {
  listPurchaseOrders,
  createPurchaseOrder,
  submitPurchaseOrder,
  cancelPurchaseOrder,
  listVendors,
} from '../actions';

interface LineForm {
  service_id: string;
  quantity_ordered: string;
  unit_cost: string; // dollars in the form; converted to integer cents on submit
}

interface FormState {
  vendor_id: string;
  currency_code: string;
  lines: LineForm[];
}

const emptyLine = (): LineForm => ({ service_id: '', quantity_ordered: '1', unit_cost: '0' });

const emptyForm = (): FormState => ({ vendor_id: '', currency_code: 'USD', lines: [emptyLine()] });

function formatDate(value?: string | Date | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}

export function PurchaseOrdersManager({ initialPos }: { initialPos: IPurchaseOrder[] }) {
  const [pos, setPos] = useState<IPurchaseOrder[]>(initialPos || []);
  const [vendors, setVendors] = useState<IVendor[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      setPos(await listPurchaseOrders({}));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load purchase orders');
    }
  }, []);

  const loadVendors = useCallback(async () => {
    try {
      setVendors(await listVendors({}));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load vendors');
    }
  }, []);

  useEffect(() => {
    void loadVendors();
  }, [loadVendors]);

  const vendorName = useCallback(
    (vendorId: string) => vendors.find((v) => v.vendor_id === vendorId)?.vendor_name || vendorId,
    [vendors],
  );

  const openCreate = () => {
    setForm(emptyForm());
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
      toast.error('Vendor is required');
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
        // Money is integer cents: convert the dollar input to cents.
        unit_cost: Math.round(Number(l.unit_cost) * 100),
      }));
    for (const l of lines) {
      if (!(l.quantity_ordered > 0)) {
        toast.error('Each line quantity must be greater than 0');
        return;
      }
    }
    setSaving(true);
    try {
      await createPurchaseOrder({
        vendor_id: form.vendor_id,
        currency_code: form.currency_code.trim(),
        lines,
      });
      toast.success('Purchase order created');
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const submit = async (po: IPurchaseOrder) => {
    try {
      await submitPurchaseOrder(po.po_id);
      toast.success('Purchase order submitted');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Submit failed');
    }
  };

  const cancel = async (po: IPurchaseOrder) => {
    try {
      await cancelPurchaseOrder(po.po_id);
      toast.success('Purchase order cancelled');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Cancel failed');
    }
  };

  const columns: ColumnDefinition<IPurchaseOrder>[] = [
    { title: 'PO Number', dataIndex: 'po_number' },
    { title: 'Vendor', dataIndex: 'vendor_id', render: (v: any) => vendorName(v) },
    { title: 'Status', dataIndex: 'status' },
    { title: 'Currency', dataIndex: 'currency_code' },
    { title: 'Created', dataIndex: 'created_at', render: (v: any) => formatDate(v) },
    {
      title: 'Actions',
      dataIndex: 'po_id',
      render: (_: any, rec: IPurchaseOrder) => (
        <div className="flex gap-2">
          <Button
            id={`submit-po-${rec.po_id}`}
            variant="outline"
            size="sm"
            disabled={rec.status !== 'draft'}
            onClick={() => submit(rec)}
          >
            Submit
          </Button>
          <Button
            id={`cancel-po-${rec.po_id}`}
            variant="ghost"
            size="sm"
            disabled={rec.status === 'cancelled' || rec.status === 'received'}
            onClick={() => cancel(rec)}
          >
            Cancel
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="purchase-orders-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Purchase Orders</h1>
        <Button id="purchase-orders-add-button" onClick={openCreate}>
          Add Purchase Order
        </Button>
      </div>

      <DataTable id="purchase-orders-table" data={pos} columns={columns} />

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Create Purchase Order"
        id="purchase-order-dialog"
      >
        <div className="space-y-4 p-1">
          <div>
            <label className="block text-sm font-medium mb-1">Vendor *</label>
            <select
              id="purchase-order-vendor"
              className="border rounded px-2 py-2 w-full"
              value={form.vendor_id}
              onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
            >
              <option value="">Select a vendor…</option>
              {vendors.map((v) => (
                <option key={v.vendor_id} value={v.vendor_id}>
                  {v.vendor_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Currency Code *</label>
            <Input
              id="purchase-order-currency"
              value={form.currency_code}
              onChange={(e) => setForm({ ...form, currency_code: e.target.value.toUpperCase() })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium">Lines</label>
              <Button id="purchase-order-add-line" variant="outline" size="sm" onClick={addLine}>
                Add Line
              </Button>
            </div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="flex gap-2 items-end" id={`purchase-order-line-${idx}`}>
                <div className="flex-1">
                  <label className="block text-xs mb-1">Service ID</label>
                  <Input
                    id={`purchase-order-line-service-${idx}`}
                    value={line.service_id}
                    onChange={(e) => updateLine(idx, { service_id: e.target.value })}
                  />
                </div>
                <div className="w-20">
                  <label className="block text-xs mb-1">Qty</label>
                  <Input
                    id={`purchase-order-line-qty-${idx}`}
                    type="number"
                    value={line.quantity_ordered}
                    onChange={(e) => updateLine(idx, { quantity_ordered: e.target.value })}
                  />
                </div>
                <div className="w-28">
                  <label className="block text-xs mb-1">Unit Cost ($)</label>
                  <Input
                    id={`purchase-order-line-cost-${idx}`}
                    type="number"
                    value={line.unit_cost}
                    onChange={(e) => updateLine(idx, { unit_cost: e.target.value })}
                  />
                </div>
                <Button
                  id={`purchase-order-line-remove-${idx}`}
                  variant="ghost"
                  size="sm"
                  disabled={form.lines.length <= 1}
                  onClick={() => removeLine(idx)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button id="purchase-order-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button id="purchase-order-save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Create'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
