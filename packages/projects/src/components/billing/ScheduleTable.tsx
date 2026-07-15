'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { IProjectBillingConfig, IProjectPhase } from '@alga-psa/types';
import type {
  ProjectBillingRollup,
  ScheduleEntryView,
} from '@alga-psa/billing/actions/projectBillingConfigActions';
import {
  approveScheduleEntry,
  approveAndInvoiceNow,
  cancelScheduleEntry,
  deleteScheduleEntry,
  holdScheduleEntry,
  markEntryReady,
} from '@alga-psa/billing/actions/projectBillingScheduleActions';
import StatusChip from './StatusChip';
import ScheduleEntryDialog from './ScheduleEntryDialog';
import { formatCents } from './billingViewHelpers';

interface ScheduleTableProps {
  config: IProjectBillingConfig;
  entries: ScheduleEntryView[];
  rollup: ProjectBillingRollup | null;
  phases: IProjectPhase[];
  canManage: boolean;
  /** Entry to visually highlight after a phase-completion deep link (F139). */
  highlightEntryId?: string | null;
  onChanged: () => void;
}

function formatTriggerDate(value: Date | string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * F117/F118/F120/F121/F126/F128 — fixed-price payment schedule. Renders the
 * entries table (deposits distinguished, deleted-phase entries flagged as manual
 * fallback), the sum-to-total allocation footer, and the per-row lifecycle
 * actions gated on the caller's manage permission.
 */
export default function ScheduleTable({
  config,
  entries,
  rollup,
  phases,
  canManage,
  highlightEntryId,
  onChanged,
}: ScheduleTableProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const currency = config.currency;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialogEntry, setDialogEntry] = useState<ScheduleEntryView | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [holdTarget, setHoldTarget] = useState<ScheduleEntryView | null>(null);
  const [holdReason, setHoldReason] = useState('');

  const allocation = useMemo(() => {
    const total = config.total_price ?? 0;
    const sum = entries
      .filter((entry) => entry.status !== 'canceled')
      .reduce((acc, entry) => acc + entry.computed_amount, 0);
    const delta = total - sum;
    return { total, sum, delta, pct: rollup?.allocated_pct ?? (total > 0 ? (sum / total) * 100 : 0) };
  }, [config.total_price, entries, rollup]);

  const run = async <T,>(
    id: string,
    action: () => Promise<T>,
    successKey: string,
    fallback: string,
    onResult?: (result: T) => void,
  ) => {
    setBusyId(id);
    try {
      const result = await action();
      toast.success(t(successKey, fallback));
      onResult?.(result);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  const openAdd = () => { setDialogEntry(null); setDialogOpen(true); };
  const openEdit = (entry: ScheduleEntryView) => { setDialogEntry(entry); setDialogOpen(true); };

  const submitHold = async () => {
    if (!holdTarget) return;
    if (!holdReason.trim()) {
      toast.error(t('billing.schedule.holdReasonRequired', 'A hold reason is required'));
      return;
    }
    const target = holdTarget;
    setHoldTarget(null);
    await run(
      target.schedule_entry_id,
      () => holdScheduleEntry(target.schedule_entry_id, holdReason.trim()),
      'billing.schedule.held', 'Entry held',
    );
    setHoldReason('');
  };

  const renderTriggerCell = (entry: ScheduleEntryView) => {
    if (entry.phase_deleted) {
      return <span className="text-amber-600 dark:text-amber-400">{t('billing.schedule.phaseRemoved', 'Manual · phase removed')}</span>;
    }
    if (entry.trigger_type === 'phase') {
      return entry.phase_name ?? t('billing.schedule.phaseTrigger', 'Phase completion');
    }
    if (entry.trigger_type === 'date') {
      return formatTriggerDate(entry.trigger_date);
    }
    return t('billing.entry.triggerManual', 'Manual');
  };

  const renderSubLine = (entry: ScheduleEntryView) => {
    if (entry.entry_type === 'deposit') {
      return config.deposit_treatment === 'credit'
        ? t('billing.schedule.depositCredit', 'Deposit · applied as credit')
        : t('billing.schedule.depositDeduct', 'Deposit · deducted from final');
    }
    if (entry.trigger_type === 'phase' && entry.phase_name) {
      return t('billing.schedule.phaseSub', 'Phase: {{name}}', { name: entry.phase_name });
    }
    if (entry.trigger_type === 'date') {
      return t('billing.schedule.dateSub', 'On {{date}}', { date: formatTriggerDate(entry.trigger_date) });
    }
    return t('billing.schedule.manualSub', 'Manual trigger');
  };

  const renderActions = (entry: ScheduleEntryView) => {
    if (!canManage) return null;
    const busy = busyId === entry.schedule_entry_id;
    const isManualPending = entry.status === 'pending'
      && (entry.trigger_type === 'manual' || entry.phase_deleted);

    return (
      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
        {entry.status === 'ready' && (
          <>
            {config.invoice_mode === 'standalone' ? (
              <Button
                id={`billing-approve-invoice-${entry.schedule_entry_id}`}
                size="xs"
                disabled={busy}
                onClick={() => run(entry.schedule_entry_id, () => approveAndInvoiceNow(entry.schedule_entry_id), 'billing.schedule.invoiced', 'Invoice generated')}
              >
                {t('billing.schedule.approveInvoice', 'Approve & invoice')}
              </Button>
            ) : (
              <Button
                id={`billing-approve-${entry.schedule_entry_id}`}
                size="xs"
                disabled={busy}
                onClick={() => run(
                  entry.schedule_entry_id,
                  () => approveScheduleEntry(entry.schedule_entry_id),
                  'billing.schedule.approved', 'Entry approved',
                  (result) => { if (result.allocation_warning) toast(result.allocation_warning, { icon: '⚠️' }); },
                )}
              >
                {t('billing.schedule.approve', 'Approve')}
              </Button>
            )}
            <Button
              id={`billing-hold-${entry.schedule_entry_id}`}
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => { setHoldTarget(entry); setHoldReason(''); }}
            >
              {t('billing.schedule.hold', 'Hold')}
            </Button>
          </>
        )}
        {isManualPending && (
          <Button
            id={`billing-mark-ready-${entry.schedule_entry_id}`}
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => run(entry.schedule_entry_id, () => markEntryReady(entry.schedule_entry_id), 'billing.schedule.markedReady', 'Marked ready')}
          >
            {t('billing.schedule.markReady', 'Mark ready')}
          </Button>
        )}
        {entry.status === 'approved' && (
          <Button
            id={`billing-cancel-${entry.schedule_entry_id}`}
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => run(entry.schedule_entry_id, () => cancelScheduleEntry(entry.schedule_entry_id), 'billing.schedule.canceled', 'Entry canceled')}
          >
            {t('common:actions.cancel', 'Cancel')}
          </Button>
        )}
        {entry.status === 'pending' && (
          <>
            <button
              id={`billing-edit-${entry.schedule_entry_id}`}
              type="button"
              disabled={busy}
              onClick={() => openEdit(entry)}
              className="rounded p-1 text-[rgb(var(--color-text-500))] hover:bg-[rgb(var(--color-border-100))]"
              title={t('common:actions.edit', 'Edit')}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              id={`billing-delete-${entry.schedule_entry_id}`}
              type="button"
              disabled={busy}
              onClick={() => run(entry.schedule_entry_id, () => deleteScheduleEntry(entry.schedule_entry_id), 'billing.schedule.deleted', 'Entry deleted')}
              className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
              title={t('common:actions.delete', 'Delete')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    );
  };

  const allocationTone = allocation.delta === 0
    ? 'text-green-700 dark:text-green-400'
    : allocation.delta > 0
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-red-600 dark:text-red-400';
  const allocationMessage = allocation.delta === 0
    ? t('billing.schedule.allocatedFull', '✓ Schedule allocates 100% of contract value')
    : allocation.delta > 0
      ? t('billing.schedule.allocatedUnder', 'Under-allocated by {{amount}} ({{pct}}%)', {
        amount: formatCents(allocation.delta, currency),
        pct: allocation.pct.toFixed(0),
      })
      : t('billing.schedule.allocatedOver', 'Over-allocated by {{amount}}', {
        amount: formatCents(-allocation.delta, currency),
      });

  return (
    <div className="overflow-hidden rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[rgb(var(--color-border-100))] text-left text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">
            <th className="px-3.5 py-2.5" style={{ width: '34%' }}>{t('billing.schedule.milestone', 'Milestone')}</th>
            <th className="px-3.5 py-2.5">{t('billing.schedule.trigger', 'Trigger')}</th>
            <th className="px-3.5 py-2.5 text-right">%</th>
            <th className="px-3.5 py-2.5 text-right">{t('billing.schedule.amount', 'Amount')}</th>
            <th className="px-3.5 py-2.5">{t('billing.schedule.status', 'Status')}</th>
            <th className="px-3.5 py-2.5">{t('billing.schedule.invoice', 'Invoice')}</th>
            <th className="px-3.5 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3.5 py-8 text-center text-sm text-[rgb(var(--color-text-500))]">
                {t('billing.schedule.empty', 'No milestones or deposits yet.')}
              </td>
            </tr>
          ) : (
            entries.map((entry) => {
              const isDeposit = entry.entry_type === 'deposit';
              const highlighted = highlightEntryId === entry.schedule_entry_id;
              return (
                <tr
                  key={entry.schedule_entry_id}
                  id={`billing-schedule-row-${entry.schedule_entry_id}`}
                  className={`border-t border-[rgb(var(--color-border-100))] align-middle text-[13px] ${
                    highlighted ? 'bg-amber-50 dark:bg-amber-500/10' : entry.status === 'ready' ? 'bg-amber-50/40 dark:bg-amber-500/5' : ''
                  }`}
                >
                  <td className={`px-3.5 py-3 ${isDeposit ? 'border-l-2 border-l-blue-400' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[rgb(var(--color-text-900))]">{entry.description}</span>
                      {isDeposit && (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                          {t('billing.schedule.deposit', 'Deposit')}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-[rgb(var(--color-text-500))]">{renderSubLine(entry)}</div>
                  </td>
                  <td className="px-3.5 py-3 text-[rgb(var(--color-text-700))]">{renderTriggerCell(entry)}</td>
                  <td className="px-3.5 py-3 text-right tabular-nums text-[rgb(var(--color-text-700))]">
                    {entry.percentage != null ? `${entry.percentage}%` : '—'}
                  </td>
                  <td className="px-3.5 py-3 text-right font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
                    {formatCents(entry.computed_amount, currency)}
                  </td>
                  <td className="px-3.5 py-3"><StatusChip status={entry.status} /></td>
                  <td className="px-3.5 py-3">
                    {entry.invoice_number && entry.invoice_id ? (
                      <Link
                        id={`billing-invoice-link-${entry.schedule_entry_id}`}
                        href={`/msp/billing?tab=invoicing&invoiceId=${entry.invoice_id}`}
                        className="font-mono text-xs text-primary-600 hover:underline"
                      >
                        {entry.invoice_number}
                      </Link>
                    ) : (
                      <span className="text-[rgb(var(--color-text-400))]">—</span>
                    )}
                  </td>
                  <td className="px-3.5 py-3">{renderActions(entry)}</td>
                </tr>
              );
            })
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-100))] text-[12px]">
            <td colSpan={3} className={`px-3.5 py-2.5 font-semibold ${allocationTone}`}>{allocationMessage}</td>
            <td className="px-3.5 py-2.5 text-right font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
              {formatCents(allocation.total, currency)}
            </td>
            <td colSpan={3} className="px-3.5 py-2.5 text-right">
              {canManage && (
                <Button id="billing-add-entry" variant="ghost" size="xs" onClick={openAdd}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t('billing.schedule.addEntry', 'Add milestone or deposit')}
                </Button>
              )}
            </td>
          </tr>
        </tfoot>
      </table>

      {dialogOpen && (
        <ScheduleEntryDialog
          configId={config.config_id}
          currency={currency}
          phases={phases}
          entry={dialogEntry}
          onClose={() => setDialogOpen(false)}
          onSaved={() => { setDialogOpen(false); onChanged(); }}
        />
      )}

      {holdTarget && (
        <Dialog isOpen onClose={() => setHoldTarget(null)} id="billing-hold-dialog" title={t('billing.schedule.holdTitle', 'Hold entry')}>
          <DialogContent>
            <Label htmlFor="billing-hold-reason">{t('billing.schedule.holdReason', 'Reason')}</Label>
            <Input
              id="billing-hold-reason"
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
              placeholder={t('billing.schedule.holdReasonPlaceholder', 'Why is this entry being held?')}
            />
          </DialogContent>
          <DialogFooter>
            <Button id="billing-hold-cancel" variant="outline" onClick={() => setHoldTarget(null)}>
              {t('common:actions.cancel', 'Cancel')}
            </Button>
            <Button id="billing-hold-confirm" onClick={submitHold}>
              {t('billing.schedule.hold', 'Hold')}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}
