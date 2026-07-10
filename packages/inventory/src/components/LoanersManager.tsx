'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { usePageCreateShortcut, useDialogSubmitShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import { toMinorUnits } from '@alga-psa/core';
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

const isReturnedActionError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);

export function LoanersManager({
  initialLoaners,
  defaultCurrencyCode = 'USD',
}: {
  initialLoaners: LoanerOutRow[];
  defaultCurrencyCode?: string;
}) {
  const { t } = useTranslation('features/inventory');
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
      const result = await loanersOutReport();
      if (isReturnedActionError(result)) {
        setRows([]);
        toast.error(getErrorMessage(result));
        return;
      }
      setRows(result);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('loaners.loadFailed', 'Failed to load loaners'));
    }
  }, [t]);

  const loadLocations = useCallback(async () => {
    try {
      const result = await listStockLocations({ includeInactive: false });
      if (isReturnedActionError(result)) {
        setLocations([]);
        toast.error(getErrorMessage(result));
        return;
      }
      setLocations(result);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('loaners.loadLocationsFailed', "Couldn't load stock locations"));
    }
  }, [t]);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const openLoan = () => {
    setLoanForm({ unit_id: '', client_id: '', loan_due_at: '' });
    setLoanOpen(true);
  };
  usePageCreateShortcut(openLoan);

  const submitLoan = async () => {
    if (!loanForm.unit_id.trim()) {
      toast.error(t('loaners.unitIdRequired', 'Unit ID is required'));
      return;
    }
    if (!loanForm.client_id.trim()) {
      toast.error(t('loaners.clientIdRequired', 'Client ID is required'));
      return;
    }
    setSaving(true);
    try {
      const result = await loanOut(loanForm.unit_id.trim(), {
        client_id: loanForm.client_id.trim(),
        loan_due_at: loanForm.loan_due_at ? loanForm.loan_due_at : null,
      });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('loaners.loanedOut', 'Unit loaned out'));
      setLoanOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('loaners.loanFailed', 'Loan out failed'));
    } finally {
      setSaving(false);
    }
  };
  useDialogSubmitShortcut(
    () => { void submitLoan(); },
    { active: loanOpen, enabled: loanOpen && !saving },
  );

  const openReturn = (rec: LoanerOutRow) => {
    setReturnUnit(rec);
    setReturnLocationId(locations[0]?.location_id || '');
    setReturnOpen(true);
  };

  const submitReturn = async () => {
    if (!returnUnit) return;
    if (!returnLocationId) {
      toast.error(t('loaners.returnLocationRequired', 'Return location is required'));
      return;
    }
    setSaving(true);
    try {
      const result = await loanReturn(returnUnit.unit_id, { location_id: returnLocationId });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('loaners.returned', 'Loaner returned'));
      setReturnOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('loaners.returnFailed', 'Return failed'));
    } finally {
      setSaving(false);
    }
  };
  useDialogSubmitShortcut(
    () => { void submitReturn(); },
    { active: returnOpen, enabled: returnOpen && !saving },
  );

  const openRestock = () => {
    setRestockForm({ unit_id: '', location_id: locations[0]?.location_id || '', restocking_fee: '' });
    setRestockOpen(true);
  };

  const submitRestock = async () => {
    if (!restockForm.unit_id.trim()) {
      toast.error(t('loaners.restockUnitIdRequired', 'Unit ID is required to restock'));
      return;
    }
    const feeDollars = restockForm.restocking_fee.trim();
    let restocking_fee_cents: number | null = null;
    if (feeDollars) {
      const parsed = Number(feeDollars);
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast.error(t('loaners.restockFeeInvalid', 'Restocking fee must be a non-negative amount'));
        return;
      }
      restocking_fee_cents = toMinorUnits(parsed, undefined, defaultCurrencyCode);
    }
    setSaving(true);
    try {
      const result = await restockReturn({
        unit_id: restockForm.unit_id.trim(),
        location_id: restockForm.location_id || undefined,
        restocking_fee_cents,
      });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('loaners.restocked', 'Unit restocked to sellable'));
      setRestockOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('loaners.restockFailed', 'Restock failed'));
    } finally {
      setSaving(false);
    }
  };
  useDialogSubmitShortcut(
    () => { void submitRestock(); },
    { active: restockOpen, enabled: restockOpen && !saving },
  );

  const columns: ColumnDefinition<LoanerOutRow>[] = [
    {
      title: t('loaners.columns.unitSerial', 'Unit / Serial'),
      dataIndex: 'serial_number',
      render: (_: any, rec: LoanerOutRow) => (
        <span>
          {rec.serial_number}
          {rec.sku ? <span className="text-gray-500"> · {rec.sku}</span> : null}
        </span>
      ),
    },
    { title: t('loaners.columns.service', 'Service'), dataIndex: 'service_name', render: (v: any) => v || '' },
    {
      title: t('loaners.columns.client', 'Client'),
      dataIndex: 'client_name',
      render: (_: any, rec: LoanerOutRow) => rec.client_name || rec.client_id || '',
    },
    { title: t('loaners.columns.due', 'Due'), dataIndex: 'loan_due_at', render: (v: any) => formatDue(v) },
    {
      title: t('common.actions', 'Actions'),
      dataIndex: 'unit_id',
      render: (_: any, rec: LoanerOutRow) => (
        <Button id={`return-loaner-${rec.unit_id}`} variant="outline" size="sm" onClick={() => openReturn(rec)}>
          {t('loaners.return', 'Return')}
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="loaners-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('loaners.title', 'Loaners')}</h1>
        <div className="flex gap-2">
          <Button id="loaners-restock-button" variant="outline" onClick={openRestock}>
            {t('loaners.restockReturn', 'Restock return')}
          </Button>
          <Button id="loaners-add-button" onClick={openLoan}>
            {t('loaners.loanOut', 'Loan out')}
          </Button>
        </div>
      </div>

      <DataTable id="loaners-table" data={rows} columns={columns} />

      {/* Loan out */}
      <Dialog isOpen={loanOpen} onClose={() => setLoanOpen(false)} title={t('loaners.loanDialogTitle', 'Loan out unit')} id="loaner-loan-dialog">
        <div className="space-y-4 p-1">
          <Input
            id="loaner-loan-unit-id"
            label={t('loaners.fields.unitId', 'Unit ID')}
            required
            value={loanForm.unit_id}
            onChange={(e) => setLoanForm({ ...loanForm, unit_id: e.target.value })}
          />
          <Input
            id="loaner-loan-client-id"
            label={t('loaners.fields.clientId', 'Client ID')}
            required
            value={loanForm.client_id}
            onChange={(e) => setLoanForm({ ...loanForm, client_id: e.target.value })}
          />
          <Input
            id="loaner-loan-due-at"
            label={t('loaners.fields.dueDate', 'Due date')}
            type="date"
            value={loanForm.loan_due_at}
            onChange={(e) => setLoanForm({ ...loanForm, loan_due_at: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="loaner-loan-cancel" variant="outline" onClick={() => setLoanOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="loaner-loan-save" onClick={submitLoan} disabled={saving}>
              {saving ? t('common.saving', 'Saving…') : t('loaners.loanOut', 'Loan out')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Return */}
      <Dialog isOpen={returnOpen} onClose={() => setReturnOpen(false)} title={t('loaners.returnDialogTitle', 'Return loaner')} id="loaner-return-dialog">
        <div className="space-y-4 p-1">
          <p className="text-sm text-gray-600">
            {t('loaners.returningPrefix', 'Returning')}{' '}<span className="font-medium">{returnUnit?.serial_number}</span>
          </p>
          <CustomSelect
            id="loaner-return-location"
            label={t('loaners.fields.returnLocation', 'Return to location')}
            required
            value={returnLocationId}
            placeholder={t('loaners.fields.locationPlaceholder', 'Select a location…')}
            options={locations.map((loc) => ({ value: loc.location_id, label: loc.name }))}
            onValueChange={(v: string) => setReturnLocationId(v)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="loaner-return-cancel" variant="outline" onClick={() => setReturnOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="loaner-return-save" onClick={submitReturn} disabled={saving}>
              {saving ? t('common.saving', 'Saving…') : t('loaners.return', 'Return')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Restock return */}
      <Dialog
        isOpen={restockOpen}
        onClose={() => setRestockOpen(false)}
        title={t('loaners.restockDialogTitle', 'Restock return to sellable')}
        id="loaner-restock-dialog"
      >
        <div className="space-y-4 p-1">
          <Input
            id="loaner-restock-unit-id"
            label={t('loaners.fields.unitId', 'Unit ID')}
            required
            value={restockForm.unit_id}
            onChange={(e) => setRestockForm({ ...restockForm, unit_id: e.target.value })}
          />
          <CustomSelect
            id="loaner-restock-location"
            label={t('loaners.fields.restockLocation', 'Restock to location')}
            value={restockForm.location_id}
            options={[
              { value: '', label: t('loaners.fields.useCurrentLocation', "Use unit's current location") },
              ...locations.map((loc) => ({ value: loc.location_id, label: loc.name })),
            ]}
            onValueChange={(v: string) => setRestockForm({ ...restockForm, location_id: v })}
          />
          <CurrencyInput
            id="loaner-restock-fee"
            label={t('loaners.fields.restockingFee', 'Restocking fee (optional)')}
            currencyCode={defaultCurrencyCode}
            value={restockForm.restocking_fee ? Number(restockForm.restocking_fee) : undefined}
            onChange={(value) => setRestockForm({ ...restockForm, restocking_fee: value == null ? '' : String(value) })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="loaner-restock-cancel" variant="outline" onClick={() => setRestockOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="loaner-restock-save" onClick={submitRestock} disabled={saving}>
              {saving ? t('common.saving', 'Saving…') : t('loaners.restock', 'Restock')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
