'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { toast } from 'react-hot-toast';
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
    case 'partially_received':
    case 'open':
      return 'warning' as const;
    default:
      return 'secondary' as const;
  }
}

export function PurchaseOrdersManager({ initialPos }: { initialPos: IPurchaseOrder[] }) {
  const [pos, setPos] = useState<IPurchaseOrder[]>(initialPos || []);
  const [vendors, setVendors] = useState<IVendor[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<IPurchaseOrder | null>(null);

  // Receive flow state.
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receivePo, setReceivePo] = useState<IPurchaseOrder | null>(null);
  const [locations, setLocations] = useState<IStockLocation[]>([]);
  const [receiveForms, setReceiveForms] = useState<Record<string, ReceiveLineForm>>({});
  const [receiving, setReceiving] = useState(false);

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
        toast.error('Purchase order not found');
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
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load purchase order');
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
      toast.error('Location is required');
      return;
    }
    const quantity = Number(rf.quantity);
    if (!(quantity > 0)) {
      toast.error('Quantity must be greater than 0');
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
        toast(
          `Received ${quantity} — over-receipt: cumulative received now exceeds the quantity ordered`,
          { icon: '⚠️' },
        );
      } else {
        toast.success(`Received ${quantity} (PO status: ${result.po_status})`);
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
    } catch (e: any) {
      toast.error(e?.message || 'Receive failed');
    } finally {
      setReceiving(false);
    }
  };

  const columns: ColumnDefinition<IPurchaseOrder>[] = [
    { title: 'PO Number', dataIndex: 'po_number' },
    { title: 'Vendor', dataIndex: 'vendor_id', render: (v: any) => vendorName(v) },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v: any) => (
        <Badge variant={statusVariant(v)} size="sm">
          {humanize(v)}
        </Badge>
      ),
    },
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
            id={`receive-po-${rec.po_id}`}
            variant="outline"
            size="sm"
            disabled={!RECEIVABLE_STATUSES.has(rec.status)}
            onClick={() => openReceive(rec)}
          >
            Receive
          </Button>
          <Button
            id={`cancel-po-${rec.po_id}`}
            variant="ghost"
            size="sm"
            disabled={rec.status === 'cancelled' || rec.status === 'received'}
            onClick={() => setPendingCancel(rec)}
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
          <CustomSelect
            id="purchase-order-vendor"
            label="Vendor"
            required
            placeholder="Select a vendor…"
            value={form.vendor_id}
            onValueChange={(value) => setForm({ ...form, vendor_id: value })}
            options={vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name }))}
          />

          <Input
            id="purchase-order-currency"
            label="Currency code"
            required
            value={form.currency_code}
            onChange={(e) => setForm({ ...form, currency_code: e.target.value.toUpperCase() })}
          />

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

      <Dialog
        isOpen={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        title={receivePo ? `Receive ${receivePo.po_number}` : 'Receive Purchase Order'}
        id="receive-po-dialog"
      >
        <div className="space-y-4 p-1">
          {!receivePo ? (
            <p className="text-sm text-gray-500">Loading purchase order…</p>
          ) : (receivePo.lines ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">This purchase order has no lines.</p>
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
                    <span className="text-sm font-medium">{line.service_id}</span>
                    <span className="text-xs text-gray-500">
                      {Number(line.quantity_received)} / {Number(line.quantity_ordered)} received
                    </span>
                  </div>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-xs mb-1">Location</label>
                      <CustomSelect
                        id={`receive-line-location-${line.po_line_id}`}
                        placeholder="Select a location…"
                        value={rf?.location_id ?? ''}
                        onValueChange={(value) => updateReceiveLine(line.po_line_id, { location_id: value })}
                        options={locations.map((loc) => ({ value: loc.location_id, label: loc.name }))}
                      />
                    </div>
                    <div className="w-24">
                      <label className="block text-xs mb-1">Qty</label>
                      <Input
                        id={`receive-line-qty-${line.po_line_id}`}
                        type="number"
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
                      {receiving ? 'Receiving…' : 'Receive'}
                    </Button>
                  </div>
                  <div>
                    <label className="block text-xs mb-1">
                      Serial numbers (one per line — required for serialized products)
                    </label>
                    <textarea
                      id={`receive-line-serials-${line.po_line_id}`}
                      className="border rounded px-2 py-2 w-full text-sm"
                      rows={2}
                      value={rf?.serials ?? ''}
                      onChange={(e) => updateReceiveLine(line.po_line_id, { serials: e.target.value })}
                    />
                  </div>
                  {fullyReceived && (
                    <p className="text-xs text-gray-500">This line is fully received.</p>
                  )}
                </div>
              );
            })
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button id="receive-po-close" variant="outline" onClick={() => setReceiveOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmationDialog
        id="cancel-po-confirm"
        isOpen={!!pendingCancel}
        onClose={() => setPendingCancel(null)}
        title="Cancel purchase order"
        message={
          pendingCancel
            ? `Are you sure you want to cancel purchase order ${pendingCancel.po_number}? This cannot be undone.`
            : ''
        }
        confirmLabel="Cancel purchase order"
        cancelLabel="Keep purchase order"
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
