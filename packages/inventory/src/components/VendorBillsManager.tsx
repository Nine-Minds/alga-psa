'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IVendorBill, IVendor, VendorBillStatus } from '@alga-psa/types';
import {
  listVendorBills,
  getVendorBill,
  createVendorBill,
  createBillFromPo,
  setVendorBillStatus,
  listVendors,
  listPurchaseOrders,
  type VendorBillView,
} from '../actions';

type BillRow = IVendorBill & { vendor_name: string | null; po_number: string | null };

const STATUS_BADGES: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'secondary' },
  open: { label: 'Open', variant: 'warning' },
  paid: { label: 'Paid', variant: 'success' },
  void: { label: 'Void', variant: 'error' },
};

const money = (cents: number, currency?: string): string =>
  `$${(Number(cents || 0) / 100).toFixed(2)}${currency ? ` ${currency}` : ''}`;

interface CreateForm {
  vendor_id: string;
  bill_number: string;
  po_id: string;
}

const emptyCreate = (): CreateForm => ({ vendor_id: '', bill_number: '', po_id: '' });

export function VendorBillsManager({ initialBills }: { initialBills: BillRow[] }) {
  const [bills, setBills] = useState<BillRow[]>(initialBills || []);
  const [statusFilter, setStatusFilter] = useState('');
  const [vendors, setVendors] = useState<IVendor[]>([]);
  const [pos, setPos] = useState<Array<{ po_id: string; po_number: string; vendor_id: string }>>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyCreate());
  const [detail, setDetail] = useState<VendorBillView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setBills(await listVendorBills());
    } catch (e: any) {
      toast.error(e?.message || "Couldn't load vendor bills.");
    }
  }, []);

  useEffect(() => {
    listVendors({ includeInactive: false }).then(setVendors).catch(() => setVendors([]));
    listPurchaseOrders()
      .then((rows: any[]) =>
        setPos(rows.map((r) => ({ po_id: r.po_id, po_number: r.po_number, vendor_id: r.vendor_id }))),
      )
      .catch(() => setPos([]));
  }, []);

  const create = async () => {
    if (!form.bill_number.trim()) {
      toast.error('Enter the vendor’s bill number.');
      return;
    }
    setBusy('create');
    try {
      if (form.po_id) {
        // Prefill from the PO's received quantities/costs (F078).
        await createBillFromPo(form.po_id, form.bill_number.trim());
      } else {
        if (!form.vendor_id) {
          toast.error('Pick a vendor (or a PO to prefill from).');
          return;
        }
        await createVendorBill({ vendor_id: form.vendor_id, bill_number: form.bill_number.trim() });
      }
      toast.success('Bill created (draft).');
      setCreateOpen(false);
      setForm(emptyCreate());
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't create the bill.");
    } finally {
      setBusy(null);
    }
  };

  const transition = async (bill: BillRow, status: VendorBillStatus) => {
    setBusy(`${status}:${bill.bill_id}`);
    try {
      await setVendorBillStatus(bill.bill_id, status);
      toast.success(status === 'paid' ? 'Bill marked paid.' : status === 'void' ? 'Bill voided.' : 'Bill opened.');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't update the bill.");
    } finally {
      setBusy(null);
    }
  };

  const openDetail = async (bill: BillRow) => {
    try {
      setDetail(await getVendorBill(bill.bill_id));
    } catch (e: any) {
      toast.error(e?.message || "Couldn't load the bill.");
    }
  };

  const columns: ColumnDefinition<BillRow>[] = [
    {
      title: 'Bill #',
      dataIndex: 'bill_number',
      render: (v: any, rec) => (
        <button
          id={`view-bill-${rec.bill_id}`}
          type="button"
          className="text-primary-600 hover:underline font-medium"
          onClick={() => openDetail(rec)}
        >
          {v}
        </button>
      ),
    },
    { title: 'Vendor', dataIndex: 'vendor_name', render: (v: any, rec) => v || rec.vendor_id },
    { title: 'PO', dataIndex: 'po_number', render: (v: any) => v || '—' },
    {
      title: 'Due',
      dataIndex: 'due_date',
      render: (v: any, rec) => {
        if (!v) return '—';
        const overdue = rec.status !== 'paid' && rec.status !== 'void' && new Date(v).getTime() < Date.now();
        return (
          <span className={overdue ? 'text-red-600 font-medium' : undefined}>
            {new Date(v).toLocaleDateString()}
          </span>
        );
      },
    },
    {
      title: 'Total',
      dataIndex: 'total_amount',
      render: (v: any, rec) => <span className="tabular-nums">{money(Number(v), rec.currency_code)}</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v: any) => {
        const meta = STATUS_BADGES[v] ?? { label: String(v), variant: 'secondary' as BadgeVariant };
        return (
          <Badge variant={meta.variant} size="sm">
            {meta.label}
          </Badge>
        );
      },
    },
    {
      title: 'Actions',
      dataIndex: 'bill_id',
      width: '220px',
      render: (_: any, rec) => (
        <div className="flex gap-2">
          {rec.status === 'draft' && (
            <Button
              id={`open-bill-${rec.bill_id}`}
              variant="soft"
              size="sm"
              disabled={busy !== null}
              onClick={() => transition(rec, 'open')}
            >
              Open
            </Button>
          )}
          {rec.status === 'open' && (
            <Button
              id={`pay-bill-${rec.bill_id}`}
              variant="soft"
              size="sm"
              disabled={busy !== null}
              onClick={() => transition(rec, 'paid')}
            >
              Mark paid
            </Button>
          )}
          {(rec.status === 'draft' || rec.status === 'open') && (
            <Button
              id={`void-bill-${rec.bill_id}`}
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => transition(rec, 'void')}
            >
              Void
            </Button>
          )}
        </div>
      ),
    },
  ];

  const filtered = statusFilter ? bills.filter((b) => b.status === statusFilter) : bills;

  return (
    <div className="p-6 space-y-4" id="vendor-bills-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Vendor Bills</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Light AP: track what vendors invoiced against what you received. No GL — mark paid manually.
          </p>
        </div>
        <Button id="vendor-bills-add-button" onClick={() => setCreateOpen(true)}>
          Add bill
        </Button>
      </div>

      <div className="w-52">
        <CustomSelect
          id="vendor-bills-status-filter"
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'draft', label: 'Draft' },
            { value: 'open', label: 'Open' },
            { value: 'paid', label: 'Paid' },
            { value: 'void', label: 'Void' },
          ]}
        />
      </div>

      <DataTable id="vendor-bills-table" data={filtered} columns={columns} />

      {/* ---- Create dialog ---- */}
      <Dialog isOpen={createOpen} onClose={() => setCreateOpen(false)} title="Add vendor bill" id="vendor-bill-create-dialog">
        <div className="space-y-4 p-1">
          <Input
            id="vendor-bill-number"
            label="Vendor's bill number"
            required
            value={form.bill_number}
            onChange={(e) => setForm({ ...form, bill_number: e.target.value })}
          />
          <CustomSelect
            id="vendor-bill-po"
            label="Prefill from purchase order (optional)"
            placeholder="No PO — blank bill"
            value={form.po_id}
            onValueChange={(value) => setForm({ ...form, po_id: value })}
            options={[{ value: '', label: 'No PO — blank bill' }, ...pos.map((p) => ({ value: p.po_id, label: p.po_number }))]}
          />
          {!form.po_id && (
            <CustomSelect
              id="vendor-bill-vendor"
              label="Vendor"
              placeholder="Select a vendor…"
              value={form.vendor_id}
              onValueChange={(value) => setForm({ ...form, vendor_id: value })}
              options={vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name }))}
            />
          )}
          <p className="text-xs text-gray-500">
            The due date defaults from the vendor's payment terms. Bills prefilled from a PO copy the received
            quantities and costs.
          </p>
          <div className="flex justify-end gap-2">
            <Button id="vendor-bill-create-cancel" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button id="vendor-bill-create-save" onClick={create} disabled={busy !== null}>
              {busy === 'create' ? 'Creating…' : 'Create bill'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ---- Detail dialog ---- */}
      <Dialog
        isOpen={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `Bill ${detail.bill_number} — ${detail.vendor_name || ''}` : 'Bill'}
        id="vendor-bill-detail-dialog"
        className="max-w-2xl"
      >
        {detail && (
          <div className="space-y-3 p-1">
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <Badge variant={(STATUS_BADGES[detail.status] ?? { variant: 'secondary' }).variant as BadgeVariant} size="sm">
                {(STATUS_BADGES[detail.status] ?? { label: detail.status }).label}
              </Badge>
              {detail.po_number && <span>PO {detail.po_number}</span>}
              {detail.due_date && <span>Due {new Date(detail.due_date).toLocaleDateString()}</span>}
              <span className="ml-auto tabular-nums font-medium">{money(detail.total_amount, detail.currency_code)}</span>
            </div>

            {/* 2-way match indicator (F080) — advisory, never blocking. */}
            {detail.variance_vs_received_cents != null && (
              <p
                className={
                  detail.variance_vs_received_cents === 0
                    ? 'text-sm text-green-700'
                    : 'text-sm text-amber-700 font-medium'
                }
                id="vendor-bill-variance"
              >
                {detail.variance_vs_received_cents === 0
                  ? 'Matches the PO’s received value.'
                  : `${detail.variance_vs_received_cents > 0 ? 'Billed above' : 'Billed below'} received value by ${money(
                      Math.abs(detail.variance_vs_received_cents),
                      detail.currency_code,
                    )}.`}
              </p>
            )}

            {detail.lines.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-1 pr-2 font-medium">Line</th>
                    <th className="py-1 px-2 font-medium text-right">Qty</th>
                    <th className="py-1 px-2 font-medium text-right">Unit cost</th>
                    <th className="py-1 px-2 font-medium text-right">Amount</th>
                    <th className="py-1 pl-2 font-medium text-right">vs PO</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l) => (
                    <tr key={l.bill_line_id} className="border-b last:border-0">
                      <td className="py-1 pr-2">{l.service_name || l.description || '—'}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{l.quantity}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{money(l.unit_cost)}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{money(l.amount)}</td>
                      <td className="py-1 pl-2 text-right">
                        {l.line_variance_cents == null ? (
                          <span className="text-gray-400">—</span>
                        ) : l.line_variance_cents === 0 ? (
                          <span className="text-xs text-gray-500">matches PO</span>
                        ) : (
                          <span
                            id={`bill-line-variance-${l.bill_line_id}`}
                            className={`text-xs tabular-nums ${
                              l.line_variance_cents > 0 ? 'text-red-600' : 'text-green-600'
                            }`}
                          >
                            {l.line_variance_cents > 0 ? '+' : ''}
                            {money(l.line_variance_cents)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="flex justify-end">
              <Button id="vendor-bill-detail-close" variant="outline" onClick={() => setDetail(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
