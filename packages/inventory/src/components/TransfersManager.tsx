'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IStockTransfer, IStockLocation } from '@alga-psa/types';
import {
  listTransfers,
  dispatchTransfer,
  receiveTransfer,
  cancelTransfer,
  listStockLocations,
} from '../actions';

interface LineInput {
  service_id: string;
  quantity: number;
}

interface FormState {
  from_location_id: string;
  to_location_id: string;
  lines: LineInput[];
}

const emptyForm = (): FormState => ({
  from_location_id: '',
  to_location_id: '',
  lines: [{ service_id: '', quantity: 1 }],
});

function formatDate(value?: string | Date | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/** Humanize a snake_case enum for display. */
const humanize = (s?: string | null): string =>
  s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—';

const STATUS_VARIANT: Record<string, 'secondary' | 'info' | 'warning' | 'success' | 'error'> = {
  dispatched: 'warning',
  received: 'success',
  cancelled: 'error',
};

export function TransfersManager({
  initialTransfers,
  initialLocations,
}: {
  initialTransfers: IStockTransfer[];
  initialLocations: IStockLocation[];
}) {
  const [transfers, setTransfers] = useState<IStockTransfer[]>(initialTransfers || []);
  const [locations, setLocations] = useState<IStockLocation[]>(initialLocations || []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<IStockTransfer | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const locationName = useCallback(
    (id: string) => locations.find((l) => l.location_id === id)?.name || id,
    [locations],
  );

  const reload = useCallback(async () => {
    try {
      setTransfers(await listTransfers({}));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load transfers');
    }
  }, []);

  const openCreate = async () => {
    setForm(emptyForm());
    setDialogOpen(true);
    try {
      setLocations(await listStockLocations({ includeInactive: false }));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load locations');
    }
  };

  const setLine = (idx: number, patch: Partial<LineInput>) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  };

  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, { service_id: '', quantity: 1 }] }));

  const removeLine = (idx: number) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));

  const save = async () => {
    if (!form.from_location_id || !form.to_location_id) {
      toast.error('Source and destination locations are required');
      return;
    }
    if (form.from_location_id === form.to_location_id) {
      toast.error('Source and destination must differ');
      return;
    }
    const lines = form.lines
      .filter((l) => l.service_id.trim())
      .map((l) => ({ service_id: l.service_id.trim(), quantity: Number(l.quantity) }));
    if (lines.length === 0) {
      toast.error('At least one line with a service is required');
      return;
    }
    setSaving(true);
    try {
      await dispatchTransfer({
        from_location_id: form.from_location_id,
        to_location_id: form.to_location_id,
        lines,
      });
      toast.success('Transfer dispatched');
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Dispatch failed');
    } finally {
      setSaving(false);
    }
  };

  const receive = async (rec: IStockTransfer) => {
    try {
      await receiveTransfer(rec.transfer_id);
      toast.success('Transfer received');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Receive failed');
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelTransfer(cancelTarget.transfer_id);
      toast.success('Transfer cancelled');
      setCancelTarget(null);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  const columns: ColumnDefinition<IStockTransfer>[] = [
    { title: 'From', dataIndex: 'from_location_id', render: (v: any) => locationName(v) },
    { title: 'To', dataIndex: 'to_location_id', render: (v: any) => locationName(v) },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v: any) => (
        <Badge variant={STATUS_VARIANT[v] ?? 'secondary'} size="sm">
          {humanize(v)}
        </Badge>
      ),
    },
    { title: 'Dispatched', dataIndex: 'dispatched_at', render: (v: any) => formatDate(v) },
    { title: 'Received', dataIndex: 'received_at', render: (v: any) => formatDate(v) },
    {
      title: 'Actions',
      dataIndex: 'transfer_id',
      render: (_: any, rec: IStockTransfer) => (
        <div className="flex gap-2">
          {rec.status === 'dispatched' && (
            <Button
              id={`receive-transfer-${rec.transfer_id}`}
              variant="outline"
              size="sm"
              onClick={() => receive(rec)}
            >
              Receive
            </Button>
          )}
          {rec.status === 'dispatched' && (
            <Button
              id={`cancel-transfer-${rec.transfer_id}`}
              variant="ghost"
              size="sm"
              onClick={() => setCancelTarget(rec)}
            >
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="transfers-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Transfers</h1>
        <Button id="transfers-add-button" onClick={openCreate}>
          Dispatch Transfer
        </Button>
      </div>

      <DataTable id="transfers-table" data={transfers} columns={columns} />

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Dispatch Transfer"
        id="transfer-dialog"
      >
        <div className="space-y-4 p-1">
          <CustomSelect
            id="transfer-from-location"
            label="From location"
            required
            placeholder="Select a location…"
            value={form.from_location_id}
            onValueChange={(value) => setForm({ ...form, from_location_id: value })}
            options={locations.map((l) => ({ value: l.location_id, label: l.name }))}
          />
          <CustomSelect
            id="transfer-to-location"
            label="To location"
            required
            placeholder="Select a location…"
            value={form.to_location_id}
            onValueChange={(value) => setForm({ ...form, to_location_id: value })}
            options={locations.map((l) => ({ value: l.location_id, label: l.name }))}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium">Lines *</label>
              <Button id="transfer-add-line" variant="outline" size="sm" onClick={addLine}>
                Add Line
              </Button>
            </div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Service ID</label>
                  <Input
                    id={`transfer-line-service-${idx}`}
                    value={line.service_id}
                    onChange={(e) => setLine(idx, { service_id: e.target.value })}
                  />
                </div>
                <div className="w-28">
                  <label className="block text-xs text-gray-500 mb-1">Quantity</label>
                  <Input
                    id={`transfer-line-quantity-${idx}`}
                    type="number"
                    value={String(line.quantity)}
                    onChange={(e) => setLine(idx, { quantity: Number(e.target.value) })}
                  />
                </div>
                <Button
                  id={`transfer-line-remove-${idx}`}
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLine(idx)}
                  disabled={form.lines.length <= 1}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button id="transfer-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button id="transfer-save" onClick={save} disabled={saving}>
              {saving ? 'Dispatching…' : 'Dispatch'}
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmationDialog
        id="cancel-transfer-dialog"
        isOpen={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
        isConfirming={cancelling}
        title="Cancel transfer"
        message="Are you sure you want to cancel this transfer? This cannot be undone."
        confirmLabel="Cancel transfer"
        cancelLabel="Keep transfer"
      />
    </div>
  );
}
