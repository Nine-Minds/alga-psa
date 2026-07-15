'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { CheckCircle, MoreVertical, PauseCircle, Receipt, XCircle } from 'lucide-react';
import type { ColumnDefinition } from '@alga-psa/types';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useRangeSelection } from '@alga-psa/ui/hooks';
import { getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import { toPlainDate } from '@alga-psa/core';
import {
  approveScheduleEntry,
  approveAndInvoiceNow,
  holdScheduleEntry,
  cancelScheduleEntry,
  bulkApproveEntries,
  bulkHoldEntries,
  listReadyScheduleEntries,
} from '@alga-psa/billing/actions/projectBillingScheduleActions';
import type { ReadyQueueRow } from '@alga-psa/billing/actions/projectBillingConfigActions';

interface ProjectBillingReviewTabProps {
  onRefreshNeeded: () => void;
  refreshTrigger: number;
}

interface HoldDialogState {
  isOpen: boolean;
  entryIds: string[];
}

const ProjectBillingReviewTab: React.FC<ProjectBillingReviewTabProps> = ({
  onRefreshNeeded,
  refreshTrigger,
}) => {
  const { t } = useTranslation('msp/invoicing');
  const { formatCurrency, formatDate } = useFormatters();

  const [rows, setRows] = useState<ReadyQueueRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [holdDialog, setHoldDialog] = useState<HoldDialogState>({ isOpen: false, entryIds: [] });
  const [holdReason, setHoldReason] = useState('');
  const [cancelEntryId, setCancelEntryId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queue = await listReadyScheduleEntries();
      setRows(queue);
      // Drop selections for rows that are no longer ready (approved/held/canceled elsewhere).
      setSelected((prev) => {
        const stillPresent = new Set(queue.map((row) => row.entry.schedule_entry_id));
        const next = new Set<string>();
        prev.forEach((id) => {
          if (stillPresent.has(id)) next.add(id);
        });
        return next;
      });
    } catch (err) {
      console.error('Failed to load project billing review queue:', err);
      setError(t('projectBilling.errors.loadFailed', {
        defaultValue: 'Failed to load the project billing review queue. Please try again.',
      }));
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  // Every mutation reloads the queue and asks the hub to refresh the tab badge count.
  const afterMutation = useCallback(async () => {
    await loadData();
    onRefreshNeeded();
  }, [loadData, onRefreshNeeded]);

  const rangeSelect = useRangeSelection<ReadyQueueRow>({
    items: rows,
    getId: (row) => row.entry.schedule_entry_id,
    selectedIds: selected,
    onSelectedIdsChange: setSelected,
  });

  const handleSelectAll = (checked: boolean) => {
    setSelected(checked ? new Set(rows.map((row) => row.entry.schedule_entry_id)) : new Set());
  };

  const triggerLabel = useCallback((row: ReadyQueueRow): string => {
    const entry = row.entry;
    if (entry.trigger_type === 'phase' && entry.phase_name) {
      const readyAt = entry.ready_at ? formatDate(toPlainDate(entry.ready_at).toString()) : '';
      return t('projectBilling.trigger.phase', {
        phase: entry.phase_name,
        date: readyAt,
        defaultValue: 'Phase {{phase}} completed {{date}}',
      });
    }
    if (entry.trigger_type === 'date') {
      return t('projectBilling.trigger.date', { defaultValue: 'Date reached' });
    }
    return t('projectBilling.trigger.manual', { defaultValue: 'Manual' });
  }, [formatDate, t]);

  const handleApprove = async (entryId: string) => {
    setIsBusy(true);
    try {
      const result = await approveScheduleEntry(entryId);
      if (result.allocation_warning) {
        toast.success(t('projectBilling.toasts.approvedWithWarning', {
          warning: result.allocation_warning,
          defaultValue: 'Entry approved. {{warning}}',
        }));
      } else {
        toast.success(t('projectBilling.toasts.approved', { defaultValue: 'Entry approved.' }));
      }
      await afterMutation();
    } catch (err) {
      toast.error(getErrorMessage(err) || t('projectBilling.errors.approveFailed', {
        defaultValue: 'Failed to approve the entry.',
      }));
    } finally {
      setIsBusy(false);
    }
  };

  const handleApproveInvoiceNow = async (entryId: string) => {
    setIsBusy(true);
    try {
      await approveAndInvoiceNow(entryId);
      toast.success(t('projectBilling.toasts.invoiced', {
        defaultValue: 'Entry approved and invoiced.',
      }));
      await afterMutation();
    } catch (err) {
      toast.error(getErrorMessage(err) || t('projectBilling.errors.invoiceFailed', {
        defaultValue: 'Failed to approve and invoice the entry.',
      }));
    } finally {
      setIsBusy(false);
    }
  };

  const handleBulkApprove = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setIsBusy(true);
    try {
      const { approved, failed } = await bulkApproveEntries(ids);
      if (approved.length > 0) {
        toast.success(t('projectBilling.toasts.bulkApproved', {
          count: approved.length,
          defaultValue: '{{count}} entries approved.',
        }));
      }
      if (failed.length > 0) {
        toast.error(t('projectBilling.toasts.bulkApproveFailed', {
          count: failed.length,
          reason: failed[0].error,
          defaultValue: '{{count}} entries could not be approved (e.g. {{reason}}).',
        }));
      }
      await afterMutation();
    } catch (err) {
      toast.error(getErrorMessage(err) || t('projectBilling.errors.approveFailed', {
        defaultValue: 'Failed to approve the entry.',
      }));
    } finally {
      setIsBusy(false);
    }
  };

  const openHoldDialog = (entryIds: string[]) => {
    setHoldReason('');
    setHoldDialog({ isOpen: true, entryIds });
  };

  const closeHoldDialog = () => {
    setHoldDialog({ isOpen: false, entryIds: [] });
    setHoldReason('');
  };

  const handleHoldConfirm = async () => {
    const ids = holdDialog.entryIds;
    const reason = holdReason.trim();
    if (ids.length === 0 || !reason) return;
    setIsConfirming(true);
    try {
      if (ids.length === 1) {
        await holdScheduleEntry(ids[0], reason);
        toast.success(t('projectBilling.toasts.held', { defaultValue: 'Entry placed on hold.' }));
      } else {
        const { held, failed } = await bulkHoldEntries(ids, reason);
        if (held.length > 0) {
          toast.success(t('projectBilling.toasts.bulkHeld', {
            count: held.length,
            defaultValue: '{{count}} entries placed on hold.',
          }));
        }
        if (failed.length > 0) {
          toast.error(t('projectBilling.toasts.bulkHoldFailed', {
            count: failed.length,
            reason: failed[0].error,
            defaultValue: '{{count}} entries could not be held (e.g. {{reason}}).',
          }));
        }
      }
      closeHoldDialog();
      await afterMutation();
    } catch (err) {
      toast.error(getErrorMessage(err) || t('projectBilling.errors.holdFailed', {
        defaultValue: 'Failed to place the entry on hold.',
      }));
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancelConfirm = async () => {
    if (!cancelEntryId) return;
    setIsConfirming(true);
    try {
      await cancelScheduleEntry(cancelEntryId);
      toast.success(t('projectBilling.toasts.canceled', { defaultValue: 'Entry canceled.' }));
      setCancelEntryId(null);
      await afterMutation();
    } catch (err) {
      toast.error(getErrorMessage(err) || t('projectBilling.errors.cancelFailed', {
        defaultValue: 'Failed to cancel the entry.',
      }));
    } finally {
      setIsConfirming(false);
    }
  };

  const columns: ColumnDefinition<ReadyQueueRow>[] = useMemo(() => [
    {
      title: (
        <div className="flex items-center">
          <Checkbox
            id="select-all-project-billing"
            checked={selected.size > 0 && selected.size === rows.length}
            onChange={(e) => handleSelectAll((e.target as HTMLInputElement).checked)}
          />
        </div>
      ),
      dataIndex: ['entry', 'schedule_entry_id'],
      width: '50px',
      render: (_, record) => (
        <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            id={`project-billing-select-${record.entry.schedule_entry_id}`}
            checked={rangeSelect.isSelected(record.entry.schedule_entry_id)}
            onClick={(event: React.MouseEvent<HTMLInputElement>) => {
              event.stopPropagation();
              const isChecked = rangeSelect.isSelected(record.entry.schedule_entry_id);
              rangeSelect.handleSelect(record.entry.schedule_entry_id, {
                shiftKey: event.shiftKey,
                selected: !isChecked,
                preventDefault: () => event.preventDefault(),
              });
              event.preventDefault();
            }}
            onChange={() => { /* controlled via onClick for shift-range support */ }}
          />
        </div>
      ),
    },
    {
      title: t('projectBilling.columns.project', { defaultValue: 'Project' }),
      dataIndex: 'project_name',
      render: (_, record) => (
        <Link
          id={`project-billing-project-link-${record.entry.schedule_entry_id}`}
          href={`/msp/projects/${record.project_id}?view=billing`}
          className="text-blue-600 hover:text-blue-800"
        >
          <span className="font-medium">{record.project_name}</span>
          {record.project_number && (
            <span className="ml-1 text-xs text-muted-foreground">#{record.project_number}</span>
          )}
        </Link>
      ),
    },
    {
      title: t('projectBilling.columns.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
    },
    {
      title: t('projectBilling.columns.description', { defaultValue: 'Description' }),
      dataIndex: ['entry', 'description'],
      render: (_, record) => record.entry.description,
    },
    {
      title: t('projectBilling.columns.amount', { defaultValue: 'Amount' }),
      dataIndex: ['entry', 'computed_amount'],
      render: (_, record) => formatCurrency(record.entry.computed_amount / 100, record.currency ?? 'USD', {
        minimumFractionDigits: 2,
      }),
    },
    {
      title: t('projectBilling.columns.trigger', { defaultValue: 'Trigger' }),
      dataIndex: ['entry', 'trigger_type'],
      render: (_, record) => triggerLabel(record),
    },
    {
      title: t('projectBilling.columns.daysWaiting', { defaultValue: 'Days waiting' }),
      dataIndex: 'days_waiting',
      render: (_, record) => record.days_waiting,
    },
    {
      title: t('projectBilling.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: ['entry', 'schedule_entry_id'],
      width: '5%',
      render: (_, record) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`project-billing-row-actions-${record.entry.schedule_entry_id}`}
                variant="ghost"
                className="h-8 w-8 p-0"
                disabled={isBusy}
                aria-label={t('common.actions.openMenu', { defaultValue: 'Open menu' })}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id={`project-billing-approve-${record.entry.schedule_entry_id}`}
                onClick={() => handleApprove(record.entry.schedule_entry_id)}
                className="flex items-center gap-2"
              >
                <CheckCircle className="h-4 w-4" />
                {t('projectBilling.actions.approve', { defaultValue: 'Approve' })}
              </DropdownMenuItem>
              {record.invoice_mode === 'standalone' && (
                <DropdownMenuItem
                  id={`project-billing-approve-invoice-${record.entry.schedule_entry_id}`}
                  onClick={() => handleApproveInvoiceNow(record.entry.schedule_entry_id)}
                  className="flex items-center gap-2"
                >
                  <Receipt className="h-4 w-4" />
                  {t('projectBilling.actions.approveInvoiceNow', { defaultValue: 'Approve & invoice now' })}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                id={`project-billing-hold-${record.entry.schedule_entry_id}`}
                onClick={() => openHoldDialog([record.entry.schedule_entry_id])}
                className="flex items-center gap-2"
              >
                <PauseCircle className="h-4 w-4" />
                {t('projectBilling.actions.hold', { defaultValue: 'Hold' })}
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`project-billing-cancel-${record.entry.schedule_entry_id}`}
                onClick={() => setCancelEntryId(record.entry.schedule_entry_id)}
                className="flex items-center gap-2 text-red-600 focus:text-red-600"
              >
                <XCircle className="h-4 w-4" />
                {t('projectBilling.actions.cancel', { defaultValue: 'Cancel' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ], [formatCurrency, isBusy, rangeSelect, rows.length, selected.size, t, triggerLabel]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {t('projectBilling.subtitle', {
            defaultValue: 'Ready milestones and deposits awaiting approval across all projects.',
          })}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="project-billing-bulk-actions-trigger"
              variant="outline"
              disabled={selected.size === 0 || isBusy}
              className="flex items-center gap-2"
            >
              {t('projectBilling.bulkActions', {
                count: selected.size,
                defaultValue: 'Actions ({{count}})',
              })}
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id="project-billing-bulk-approve"
              onClick={handleBulkApprove}
              className="flex items-center gap-2"
            >
              <CheckCircle className="h-4 w-4" />
              {t('projectBilling.actions.approveSelected', { defaultValue: 'Approve selected' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="project-billing-bulk-hold"
              onClick={() => openHoldDialog(Array.from(selected))}
              className="flex items-center gap-2"
            >
              <PauseCircle className="h-4 w-4" />
              {t('projectBilling.actions.holdSelected', { defaultValue: 'Hold selected' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <Card>
          <div className="p-12 flex items-center justify-center">
            <LoadingIndicator
              text={t('projectBilling.loading', { defaultValue: 'Loading project billing queue...' })}
              spinnerProps={{ size: 'md' }}
              layout="stacked"
              textClassName="text-muted-foreground"
            />
          </div>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t('projectBilling.empty', {
              defaultValue: 'Nothing is waiting for review. Ready milestones and deposits will appear here.',
            })}
          </div>
        </Card>
      ) : (
        <DataTable
          id="project-billing-review-table"
          data={rows}
          columns={columns}
          pagination
        />
      )}

      <Dialog
        id="project-billing-hold-dialog"
        isOpen={holdDialog.isOpen}
        onClose={closeHoldDialog}
        title={holdDialog.entryIds.length > 1
          ? t('projectBilling.holdDialog.titlePlural', {
              count: holdDialog.entryIds.length,
              defaultValue: 'Hold {{count}} entries',
            })
          : t('projectBilling.holdDialog.title', { defaultValue: 'Hold entry' })}
      >
        <DialogContent>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('projectBilling.holdDialog.description', {
                defaultValue: 'Holding returns the entry to pending until it is made ready again. A reason is required.',
              })}
            </p>
            <TextArea
              id="project-billing-hold-reason"
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
              placeholder={t('projectBilling.holdDialog.reasonPlaceholder', {
                defaultValue: 'Reason for holding...',
              })}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              id="project-billing-hold-cancel"
              variant="ghost"
              onClick={closeHoldDialog}
              disabled={isConfirming}
            >
              {t('projectBilling.holdDialog.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="project-billing-hold-confirm"
              onClick={handleHoldConfirm}
              disabled={isConfirming || !holdReason.trim()}
            >
              {t('projectBilling.holdDialog.confirm', { defaultValue: 'Hold' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        id="project-billing-cancel-confirmation"
        isOpen={cancelEntryId !== null}
        onClose={() => setCancelEntryId(null)}
        onConfirm={handleCancelConfirm}
        title={t('projectBilling.cancelDialog.title', { defaultValue: 'Cancel entry' })}
        message={t('projectBilling.cancelDialog.message', {
          defaultValue: 'Canceling this schedule entry removes it from billing. This cannot be undone.',
        })}
        confirmLabel={t('projectBilling.cancelDialog.confirm', { defaultValue: 'Cancel entry' })}
        cancelLabel={t('projectBilling.cancelDialog.dismiss', { defaultValue: 'Keep entry' })}
        isConfirming={isConfirming}
      />
    </div>
  );
};

export default ProjectBillingReviewTab;
