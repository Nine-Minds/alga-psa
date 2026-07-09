'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import type { IPurchaseOrder, IPurchaseOrderLine, IPoLandedCost } from '@alga-psa/types';
import { listPoLandedCosts, addPoLandedCost, removePoLandedCost, applyPoLandedCosts, getPurchaseOrder } from '../actions';

const money = (cents: number, currency: string): string => `$${(cents / 100).toFixed(2)} ${currency}`;

interface EntryForm {
  cost_type: 'freight' | 'duty' | 'other';
  amount: string; // dollars
  allocation_method: 'value' | 'quantity';
  description: string;
}

const emptyEntry = (): EntryForm => ({ cost_type: 'freight', amount: '', allocation_method: 'value', description: '' });
const isReturnedActionError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);

/**
 * Landed cost per PO (F070/F074): manage freight/duty entries, preview the
 * allocation across received lines, and apply (idempotent) — which folds the cost
 * into moving averages and serialized unit costs.
 */
export function PoLandedCostDialog({
  po,
  onClose,
  onChanged,
  productName,
}: {
  po: IPurchaseOrder | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  productName: (serviceId: string) => string;
}) {
  const { t } = useTranslation('features/inventory');
  // Localized display labels for the entry enums. The stored values ('freight'/'value'/…)
  // stay raw in state and requests; only the table text is translated. Unknown values fall
  // back to the raw value so behavior never regresses.
  const costTypeLabel = (v?: string | null): string => {
    switch (v) {
      case 'freight':
        return t('poLandedCost.costType.freight', 'Freight');
      case 'duty':
        return t('poLandedCost.costType.duty', 'Duty');
      case 'other':
        return t('poLandedCost.costType.other', 'Other');
      default:
        return v ?? '';
    }
  };
  const allocationMethodLabel = (v?: string | null): string => {
    switch (v) {
      case 'value':
        return t('poLandedCost.allocation.value', 'Line value');
      case 'quantity':
        return t('common.quantity', 'Quantity');
      default:
        return v ?? '';
    }
  };
  const [entries, setEntries] = useState<IPoLandedCost[]>([]);
  const [lines, setLines] = useState<IPurchaseOrderLine[]>([]);
  const [form, setForm] = useState<EntryForm>(emptyEntry());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!po) return;
    try {
      const [entryRows, full] = await Promise.all([listPoLandedCosts(po.po_id), getPurchaseOrder(po.po_id)]);
      if (isReturnedActionError(entryRows)) {
        setEntries([]);
        toast.error(getErrorMessage(entryRows));
      } else {
        setEntries(entryRows);
      }
      if (isActionMessageError(full) || isActionPermissionError(full)) {
        setLines([]);
        toast.error(getErrorMessage(full));
        return;
      }
      setLines((full?.lines ?? []).filter((l: IPurchaseOrderLine) => Number(l.quantity_received) > 0));
    } catch (e: any) {
      toast.error(e?.message || t('poLandedCost.loadError', "Couldn't load landed costs."));
    }
  }, [po, t]);

  useEffect(() => {
    setEntries([]);
    setLines([]);
    setForm(emptyEntry());
    load();
  }, [load]);

  const unapplied = entries.filter((e) => !e.applied);
  const appliedTotal = entries.filter((e) => e.applied).reduce((s, e) => s + Number(e.amount), 0);
  const unappliedTotal = unapplied.reduce((s, e) => s + Number(e.amount), 0);

  // Estimated allocation preview for the unapplied entries — same weights the server uses.
  const preview = useMemo(() => {
    if (lines.length === 0 || unappliedTotal === 0) return [];
    const totalValue = lines.reduce((s, l) => s + Number(l.unit_cost) * Number(l.quantity_received), 0);
    const totalQty = lines.reduce((s, l) => s + Number(l.quantity_received), 0);
    return lines.map((l) => {
      let allocated = 0;
      for (const e of unapplied) {
        const weight =
          e.allocation_method === 'quantity'
            ? Number(l.quantity_received) / totalQty
            : totalValue > 0
              ? (Number(l.unit_cost) * Number(l.quantity_received)) / totalValue
              : Number(l.quantity_received) / totalQty;
        allocated += Math.round(Number(e.amount) * weight);
      }
      const perUnit = Math.round(allocated / Number(l.quantity_received));
      return { line: l, allocated, perUnit, effective: Number(l.unit_cost) + perUnit };
    });
  }, [lines, unapplied, unappliedTotal]);

  const add = async () => {
    if (!po) return;
    const dollars = Number(form.amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error(t('poLandedCost.amountRequired', 'Amount must be greater than 0.'));
      return;
    }
    setBusy('add');
    try {
      const result = await addPoLandedCost(po.po_id, {
        cost_type: form.cost_type,
        amount: Math.round(dollars * 100),
        allocation_method: form.allocation_method,
        description: form.description.trim() || null,
      });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('poLandedCost.entryAdded', 'Landed-cost entry added.'));
      setForm(emptyEntry());
      await load();
    } catch (e: any) {
      toast.error(e?.message || t('poLandedCost.addFailed', "Couldn't add the entry."));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (entry: IPoLandedCost) => {
    setBusy(`remove:${entry.landed_cost_id}`);
    try {
      const result = await removePoLandedCost(entry.landed_cost_id);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message || t('poLandedCost.removeFailed', "Couldn't remove the entry."));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!po) return;
    setBusy('apply');
    try {
      const result = await applyPoLandedCosts(po.po_id);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      if (result.applied_entries === 0) {
        toast.success(t('poLandedCost.nothingToApply', 'Nothing to apply.'));
      } else {
        toast.success(
          t('poLandedCost.applied', 'Applied {{amount}} across {{count}} line(s) — averages and unit costs updated.', {
            amount: money(result.total_applied_cents, po.currency_code ?? 'USD'),
            count: result.allocations.length,
          }),
        );
      }
      await load();
      await onChanged();
    } catch (e: any) {
      toast.error(e?.message || t('poLandedCost.applyFailed', "Couldn't apply landed costs."));
    } finally {
      setBusy(null);
    }
  };

  const currency = po?.currency_code ?? 'USD';

  return (
    <Dialog
      isOpen={po !== null}
      onClose={onClose}
      title={po ? t('poLandedCost.titleWithPo', 'Landed cost — {{poNumber}}', { poNumber: po.po_number }) : t('poLandedCost.title', 'Landed cost')}
      id="po-landed-cost-dialog"
      className="max-w-3xl"
    >
      <div className="space-y-4 p-1">
        {entries.length > 0 && (
          <table className="w-full text-sm" id="po-landed-cost-entries">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-2 font-medium">{t('poLandedCost.columns.type', 'Type')}</th>
                <th className="py-2 px-2 font-medium text-right">{t('poLandedCost.columns.amount', 'Amount')}</th>
                <th className="py-2 px-2 font-medium">{t('poLandedCost.columns.allocateBy', 'Allocate by')}</th>
                <th className="py-2 px-2 font-medium">{t('common.status', 'Status')}</th>
                <th className="py-2 pl-2" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.landed_cost_id} className="border-b last:border-0">
                  <td className="py-2 pr-2 capitalize">
                    {costTypeLabel(e.cost_type)}
                    {e.description && <span className="ml-2 text-xs text-gray-500">{e.description}</span>}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{money(Number(e.amount), currency)}</td>
                  <td className="py-2 px-2 capitalize">{allocationMethodLabel(e.allocation_method)}</td>
                  <td className="py-2 px-2">
                    <Badge variant={e.applied ? 'success' : 'secondary'} size="sm">
                      {e.applied ? t('poLandedCost.status.applied', 'Applied') : t('poLandedCost.status.pending', 'Pending')}
                    </Badge>
                  </td>
                  <td className="py-2 pl-2 text-right">
                    {!e.applied && (
                      <Button
                        id={`landed-cost-remove-${e.landed_cost_id}`}
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => remove(e)}
                      >
                        {t('common.remove', 'Remove')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-sm text-gray-600">
          {t('poLandedCost.appliedLabel', 'Applied:')} <span className="tabular-nums font-medium">{money(appliedTotal, currency)}</span>
          {unappliedTotal > 0 && (
            <span>
              {' '}
              · {t('poLandedCost.pendingLabel', 'Pending:')} <span className="tabular-nums font-medium">{money(unappliedTotal, currency)}</span>
            </span>
          )}
        </p>

        <div className="border rounded p-3 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <CustomSelect
              id="landed-cost-type"
              label={t('poLandedCost.columns.type', 'Type')}
              value={form.cost_type}
              onValueChange={(value) => setForm({ ...form, cost_type: value as EntryForm['cost_type'] })}
              options={[
                { value: 'freight', label: t('poLandedCost.costType.freight', 'Freight') },
                { value: 'duty', label: t('poLandedCost.costType.duty', 'Duty') },
                { value: 'other', label: t('poLandedCost.costType.other', 'Other') },
              ]}
            />
            <Input
              id="landed-cost-amount"
              label={t('poLandedCost.fields.amount', 'Amount ($ {{currency}})', { currency })}
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
            <CustomSelect
              id="landed-cost-method"
              label={t('poLandedCost.columns.allocateBy', 'Allocate by')}
              value={form.allocation_method}
              onValueChange={(value) => setForm({ ...form, allocation_method: value as EntryForm['allocation_method'] })}
              options={[
                { value: 'value', label: t('poLandedCost.allocation.value', 'Line value') },
                { value: 'quantity', label: t('common.quantity', 'Quantity') },
              ]}
            />
            <Input
              id="landed-cost-description"
              label={t('common.description', 'Description')}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="flex justify-end">
            <Button id="landed-cost-add" variant="outline" size="sm" onClick={add} disabled={busy !== null}>
              {busy === 'add' ? t('poLandedCost.actions.adding', 'Adding…') : t('poLandedCost.actions.addEntry', 'Add entry')}
            </Button>
          </div>
        </div>

        {preview.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1">{t('poLandedCost.previewTitle', 'Allocation preview (pending entries)')}</p>
            <table className="w-full text-sm" id="po-landed-cost-preview">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-1 pr-2 font-medium">{t('poLandedCost.columns.product', 'Product')}</th>
                  <th className="py-1 px-2 font-medium text-right">{t('poLandedCost.columns.received', 'Received')}</th>
                  <th className="py-1 px-2 font-medium text-right">{t('poLandedCost.columns.allocated', 'Allocated')}</th>
                  <th className="py-1 px-2 font-medium text-right">{t('poLandedCost.columns.effectiveUnitCost', 'Effective unit cost')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={p.line.po_line_id} className="border-b last:border-0">
                    <td className="py-1 pr-2">{productName(p.line.service_id)}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{Number(p.line.quantity_received)}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{money(p.allocated, currency)}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{money(p.effective, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {lines.length === 0 && unapplied.length > 0 && (
          <p className="text-sm text-amber-700">{t('poLandedCost.nothingReceived', 'Nothing received yet — receive the PO first, then apply.')}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button id="po-landed-cost-close" variant="outline" onClick={onClose}>
            {t('common.close', 'Close')}
          </Button>
          <Button
            id="po-landed-cost-apply"
            onClick={apply}
            disabled={busy !== null || unapplied.length === 0 || lines.length === 0}
          >
            {busy === 'apply' ? t('poLandedCost.actions.applying', 'Applying…') : t('poLandedCost.actions.applyPending', 'Apply pending entries')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
