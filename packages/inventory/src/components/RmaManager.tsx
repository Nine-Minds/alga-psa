'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
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
  const { t } = useTranslation('features/inventory');
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

  const RMA_TYPE_OPTIONS = [
    { value: 'standard', label: t('rma.types.standard', 'Standard') },
    { value: 'advance_replacement', label: t('rma.types.advanceReplacement', 'Advance replacement') },
  ];

  /** Humanize a snake_case enum for display. */
  const humanize = (s?: string | null): string =>
    s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : t('common.emptyValue', '—');

  // Localized display labels. Logic still keys off the raw enum values (STATUS_VARIANT,
  // status/type checks); only the badge/column text is translated. Unknown values fall
  // back to humanize() so behavior never regresses.
  const RMA_STATUS_LABELS: Record<string, string> = {
    open: t('rma.status.open', 'Open'),
    awaiting_return: t('rma.status.awaitingReturn', 'Awaiting return'),
    returned: t('rma.status.returned', 'Returned'),
    sent_to_vendor: t('rma.status.sentToVendor', 'Sent to vendor'),
    replacement_received: t('rma.status.replacementReceived', 'Replacement received'),
    replacement_deployed: t('rma.status.replacementDeployed', 'Replacement deployed'),
    dead_unit_owed: t('rma.status.deadUnitOwed', 'Dead unit owed'),
    dead_unit_returned: t('rma.status.deadUnitReturned', 'Dead unit returned'),
    replaced: t('rma.status.replaced', 'Replaced'),
    credited: t('rma.status.credited', 'Credited'),
    charged: t('rma.status.charged', 'Charged'),
    closed: t('rma.status.closed', 'Closed'),
  };
  const statusLabel = (v?: string | null): string => (v && RMA_STATUS_LABELS[v]) || humanize(v);
  const RMA_TYPE_LABELS: Record<string, string> = {
    standard: t('rma.types.standard', 'Standard'),
    advance_replacement: t('rma.types.advanceReplacement', 'Advance replacement'),
  };
  const typeLabel = (v?: string | null): string => (v && RMA_TYPE_LABELS[v]) || humanize(v);

  const reload = useCallback(async () => {
    try {
      const [list, owed] = await Promise.all([listRmaCases({}), deadUnitsOwedReport()]);
      if (isActionMessageError(list) || isActionPermissionError(list)) {
        setCases([]);
        toast.error(getErrorMessage(list));
        return;
      }
      if (isActionMessageError(owed) || isActionPermissionError(owed)) {
        setDeadOwed([]);
        toast.error(getErrorMessage(owed));
        return;
      }
      setCases(list);
      setDeadOwed(owed);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('rma.loadCasesFailed', "Couldn't load RMA cases."));
    }
  }, [t]);

  useEffect(() => {
    (async () => {
      try {
        const [locs, vens] = await Promise.all([
          listStockLocations({ includeInactive: false }),
          listVendors({ includeInactive: false }),
        ]);
        if (isActionMessageError(locs) || isActionPermissionError(locs)) {
          setLocations([]);
          toast.error(getErrorMessage(locs));
          return;
        }
        if (isActionMessageError(vens) || isActionPermissionError(vens)) {
          setVendors([]);
          toast.error(getErrorMessage(vens));
          return;
        }
        setLocations(locs);
        setVendors(vens);
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || t('rma.loadLocationsVendorsFailed', "Couldn't load locations and vendors."));
      }
    })();
  }, [t]);

  const openCreate = () => {
    setForm({ rma_type: 'standard', returned_unit_id: '', reason: '' });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.returned_unit_id.trim()) {
      toast.error(t('rma.returnedUnitRequired', 'Returned unit ID is required.'));
      return;
    }
    setSaving(true);
    try {
      const payload = { returned_unit_id: form.returned_unit_id.trim(), reason: form.reason.trim() || null };
      const result = form.rma_type === 'advance_replacement'
        ? await openAdvanceRma(payload)
        : await openRma(payload);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('rma.caseOpened', 'RMA case opened.'));
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('rma.openFailed', "Couldn't open RMA."));
    } finally {
      setSaving(false);
    }
  };

  const saveReceiveReturn = async () => {
    if (!receiveCase || !receiveLocation) {
      toast.error(t('rma.pickLocation', 'Pick a location.'));
      return;
    }
    setActioning(true);
    try {
      const result = await receiveReturn(receiveCase.rma_id, { location_id: receiveLocation });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('rma.returnReceived', 'Return received.'));
      setReceiveCase(null);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('rma.receiveFailed', "Couldn't receive the return."));
    } finally {
      setActioning(false);
    }
  };

  const saveSendToVendor = async () => {
    if (!vendorCase || !vendorId) {
      toast.error(t('rma.pickVendor', 'Pick a vendor.'));
      return;
    }
    setActioning(true);
    try {
      const result = await sendToVendor(vendorCase.rma_id, { vendor_id: vendorId, rma_reference: vendorRef.trim() || null });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('rma.sentToVendor', 'Sent to vendor.'));
      setVendorCase(null);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('rma.sendVendorFailed', "Couldn't send to vendor."));
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
    { title: t('rma.columns.type', 'Type'), dataIndex: 'rma_type', render: (v: any) => typeLabel(v) },
    {
      title: t('common.status', 'Status'),
      dataIndex: 'status',
      render: (v: any) => <Badge variant={STATUS_VARIANT[v] ?? 'secondary'} size="sm">{statusLabel(v)}</Badge>,
    },
    { title: t('rma.columns.returnedUnit', 'Returned unit'), dataIndex: 'returned_unit_id', render: (v: any) => v || t('common.emptyValue', '—') },
    { title: t('rma.columns.client', 'Client'), dataIndex: 'client_id', render: (v: any) => v || t('common.emptyValue', '—') },
    { title: t('rma.columns.reason', 'Reason'), dataIndex: 'reason', render: (v: any) => v || t('common.emptyValue', '—') },
    {
      title: t('common.actions', 'Actions'),
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
            {t('rma.receiveReturn', 'Receive return')}
          </Button>
          <Button
            id={`send-to-vendor-${rec.rma_id}`}
            variant="ghost"
            size="sm"
            disabled={rec.status !== 'returned'}
            onClick={() => openSendToVendor(rec)}
          >
            {t('rma.sendToVendor', 'Send to vendor')}
          </Button>
        </div>
      ),
    },
  ];

  const deadColumns: ColumnDefinition<DeadUnitOwedRow>[] = [
    { title: t('rma.columns.returnedUnit', 'Returned unit'), dataIndex: 'returned_unit_id', render: (v: any) => v || t('common.emptyValue', '—') },
    { title: t('rma.columns.client', 'Client'), dataIndex: 'client_id', render: (v: any) => v || t('common.emptyValue', '—') },
    { title: t('rma.columns.vendor', 'Vendor'), dataIndex: 'vendor_id', render: (v: any) => v || t('common.emptyValue', '—') },
    {
      title: t('rma.columns.dueDate', 'Due date'),
      dataIndex: 'dead_unit_due_date',
      render: (v: any) => (v ? new Date(v).toLocaleDateString() : t('common.emptyValue', '—')),
    },
    {
      title: t('rma.columns.daysRemaining', 'Days remaining'),
      dataIndex: 'days_remaining',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
      render: (v: any) => (v === null || v === undefined ? t('common.emptyValue', '—') : v),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="rma-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('rma.title', 'RMA')}</h1>
        <Button id="rma-add-button" onClick={openCreate}>
          {t('rma.openRma', 'Open RMA')}
        </Button>
      </div>

      <DataTable id="rma-cases-table" data={cases} columns={caseColumns} />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{t('rma.deadUnitsOwed', 'Dead units owed')}</h2>
        <DataTable id="rma-dead-owed-table" data={deadOwed} columns={deadColumns} />
      </div>

      <Dialog isOpen={dialogOpen} onClose={() => setDialogOpen(false)} title={t('rma.openRma', 'Open RMA')} id="rma-open-dialog">
        <div className="space-y-4 p-1">
          <CustomSelect
            id="rma-type"
            label={t('rma.fields.rmaType', 'RMA type')}
            value={form.rma_type}
            options={RMA_TYPE_OPTIONS}
            onValueChange={(v: string) => setForm({ ...form, rma_type: v as RmaType })}
          />
          <Input
            id="rma-returned-unit-id"
            label={t('rma.fields.returnedUnitId', 'Returned unit ID')}
            required
            value={form.returned_unit_id}
            onChange={(e) => setForm({ ...form, returned_unit_id: e.target.value })}
          />
          <Input
            id="rma-reason"
            label={t('rma.fields.reason', 'Reason')}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="rma-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="rma-save" onClick={save} disabled={saving}>
              {saving ? t('common.saving', 'Saving…') : t('rma.openRma', 'Open RMA')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={receiveCase !== null}
        onClose={() => setReceiveCase(null)}
        title={t('rma.receiveReturn', 'Receive return')}
        id="rma-receive-dialog"
      >
        <div className="space-y-4 p-1">
          <CustomSelect
            id="rma-receive-location"
            label={t('rma.fields.location', 'Location')}
            required
            value={receiveLocation}
            placeholder={t('rma.fields.locationPlaceholder', 'Select a location…')}
            options={locations.map((l) => ({ value: l.location_id, label: l.name }))}
            onValueChange={(v: string) => setReceiveLocation(v)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="rma-receive-cancel" variant="outline" onClick={() => setReceiveCase(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="rma-receive-save" onClick={saveReceiveReturn} disabled={actioning}>
              {actioning ? t('rma.receiving', 'Receiving…') : t('rma.receiveReturn', 'Receive return')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={vendorCase !== null}
        onClose={() => setVendorCase(null)}
        title={t('rma.sendToVendor', 'Send to vendor')}
        id="rma-vendor-dialog"
      >
        <div className="space-y-4 p-1">
          <CustomSelect
            id="rma-vendor"
            label={t('rma.fields.vendor', 'Vendor')}
            required
            value={vendorId}
            placeholder={t('rma.fields.vendorPlaceholder', 'Select a vendor…')}
            options={vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name }))}
            onValueChange={(v: string) => setVendorId(v)}
          />
          <Input
            id="rma-vendor-ref"
            label={t('rma.fields.vendorRef', 'Vendor RMA reference')}
            value={vendorRef}
            onChange={(e) => setVendorRef(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="rma-vendor-cancel" variant="outline" onClick={() => setVendorCase(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="rma-vendor-save" onClick={saveSendToVendor} disabled={actioning}>
              {actioning ? t('rma.sending', 'Sending…') : t('rma.sendToVendor', 'Send to vendor')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
