'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { usePageCreateShortcut, useDialogSubmitShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IStockTransfer, IStockLocation } from '@alga-psa/types';
import {
  listTransfers,
  dispatchTransfer,
  computeLoadList,
  receiveTransfer,
  cancelTransfer,
  listStockLocations,
  type LoadListResult,
  type LoadListRow,
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

const STATUS_VARIANT: Record<string, 'secondary' | 'info' | 'warning' | 'success' | 'error'> = {
  dispatched: 'warning',
  received: 'success',
  cancelled: 'error',
};

type ReturnedActionError = ActionMessageError | ActionPermissionError;

function isReturnedActionError(value: unknown): value is ReturnedActionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

export function TransfersManager({
  initialTransfers,
  initialLocations,
}: {
  initialTransfers: IStockTransfer[];
  initialLocations: IStockLocation[];
}) {
  const { t } = useTranslation('features/inventory');

  /** Humanize a snake_case enum for display. */
  const humanize = (s?: string | null): string =>
    s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : t('common.emptyValue', '—');

  // Localized display label per raw transfer status (STATUS_VARIANT and the action guards
  // still key off the raw value). Unknown values fall back to humanize() so nothing regresses.
  const TRANSFER_STATUS_LABELS: Record<string, string> = {
    dispatched: t('transfers.status.dispatched', 'Dispatched'),
    received: t('transfers.status.received', 'Received'),
    cancelled: t('transfers.status.cancelled', 'Cancelled'),
  };
  const statusLabel = (v?: string | null): string => (v && TRANSFER_STATUS_LABELS[v]) || humanize(v);

  const [transfers, setTransfers] = useState<IStockTransfer[]>(initialTransfers || []);
  const [locations, setLocations] = useState<IStockLocation[]>(initialLocations || []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<IStockTransfer | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [loadListOpen, setLoadListOpen] = useState(false);
  const [loadListTo, setLoadListTo] = useState('');
  const [loadListFrom, setLoadListFrom] = useState('');
  const [loadListResult, setLoadListResult] = useState<LoadListResult | null>(null);
  const [loadListOpening, setLoadListOpening] = useState(false);
  const [loadListComputing, setLoadListComputing] = useState(false);
  const [loadListDispatching, setLoadListDispatching] = useState(false);

  const locationName = useCallback(
    (id: string) => locations.find((l) => l.location_id === id)?.name || id,
    [locations],
  );

  const reload = useCallback(async () => {
    try {
      const result = await listTransfers({});
      if (isReturnedActionError(result)) {
        setTransfers([]);
        toast.error(getErrorMessage(result));
        return;
      }
      setTransfers(result);
    } catch (e) {
      console.error(e);
      toast.error(t('transfers.loadFailed', 'Failed to load transfers'));
    }
  }, [t]);

  const openCreate = async () => {
    setForm(emptyForm());
    setDialogOpen(true);
    try {
      const result = await listStockLocations({ includeInactive: false });
      if (isReturnedActionError(result)) {
        setLocations([]);
        toast.error(getErrorMessage(result));
        return;
      }
      setLocations(result);
    } catch (e) {
      console.error(e);
      toast.error(t('transfers.loadLocationsFailed', 'Failed to load locations'));
    }
  };
  usePageCreateShortcut(() => { void openCreate(); });

  const resetLoadList = () => {
    setLoadListTo('');
    setLoadListFrom('');
    setLoadListResult(null);
    setLoadListComputing(false);
    setLoadListDispatching(false);
  };

  const openLoadList = async () => {
    resetLoadList();
    setLoadListOpening(true);
    setLoadListOpen(true);
    try {
      const result = await listStockLocations({ includeInactive: false });
      if (isReturnedActionError(result)) {
        setLocations([]);
        toast.error(getErrorMessage(result));
        return;
      }
      setLocations(result);
    } catch (e) {
      console.error(e);
      toast.error(t('transfers.loadLocationsFailed', 'Failed to load locations'));
    } finally {
      setLoadListOpening(false);
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

  const clampLoadQty = (row: LoadListRow, value: number) => {
    const qty = Number.isFinite(value) ? Math.floor(value) : 0;
    return Math.max(0, Math.min(qty, Math.max(0, row.source_available)));
  };

  const setLoadListQty = (serviceId: string, value: number) => {
    setLoadListResult((result) =>
      result
        ? {
            ...result,
            rows: result.rows.map((row) =>
              row.service_id === serviceId && !row.is_serialized
                ? { ...row, load_qty: clampLoadQty(row, value) }
                : row,
            ),
          }
        : result,
    );
  };

  const computeVanLoadList = async () => {
    setLoadListComputing(true);
    try {
      const result = await computeLoadList(loadListTo, loadListFrom);
      if (isReturnedActionError(result)) {
        setLoadListResult(null);
        toast.error(getErrorMessage(result));
        return;
      }
      setLoadListResult(result);
    } catch (e: any) {
      toast.error(e?.message || t('transfers.computeFailed', 'Failed to compute load list'));
    } finally {
      setLoadListComputing(false);
    }
  };

  const buildLoadListLines = () => {
    if (!loadListResult) return [];
    return loadListResult.rows.flatMap((row) => {
      const qty = Math.floor(Number(row.load_qty) || 0);
      if (qty <= 0) return [];
      if (row.is_serialized) {
        return row.units.slice(0, qty).map((unit) => ({
          service_id: row.service_id,
          quantity: 1,
          unit_id: unit.unit_id,
        }));
      }
      return [{ service_id: row.service_id, quantity: qty }];
    });
  };

  const dispatchLoadList = async () => {
    if (!loadListResult) return;
    const lines = buildLoadListLines();
    if (lines.length === 0) {
      toast.error(t('transfers.loadQtyRequired', 'At least one load quantity is required'));
      return;
    }

    setLoadListDispatching(true);
    try {
      const transfer = await dispatchTransfer({
        from_location_id: loadListResult.from_location_id,
        to_location_id: loadListResult.to_location_id,
        notes: t('transfers.vanLoadListReplenishment', 'Van load list replenishment'),
        lines,
      });
      if (isReturnedActionError(transfer)) {
        toast.error(getErrorMessage(transfer));
        return;
      }
      const lineCount = transfer.lines?.length ?? lines.length;
      toast.success(
        lineCount === 1
          ? t('transfers.loadDispatchedOne', 'Load dispatched ({{n}} line)', { n: lineCount })
          : t('transfers.loadDispatchedMany', 'Load dispatched ({{n}} lines)', { n: lineCount }),
      );
      setLoadListOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('transfers.dispatchFailed', 'Dispatch failed'));
    } finally {
      setLoadListDispatching(false);
    }
  };

  const save = async () => {
    if (!form.from_location_id || !form.to_location_id) {
      toast.error(t('transfers.locationsRequired', 'Source and destination locations are required'));
      return;
    }
    if (form.from_location_id === form.to_location_id) {
      toast.error(t('transfers.locationsMustDiffer', 'Source and destination must differ'));
      return;
    }
    const lines = form.lines
      .filter((l) => l.service_id.trim())
      .map((l) => ({ service_id: l.service_id.trim(), quantity: Number(l.quantity) }));
    if (lines.length === 0) {
      toast.error(t('transfers.lineRequired', 'At least one line with a service is required'));
      return;
    }
    setSaving(true);
    try {
      const result = await dispatchTransfer({
        from_location_id: form.from_location_id,
        to_location_id: form.to_location_id,
        lines,
      });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('transfers.dispatched', 'Transfer dispatched'));
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('transfers.dispatchFailed', 'Dispatch failed'));
    } finally {
      setSaving(false);
    }
  };
  useDialogSubmitShortcut(
    () => { void save(); },
    { active: dialogOpen, enabled: dialogOpen && !saving },
  );

  const receive = async (rec: IStockTransfer) => {
    try {
      const result = await receiveTransfer(rec.transfer_id);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        await reload();
        return;
      }
      toast.success(t('transfers.received', 'Transfer received'));
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('transfers.receiveFailed', 'Receive failed'));
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const result = await cancelTransfer(cancelTarget.transfer_id);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        await reload();
        return;
      }
      toast.success(t('transfers.cancelled', 'Transfer cancelled'));
      setCancelTarget(null);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('transfers.cancelFailed', 'Cancel failed'));
    } finally {
      setCancelling(false);
    }
  };

  const locationOptions = locations.map((l) => ({ value: l.location_id, label: l.name }));
  const loadListHasQty = loadListResult?.rows.some((row) => Number(row.load_qty) > 0) ?? false;

  const columns: ColumnDefinition<IStockTransfer>[] = [
    { title: t('transfers.columns.from', 'From'), dataIndex: 'from_location_id', render: (v: any) => locationName(v) },
    { title: t('transfers.columns.to', 'To'), dataIndex: 'to_location_id', render: (v: any) => locationName(v) },
    {
      title: t('common.status', 'Status'),
      dataIndex: 'status',
      render: (v: any) => (
        <Badge variant={STATUS_VARIANT[v] ?? 'secondary'} size="sm">
          {statusLabel(v)}
        </Badge>
      ),
    },
    { title: t('transfers.columns.dispatched', 'Dispatched'), dataIndex: 'dispatched_at', render: (v: any) => formatDate(v) },
    { title: t('transfers.columns.received', 'Received'), dataIndex: 'received_at', render: (v: any) => formatDate(v) },
    {
      title: t('common.actions', 'Actions'),
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
              {t('transfers.receive', 'Receive')}
            </Button>
          )}
          {rec.status === 'dispatched' && (
            <Button
              id={`cancel-transfer-${rec.transfer_id}`}
              variant="ghost"
              size="sm"
              onClick={() => setCancelTarget(rec)}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="transfers-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('transfers.title', 'Transfers')}</h1>
        <div className="flex gap-2">
          <Button
            id="transfers-load-list-button"
            variant="outline"
            onClick={openLoadList}
            disabled={loadListOpening}
          >
            {t('transfers.loadList', 'Load list')}
          </Button>
          <Button id="transfers-add-button" onClick={openCreate}>
            {t('transfers.dispatchTransfer', 'Dispatch Transfer')}
          </Button>
        </div>
      </div>

      <DataTable id="transfers-table" data={transfers} columns={columns} />

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t('transfers.dispatchTransfer', 'Dispatch Transfer')}
        id="transfer-dialog"
      >
        <div className="space-y-4 p-1">
          <CustomSelect
            id="transfer-from-location"
            label={t('transfers.fromLocation', 'From location')}
            required
            placeholder={t('transfers.selectLocation', 'Select a location…')}
            value={form.from_location_id}
            onValueChange={(value) => setForm({ ...form, from_location_id: value })}
            options={locationOptions}
          />
          <CustomSelect
            id="transfer-to-location"
            label={t('transfers.toLocation', 'To location')}
            required
            placeholder={t('transfers.selectLocation', 'Select a location…')}
            value={form.to_location_id}
            onValueChange={(value) => setForm({ ...form, to_location_id: value })}
            options={locationOptions}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium">{t('transfers.linesLabel', 'Lines *')}</label>
              <Button id="transfer-add-line" variant="outline" size="sm" onClick={addLine}>
                {t('transfers.addLine', 'Add Line')}
              </Button>
            </div>
            {form.lines.map((line, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">{t('transfers.serviceId', 'Service ID')}</label>
                  <Input
                    id={`transfer-line-service-${idx}`}
                    value={line.service_id}
                    onChange={(e) => setLine(idx, { service_id: e.target.value })}
                  />
                </div>
                <div className="w-28">
                  <label className="block text-xs text-gray-500 mb-1">{t('common.quantity', 'Quantity')}</label>
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
                  {t('common.remove', 'Remove')}
                </Button>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button id="transfer-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="transfer-save" onClick={save} disabled={saving}>
              {saving ? t('transfers.dispatching', 'Dispatching…') : t('transfers.dispatch', 'Dispatch')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={loadListOpen}
        onClose={() => setLoadListOpen(false)}
        title={t('transfers.vanLoadList', 'Van load list')}
        id="load-list-dialog"
      >
        <div className="space-y-4 p-1">
          <div className="grid gap-3 md:grid-cols-2">
            <CustomSelect
              id="load-list-to"
              label={t('transfers.loadDestination', 'Load (destination)')}
              placeholder={t('transfers.selectDestination', 'Select destination...')}
              value={loadListTo}
              onValueChange={(value) => {
                setLoadListTo(value);
                setLoadListResult(null);
              }}
              options={locationOptions}
            />
            <CustomSelect
              id="load-list-from"
              label={t('transfers.fromSource', 'From (source shelf)')}
              placeholder={t('transfers.selectSource', 'Select source...')}
              value={loadListFrom}
              onValueChange={(value) => {
                setLoadListFrom(value);
                setLoadListResult(null);
              }}
              options={locationOptions}
            />
          </div>

          <div className="flex justify-end">
            <Button
              id="load-list-compute"
              variant="outline"
              onClick={computeVanLoadList}
              disabled={loadListComputing || loadListDispatching}
            >
              {loadListComputing ? t('transfers.computing', 'Computing...') : t('transfers.compute', 'Compute')}
            </Button>
          </div>

          {loadListResult && (
            <div className="space-y-2">
              {loadListResult.rows.length === 0 ? (
                <p id="load-list-empty" className="text-sm text-gray-500">
                  {t('transfers.noLowStock', 'No low-stock lines found for this destination.')}
                </p>
              ) : (
                <div className="overflow-x-auto rounded border" id="load-list-results">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">{t('transfers.columns.product', 'Product')}</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">{t('transfers.columns.needed', 'Needed')}</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">{t('transfers.columns.atSource', 'At source')}</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">{t('transfers.columns.loadQty', 'Load qty')}</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">{t('transfers.columns.serials', 'Serials')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {loadListResult.rows.map((row) => (
                        <tr key={row.service_id}>
                          <td className="px-3 py-2 align-top">
                            <div className="font-medium text-gray-900">{row.service_name || row.service_id}</div>
                            {row.sku && <div className="text-xs text-gray-500">{row.sku}</div>}
                          </td>
                          <td className="px-3 py-2 text-right align-top">{row.needed}</td>
                          <td className="px-3 py-2 text-right align-top">
                            <div>{row.source_available}</div>
                            {row.short_at_source > 0 && (
                              <div className="text-xs text-amber-700">{t('transfers.shortAtSource', 'short {{n}} at source', { n: row.short_at_source })}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right align-top">
                            {row.is_serialized ? (
                              <div>
                                <div>{row.load_qty}</div>
                                {row.load_qty > 0 && <div className="text-xs text-gray-500">{t('transfers.fifoPicked', 'FIFO picked')}</div>}
                              </div>
                            ) : (
                              <Input
                                id={`load-list-qty-${row.service_id}`}
                                type="number"
                                min={0}
                                max={Math.max(0, row.source_available)}
                                value={String(row.load_qty)}
                                onChange={(e) => setLoadListQty(row.service_id, Number(e.target.value))}
                                className="ml-auto w-24 text-right"
                              />
                            )}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {row.is_serialized ? (
                              row.units.length > 0 ? (
                                <div className="space-y-1">
                                  {row.units.map((unit) => (
                                    <div key={unit.unit_id} className="font-mono text-xs text-gray-700">
                                      {unit.serial_number}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-gray-500">{t('transfers.noSerials', 'No serials')}</span>
                              )
                            ) : (
                              <span className="text-xs text-gray-500">{t('transfers.dash', '-')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              id="load-list-cancel"
              variant="outline"
              onClick={() => setLoadListOpen(false)}
              disabled={loadListDispatching}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              id="load-list-dispatch"
              onClick={dispatchLoadList}
              disabled={loadListComputing || loadListDispatching || !loadListHasQty}
            >
              {loadListDispatching ? t('transfers.dispatchingLoad', 'Dispatching...') : t('transfers.dispatchLoad', 'Dispatch load')}
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
        title={t('transfers.cancelTitle', 'Cancel transfer')}
        message={t('transfers.cancelConfirm', 'Are you sure you want to cancel this transfer? This cannot be undone.')}
        confirmLabel={t('transfers.cancelTitle', 'Cancel transfer')}
        cancelLabel={t('transfers.keepTransfer', 'Keep transfer')}
      />
    </div>
  );
}
