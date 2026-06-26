'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IStockLocation } from '@alga-psa/types';
import {
  loanOut,
  loanReturn,
  loanersOutReport,
  restockReturn,
  listStockLocations,
  type LoanerOutRow,
} from '../actions';

function formatDue(value: string | Date | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}

export function LoanersManager({ initialLoaners }: { initialLoaners: LoanerOutRow[] }) {
  const [rows, setRows] = useState<LoanerOutRow[]>(initialLoaners || []);
  const [locations, setLocations] = useState<IStockLocation[]>([]);

  // Loan out dialog
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanForm, setLoanForm] = useState<{ unit_id: string; client_id: string; loan_due_at: string }>({
    unit_id: '',
    client_id: '',
    loan_due_at: '',
  });

  // Return dialog
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnUnit, setReturnUnit] = useState<LoanerOutRow | null>(null);
  const [returnLocationId, setReturnLocationId] = useState('');

  // Restock return dialog
  const [restockOpen, setRestockOpen] = useState(false);
  const [restockForm, setRestockForm] = useState<{
    unit_id: string;
    location_id: string;
    restocking_fee: string;
  }>({ unit_id: '', location_id: '', restocking_fee: '' });

  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      setRows(await loanersOutReport());
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to load loaners');
    }
  }, []);

  const loadLocations = useCallback(async () => {
    try {
      setLocations(await listStockLocations({ includeInactive: false }));
    } catch (e: any) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const openLoan = () => {
    setLoanForm({ unit_id: '', client_id: '', loan_due_at: '' });
    setLoanOpen(true);
  };

  const submitLoan = async () => {
    if (!loanForm.unit_id.trim()) {
      toast.error('Unit ID is required');
      return;
    }
    if (!loanForm.client_id.trim()) {
      toast.error('Client ID is required');
      return;
    }
    setSaving(true);
    try {
      await loanOut(loanForm.unit_id.trim(), {
        client_id: loanForm.client_id.trim(),
        loan_due_at: loanForm.loan_due_at ? loanForm.loan_due_at : null,
      });
      toast.success('Unit loaned out');
      setLoanOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Loan out failed');
    } finally {
      setSaving(false);
    }
  };

  const openReturn = (rec: LoanerOutRow) => {
    setReturnUnit(rec);
    setReturnLocationId(locations[0]?.location_id || '');
    setReturnOpen(true);
  };

  const submitReturn = async () => {
    if (!returnUnit) return;
    if (!returnLocationId) {
      toast.error('Return location is required');
      return;
    }
    setSaving(true);
    try {
      await loanReturn(returnUnit.unit_id, { location_id: returnLocationId });
      toast.success('Loaner returned');
      setReturnOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Return failed');
    } finally {
      setSaving(false);
    }
  };

  const openRestock = () => {
    setRestockForm({ unit_id: '', location_id: locations[0]?.location_id || '', restocking_fee: '' });
    setRestockOpen(true);
  };

  const submitRestock = async () => {
    if (!restockForm.unit_id.trim()) {
      toast.error('Unit ID is required to restock');
      return;
    }
    const feeDollars = restockForm.restocking_fee.trim();
    let restocking_fee_cents: number | null = null;
    if (feeDollars) {
      const parsed = Number(feeDollars);
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast.error('Restocking fee must be a non-negative amount');
        return;
      }
      restocking_fee_cents = Math.round(parsed * 100);
    }
    setSaving(true);
    try {
      await restockReturn({
        unit_id: restockForm.unit_id.trim(),
        location_id: restockForm.location_id || undefined,
        restocking_fee_cents,
      });
      toast.success('Unit restocked to sellable');
      setRestockOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Restock failed');
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnDefinition<LoanerOutRow>[] = [
    {
      title: 'Unit / Serial',
      dataIndex: 'serial_number',
      render: (_: any, rec: LoanerOutRow) => (
        <span>
          {rec.serial_number}
          {rec.sku ? <span className="text-gray-500"> · {rec.sku}</span> : null}
        </span>
      ),
    },
    { title: 'Service', dataIndex: 'service_name', render: (v: any) => v || '' },
    {
      title: 'Client',
      dataIndex: 'client_name',
      render: (_: any, rec: LoanerOutRow) => rec.client_name || rec.client_id || '',
    },
    { title: 'Due', dataIndex: 'loan_due_at', render: (v: any) => formatDue(v) },
    {
      title: 'Actions',
      dataIndex: 'unit_id',
      render: (_: any, rec: LoanerOutRow) => (
        <Button id={`return-loaner-${rec.unit_id}`} variant="outline" size="sm" onClick={() => openReturn(rec)}>
          Return
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="loaners-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Loaners</h1>
        <div className="flex gap-2">
          <Button id="loaners-restock-button" variant="outline" onClick={openRestock}>
            Restock return
          </Button>
          <Button id="loaners-add-button" onClick={openLoan}>
            Loan out
          </Button>
        </div>
      </div>

      <DataTable id="loaners-table" data={rows} columns={columns} />

      {/* Loan out */}
      <Dialog isOpen={loanOpen} onClose={() => setLoanOpen(false)} title="Loan out unit" id="loaner-loan-dialog">
        <div className="space-y-4 p-1">
          <div>
            <label className="block text-sm font-medium mb-1">Unit ID *</label>
            <Input
              id="loaner-loan-unit-id"
              value={loanForm.unit_id}
              onChange={(e) => setLoanForm({ ...loanForm, unit_id: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Client ID *</label>
            <Input
              id="loaner-loan-client-id"
              value={loanForm.client_id}
              onChange={(e) => setLoanForm({ ...loanForm, client_id: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Due date</label>
            <Input
              id="loaner-loan-due-at"
              type="date"
              value={loanForm.loan_due_at}
              onChange={(e) => setLoanForm({ ...loanForm, loan_due_at: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button id="loaner-loan-cancel" variant="outline" onClick={() => setLoanOpen(false)}>
              Cancel
            </Button>
            <Button id="loaner-loan-save" onClick={submitLoan} disabled={saving}>
              {saving ? 'Saving…' : 'Loan out'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Return */}
      <Dialog isOpen={returnOpen} onClose={() => setReturnOpen(false)} title="Return loaner" id="loaner-return-dialog">
        <div className="space-y-4 p-1">
          <p className="text-sm text-gray-600">
            Returning <span className="font-medium">{returnUnit?.serial_number}</span>
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Return to location *</label>
            <select
              id="loaner-return-location"
              className="border rounded px-2 py-2 w-full"
              value={returnLocationId}
              onChange={(e) => setReturnLocationId(e.target.value)}
            >
              <option value="">Select a location…</option>
              {locations.map((loc) => (
                <option key={loc.location_id} value={loc.location_id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button id="loaner-return-cancel" variant="outline" onClick={() => setReturnOpen(false)}>
              Cancel
            </Button>
            <Button id="loaner-return-save" onClick={submitReturn} disabled={saving}>
              {saving ? 'Saving…' : 'Return'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Restock return */}
      <Dialog
        isOpen={restockOpen}
        onClose={() => setRestockOpen(false)}
        title="Restock return to sellable"
        id="loaner-restock-dialog"
      >
        <div className="space-y-4 p-1">
          <div>
            <label className="block text-sm font-medium mb-1">Unit ID *</label>
            <Input
              id="loaner-restock-unit-id"
              value={restockForm.unit_id}
              onChange={(e) => setRestockForm({ ...restockForm, unit_id: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Restock to location</label>
            <select
              id="loaner-restock-location"
              className="border rounded px-2 py-2 w-full"
              value={restockForm.location_id}
              onChange={(e) => setRestockForm({ ...restockForm, location_id: e.target.value })}
            >
              <option value="">Use unit's current location</option>
              {locations.map((loc) => (
                <option key={loc.location_id} value={loc.location_id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Restocking fee (optional)</label>
            <Input
              id="loaner-restock-fee"
              type="number"
              min="0"
              step="0.01"
              value={restockForm.restocking_fee}
              onChange={(e) => setRestockForm({ ...restockForm, restocking_fee: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button id="loaner-restock-cancel" variant="outline" onClick={() => setRestockOpen(false)}>
              Cancel
            </Button>
            <Button id="loaner-restock-save" onClick={submitRestock} disabled={saving}>
              {saving ? 'Saving…' : 'Restock'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
