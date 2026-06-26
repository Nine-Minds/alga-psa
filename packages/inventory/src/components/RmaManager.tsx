'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IRmaCase, IStockLocation, IVendor, RmaType } from '@alga-psa/types';
import {
  listRmaCases,
  openRma,
  openAdvanceRma,
  receiveReturn,
  sendToVendor,
  deadUnitsOwedReport,
  listStockLocations,
  listVendors,
  type DeadUnitOwedRow,
} from '../actions';

const RMA_TYPE_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'advance_replacement', label: 'Advance replacement' },
];

/** Humanize a snake_case enum for display. */
const humanize = (s?: string | null): string =>
  s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—';

const STATUS_VARIANT: Record<string, 'secondary' | 'info' | 'warning' | 'success' | 'error'> = {
  dead_unit_owed: 'warning',
  closed: 'success',
  replaced: 'success',
  credited: 'success',
  dead_unit_returned: 'success',
  charged: 'error',
};

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
  const [locations, setLocations] = useState<IStockLocation[]>([]);
  const [vendors, setVendors] = useState<IVendor[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<OpenFormState>({ rma_type: 'standard', returned_unit_id: '', reason: '' });
  const [saving, setSaving] = useState(false);

  const [receiveCase, setReceiveCase] = useState<IRmaCase | null>(null);
  const [receiveLocation, setReceiveLocation] = useState('');
  const [vendorCase, setVendorCase] = useState<IRmaCase | null>(null);
  const [vendorId, setVendorId] = useState('');
  const [vendorRef, setVendorRef] = useState('');
  const [actioning, setActioning] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [list, owed] = await Promise.all([listRmaCases({}), deadUnitsOwedReport()]);
      setCases(list);
      setDeadOwed(owed);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Couldn't load RMA cases.");
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [locs, vens] = await Promise.all([
          listStockLocations({ includeInactive: false }),
          listVendors({ includeInactive: false }),
        ]);
        setLocations(locs);
        setVendors(vens);
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || "Couldn't load locations and vendors.");
      }
    })();
  }, []);

  const openCreate = () => {
    setForm({ rma_type: 'standard', returned_unit_id: '', reason: '' });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.returned_unit_id.trim()) {
      toast.error('Returned unit ID is required.');
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
      toast.success('RMA case opened.');
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't open RMA.");
    } finally {
      setSaving(false);
    }
  };

  const saveReceiveReturn = async () => {
    if (!receiveCase || !receiveLocation) {
      toast.error('Pick a location.');
      return;
    }
    setActioning(true);
    try {
      await receiveReturn(receiveCase.rma_id, { location_id: receiveLocation });
      toast.success('Return received.');
      setReceiveCase(null);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't receive the return.");
    } finally {
      setActioning(false);
    }
  };

  const saveSendToVendor = async () => {
    if (!vendorCase || !vendorId) {
      toast.error('Pick a vendor.');
      return;
    }
    setActioning(true);
    try {
      await sendToVendor(vendorCase.rma_id, { vendor_id: vendorId, rma_reference: vendorRef.trim() || null });
      toast.success('Sent to vendor.');
      setVendorCase(null);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't send to vendor.");
    } finally {
      setActioning(false);
    }
  };

  const openReceiveReturn = (rma: IRmaCase) => {
    setReceiveCase(rma);
    setReceiveLocation(locations.find((l) => l.is_default)?.location_id ?? '');
  };
  const openSendToVendor = (rma: IRmaCase) => {
    setVendorCase(rma);
    setVendorId('');
    setVendorRef('');
  };

  const caseColumns: ColumnDefinition<IRmaCase>[] = [
    { title: 'Type', dataIndex: 'rma_type', render: (v: any) => humanize(v) },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v: any) => <Badge variant={STATUS_VARIANT[v] ?? 'secondary'} size="sm">{humanize(v)}</Badge>,
    },
    { title: 'Returned unit', dataIndex: 'returned_unit_id', render: (v: any) => v || '—' },
    { title: 'Client', dataIndex: 'client_id', render: (v: any) => v || '—' },
    { title: 'Reason', dataIndex: 'reason', render: (v: any) => v || '—' },
    {
      title: 'Actions',
      dataIndex: 'rma_id',
      width: '230px',
      render: (_: any, rec: IRmaCase) => (
        <div className="flex gap-2">
          <Button
            id={`receive-return-${rec.rma_id}`}
            variant="outline"
            size="sm"
            disabled={rec.status !== 'awaiting_return'}
            onClick={() => openReceiveReturn(rec)}
          >
            Receive return
          </Button>
          <Button
            id={`send-to-vendor-${rec.rma_id}`}
            variant="ghost"
            size="sm"
            disabled={rec.status !== 'returned'}
            onClick={() => openSendToVendor(rec)}
          >
            Send to vendor
          </Button>
        </div>
      ),
    },
  ];

  const deadColumns: ColumnDefinition<DeadUnitOwedRow>[] = [
    { title: 'Returned unit', dataIndex: 'returned_unit_id', render: (v: any) => v || '—' },
    { title: 'Client', dataIndex: 'client_id', render: (v: any) => v || '—' },
    { title: 'Vendor', dataIndex: 'vendor_id', render: (v: any) => v || '—' },
    {
      title: 'Due date',
      dataIndex: 'dead_unit_due_date',
      render: (v: any) => (v ? new Date(v).toLocaleDateString() : '—'),
    },
    {
      title: 'Days remaining',
      dataIndex: 'days_remaining',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
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
        <h2 className="text-lg font-semibold">Dead units owed</h2>
        <DataTable id="rma-dead-owed-table" data={deadOwed} columns={deadColumns} />
      </div>

      <Dialog isOpen={dialogOpen} onClose={() => setDialogOpen(false)} title="Open RMA" id="rma-open-dialog">
        <div className="space-y-4 p-1">
          <CustomSelect
            id="rma-type"
            label="RMA type"
            value={form.rma_type}
            options={RMA_TYPE_OPTIONS}
            onValueChange={(v: string) => setForm({ ...form, rma_type: v as RmaType })}
          />
          <Input
            id="rma-returned-unit-id"
            label="Returned unit ID"
            required
            value={form.returned_unit_id}
            onChange={(e) => setForm({ ...form, returned_unit_id: e.target.value })}
          />
          <Input
            id="rma-reason"
            label="Reason"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
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

      <Dialog
        isOpen={receiveCase !== null}
        onClose={() => setReceiveCase(null)}
        title="Receive return"
        id="rma-receive-dialog"
      >
        <div className="space-y-4 p-1">
          <CustomSelect
            id="rma-receive-location"
            label="Location"
            required
            value={receiveLocation}
            placeholder="Select a location…"
            options={locations.map((l) => ({ value: l.location_id, label: l.name }))}
            onValueChange={(v: string) => setReceiveLocation(v)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="rma-receive-cancel" variant="outline" onClick={() => setReceiveCase(null)}>
              Cancel
            </Button>
            <Button id="rma-receive-save" onClick={saveReceiveReturn} disabled={actioning}>
              {actioning ? 'Receiving…' : 'Receive return'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={vendorCase !== null}
        onClose={() => setVendorCase(null)}
        title="Send to vendor"
        id="rma-vendor-dialog"
      >
        <div className="space-y-4 p-1">
          <CustomSelect
            id="rma-vendor"
            label="Vendor"
            required
            value={vendorId}
            placeholder="Select a vendor…"
            options={vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name }))}
            onValueChange={(v: string) => setVendorId(v)}
          />
          <Input
            id="rma-vendor-ref"
            label="Vendor RMA reference"
            value={vendorRef}
            onChange={(e) => setVendorRef(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="rma-vendor-cancel" variant="outline" onClick={() => setVendorCase(null)}>
              Cancel
            </Button>
            <Button id="rma-vendor-save" onClick={saveSendToVendor} disabled={actioning}>
              {actioning ? 'Sending…' : 'Send to vendor'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
