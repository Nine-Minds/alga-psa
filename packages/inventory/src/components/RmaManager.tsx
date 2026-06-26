'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IRmaCase, RmaType } from '@alga-psa/types';
import {
  listRmaCases,
  openRma,
  openAdvanceRma,
  receiveReturn,
  sendToVendor,
  deadUnitsOwedReport,
  type DeadUnitOwedRow,
} from '../actions';

const RMA_TYPES: RmaType[] = ['standard', 'advance_replacement'];

interface OpenFormState {
  rma_type: RmaType;
  returned_unit_id: string;
  reason: string;
}

export function RmaManager({
  initialCases,
  initialDeadOwed,
}: {
  initialCases: IRmaCase[];
  initialDeadOwed: DeadUnitOwedRow[];
}) {
  const [cases, setCases] = useState<IRmaCase[]>(initialCases || []);
  const [deadOwed, setDeadOwed] = useState<DeadUnitOwedRow[]>(initialDeadOwed || []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<OpenFormState>({ rma_type: 'standard', returned_unit_id: '', reason: '' });
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [list, owed] = await Promise.all([listRmaCases({}), deadUnitsOwedReport()]);
      setCases(list);
      setDeadOwed(owed);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load RMA cases');
    }
  }, []);

  const openCreate = () => {
    setForm({ rma_type: 'standard', returned_unit_id: '', reason: '' });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.returned_unit_id.trim()) {
      toast.error('Returned unit ID is required');
      return;
    }
    setSaving(true);
    try {
      const payload = { returned_unit_id: form.returned_unit_id.trim(), reason: form.reason.trim() || null };
      if (form.rma_type === 'advance_replacement') {
        await openAdvanceRma(payload);
      } else {
        await openRma(payload);
      }
      toast.success('RMA case opened');
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to open RMA');
    } finally {
      setSaving(false);
    }
  };

  const doReceiveReturn = async (rma: IRmaCase) => {
    const location_id = window.prompt('Receive defective unit at location ID:')?.trim();
    if (!location_id) return;
    try {
      await receiveReturn(rma.rma_id, { location_id });
      toast.success('Return received');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Receive return failed');
    }
  };

  const doSendToVendor = async (rma: IRmaCase) => {
    const vendor_id = window.prompt('Vendor ID to send the unit to:')?.trim();
    if (!vendor_id) return;
    const rma_reference = window.prompt('Vendor RMA reference (optional):')?.trim() || null;
    try {
      await sendToVendor(rma.rma_id, { vendor_id, rma_reference });
      toast.success('Sent to vendor');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Send to vendor failed');
    }
  };

  const caseColumns: ColumnDefinition<IRmaCase>[] = [
    { title: 'Type', dataIndex: 'rma_type' },
    { title: 'Status', dataIndex: 'status' },
    { title: 'Returned Unit', dataIndex: 'returned_unit_id', render: (v: any) => v || '—' },
    { title: 'Client', dataIndex: 'client_id', render: (v: any) => v || '—' },
    { title: 'Reason', dataIndex: 'reason', render: (v: any) => v || '—' },
    {
      title: 'Actions',
      dataIndex: 'rma_id',
      render: (_: any, rec: IRmaCase) => (
        <div className="flex gap-2">
          <Button
            id={`receive-return-${rec.rma_id}`}
            variant="outline"
            size="sm"
            disabled={rec.status !== 'awaiting_return'}
            onClick={() => doReceiveReturn(rec)}
          >
            Receive Return
          </Button>
          <Button
            id={`send-to-vendor-${rec.rma_id}`}
            variant="ghost"
            size="sm"
            disabled={rec.status !== 'returned'}
            onClick={() => doSendToVendor(rec)}
          >
            Send to Vendor
          </Button>
        </div>
      ),
    },
  ];

  const deadColumns: ColumnDefinition<DeadUnitOwedRow>[] = [
    { title: 'Returned Unit', dataIndex: 'returned_unit_id', render: (v: any) => v || '—' },
    { title: 'Client', dataIndex: 'client_id', render: (v: any) => v || '—' },
    { title: 'Vendor', dataIndex: 'vendor_id', render: (v: any) => v || '—' },
    {
      title: 'Due Date',
      dataIndex: 'dead_unit_due_date',
      render: (v: any) => (v ? new Date(v).toLocaleDateString() : '—'),
    },
    {
      title: 'Days Remaining',
      dataIndex: 'days_remaining',
      render: (v: any) => (v === null || v === undefined ? '—' : v),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="rma-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">RMA</h1>
        <Button id="rma-add-button" onClick={openCreate}>
          Open RMA
        </Button>
      </div>

      <DataTable id="rma-cases-table" data={cases} columns={caseColumns} />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Dead Units Owed</h2>
        <DataTable id="rma-dead-owed-table" data={deadOwed} columns={deadColumns} />
      </div>

      <Dialog isOpen={dialogOpen} onClose={() => setDialogOpen(false)} title="Open RMA" id="rma-open-dialog">
        <div className="space-y-4 p-1">
          <div>
            <label className="block text-sm font-medium mb-1">RMA Type</label>
            <select
              id="rma-type"
              className="border rounded px-2 py-2 w-full"
              value={form.rma_type}
              onChange={(e) => setForm({ ...form, rma_type: e.target.value as RmaType })}
            >
              {RMA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Returned Unit ID *</label>
            <Input
              id="rma-returned-unit-id"
              value={form.returned_unit_id}
              onChange={(e) => setForm({ ...form, returned_unit_id: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reason</label>
            <Input
              id="rma-reason"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button id="rma-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button id="rma-save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Open RMA'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
