'use client';

import React, { useMemo, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  listRenewalQueueRows,
  markRenewalQueueItemNonRenewing,
  markRenewalQueueItemRenewing,
  type RenewalQueueAction,
  type RenewalQueueRow,
} from '@alga-psa/billing/actions/renewalsQueueActions';

const DEFAULT_HORIZON_DAYS = 90;
type RenewalBucket = 'all' | '0-30' | '31-60' | '61-90';
type RenewalStatus = 'all' | 'pending' | 'renewing' | 'non_renewing' | 'snoozed' | 'completed';
type RenewalModeFilter = 'all' | 'none' | 'manual' | 'auto';
type ContractTypeFilter = 'all' | 'fixed-term' | 'evergreen';
type PendingRowAction = Extract<RenewalQueueAction, 'mark_renewing' | 'mark_non_renewing'>;

const getAvailableActionsForStatus = (status: RenewalQueueRow['status']): RenewalQueueAction[] => {
  if (status === 'pending') {
    return ['mark_renewing', 'mark_non_renewing', 'create_renewal_draft', 'snooze', 'assign_owner'];
  }
  if (status === 'renewing') {
    return ['create_renewal_draft', 'snooze', 'assign_owner'];
  }
  if (status === 'snoozed') {
    return ['mark_renewing', 'mark_non_renewing', 'create_renewal_draft', 'assign_owner'];
  }
  return ['assign_owner'];
};

interface RenewalsQueueTabProps {
  onQueueMutationComplete?: () => void;
}

export default function RenewalsQueueTab({ onQueueMutationComplete }: RenewalsQueueTabProps) {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<RenewalQueueRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<RenewalBucket>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<RenewalStatus>('all');
  const [renewalModeFilter, setRenewalModeFilter] = useState<RenewalModeFilter>('all');
  const [contractTypeFilter, setContractTypeFilter] = useState<ContractTypeFilter>('all');
  const [pendingRowActions, setPendingRowActions] = useState<Record<string, PendingRowAction | undefined>>({});

  useEffect(() => {
    const bucketParam = searchParams?.get('bucket');
    if (bucketParam === '0-30' || bucketParam === '31-60' || bucketParam === '61-90' || bucketParam === 'all') {
      setBucket(bucketParam);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    const loadRows = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await listRenewalQueueRows();
        if (!cancelled) {
          setRows(result);
          onQueueMutationComplete?.();
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load renewal queue rows');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadRows();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshRowsAfterMutation = async () => {
    const result = await listRenewalQueueRows();
    setRows(result);
    onQueueMutationComplete?.();
  };

  const handleMarkRenewing = async (row: RenewalQueueRow) => {
    const rowId = row.client_contract_id;
    setPendingRowActions((current) => ({ ...current, [rowId]: 'mark_renewing' }));
    setRows((current) =>
      current.map((candidate) =>
        candidate.client_contract_id === rowId
          ? {
              ...candidate,
              status: 'renewing',
              available_actions: getAvailableActionsForStatus('renewing'),
            }
          : candidate
      )
    );

    try {
      const result = await markRenewalQueueItemRenewing(rowId);
      setRows((current) =>
        current.map((candidate) =>
          candidate.client_contract_id === rowId
            ? {
                ...candidate,
                status: result.status,
                available_actions: getAvailableActionsForStatus(result.status),
              }
            : candidate
        )
      );
      await refreshRowsAfterMutation();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to update renewal status');
      await refreshRowsAfterMutation();
    } finally {
      setPendingRowActions((current) => ({ ...current, [rowId]: undefined }));
    }
  };

  const handleMarkNonRenewing = async (row: RenewalQueueRow) => {
    const rowId = row.client_contract_id;
    setPendingRowActions((current) => ({ ...current, [rowId]: 'mark_non_renewing' }));
    setRows((current) =>
      current.map((candidate) =>
        candidate.client_contract_id === rowId
          ? {
              ...candidate,
              status: 'non_renewing',
              available_actions: getAvailableActionsForStatus('non_renewing'),
            }
          : candidate
      )
    );

    try {
      const result = await markRenewalQueueItemNonRenewing(rowId);
      setRows((current) =>
        current.map((candidate) =>
          candidate.client_contract_id === rowId
            ? {
                ...candidate,
                status: result.status,
                available_actions: getAvailableActionsForStatus(result.status),
              }
            : candidate
        )
      );
      await refreshRowsAfterMutation();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to update renewal status');
      await refreshRowsAfterMutation();
    } finally {
      setPendingRowActions((current) => ({ ...current, [rowId]: undefined }));
    }
  };

  const ownerOptions = useMemo(() => {
    const uniqueOwners = Array.from(
      new Set(rows.map((row) => row.assigned_to ?? 'unassigned'))
    );
    return ['all', ...uniqueOwners];
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const rowOwner = row.assigned_to ?? 'unassigned';
      if (ownerFilter !== 'all' && rowOwner !== ownerFilter) {
        return false;
      }
      if (statusFilter !== 'all' && row.status !== statusFilter) {
        return false;
      }
      if (renewalModeFilter !== 'all' && row.effective_renewal_mode !== renewalModeFilter) {
        return false;
      }
      if (contractTypeFilter !== 'all' && row.contract_type !== contractTypeFilter) {
        return false;
      }

      if (bucket === 'all') {
        return true;
      }

      if (typeof row.days_until_due !== 'number') return false;
      if (bucket === '0-30') return row.days_until_due >= 0 && row.days_until_due <= 30;
      if (bucket === '31-60') return row.days_until_due >= 31 && row.days_until_due <= 60;
      return row.days_until_due >= 61 && row.days_until_due <= 90;
    });
  }, [bucket, contractTypeFilter, ownerFilter, renewalModeFilter, rows, statusFilter]);

  const getDueState = (daysUntilDue: number | undefined): 'overdue' | 'due-soon' | 'upcoming' => {
    if (typeof daysUntilDue !== 'number') return 'upcoming';
    if (daysUntilDue < 0) return 'overdue';
    if (daysUntilDue <= 7) return 'due-soon';
    return 'upcoming';
  };

  return (
    <section
      data-testid="renewals-queue-page"
      className="space-y-4 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-100))] p-4"
    >
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Renewals</h2>
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          Track upcoming contract renewal decisions and take action from a single queue.
        </p>
        <p className="text-xs text-[rgb(var(--color-text-400))]">
          Showing contracts due within the next {DEFAULT_HORIZON_DAYS} days.
        </p>
      </header>

      <div
        data-testid="renewals-queue-content"
        className="rounded-md border border-dashed border-[rgb(var(--color-border-200))] p-4 text-sm text-[rgb(var(--color-text-500))]"
      >
        <div className="mb-3 flex flex-wrap gap-2" data-testid="renewals-bucket-filters">
          {(['all', '0-30', '31-60', '61-90'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setBucket(value)}
              className={`rounded border px-2 py-1 text-xs ${
                bucket === value
                  ? 'border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-bg-0))] text-[rgb(var(--color-text-900))]'
                  : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-100))] text-[rgb(var(--color-text-500))]'
              }`}
            >
              {value === 'all' ? 'All' : `${value} Days`}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-xs text-[rgb(var(--color-text-500))]">
            Owner
            <select
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              data-testid="renewals-owner-filter"
              className="rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-0))] px-2 py-1 text-xs"
            >
              {ownerOptions.map((owner) => (
                <option key={owner} value={owner}>
                  {owner === 'all' ? 'All Owners' : owner}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-500))]">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as RenewalStatus)}
              data-testid="renewals-status-filter"
              className="rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-0))] px-2 py-1 text-xs"
            >
              {(['all', 'pending', 'renewing', 'non_renewing', 'snoozed', 'completed'] as const).map((status) => (
                <option key={status} value={status}>
                  {status === 'all' ? 'All Statuses' : status}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-500))]">
            Renewal Mode
            <select
              value={renewalModeFilter}
              onChange={(event) => setRenewalModeFilter(event.target.value as RenewalModeFilter)}
              data-testid="renewals-mode-filter"
              className="rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-0))] px-2 py-1 text-xs"
            >
              {(['all', 'none', 'manual', 'auto'] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {mode === 'all' ? 'All Modes' : mode}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-500))]">
            Contract Type
            <select
              value={contractTypeFilter}
              onChange={(event) => setContractTypeFilter(event.target.value as ContractTypeFilter)}
              data-testid="renewals-contract-type-filter"
              className="rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-0))] px-2 py-1 text-xs"
            >
              {(['all', 'fixed-term', 'evergreen'] as const).map((type) => (
                <option key={type} value={type}>
                  {type === 'all' ? 'All Contract Types' : type}
                </option>
              ))}
            </select>
          </label>
        </div>
        {isLoading && <p>Loading renewal queue...</p>}
        {!isLoading && error && <p>{error}</p>}
        {!isLoading && !error && filteredRows.length === 0 && <p>No upcoming renewals found.</p>}
        {!isLoading && !error && filteredRows.length > 0 && (
          <div className="space-y-2">
            {filteredRows.map((row) => (
              <div
                key={`${row.client_contract_id}:${row.renewal_cycle_key ?? row.decision_due_date ?? row.contract_id}`}
                data-testid="renewals-queue-row"
                className="rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-0))] p-3"
              >
                {pendingRowActions[row.client_contract_id] && (
                  <p
                    data-testid="renewals-row-action-pending"
                    className="mb-1 text-[11px] font-medium text-[rgb(var(--color-text-500))]"
                  >
                    Updating action...
                  </p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{row.contract_name ?? row.contract_id}</p>
                  <span
                    data-testid="renewals-days-badge"
                    className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                      getDueState(row.days_until_due) === 'overdue'
                        ? 'bg-[rgb(var(--color-danger-100))] text-[rgb(var(--color-danger-700))]'
                        : getDueState(row.days_until_due) === 'due-soon'
                          ? 'bg-[rgb(var(--color-warning-100))] text-[rgb(var(--color-warning-700))]'
                          : 'bg-[rgb(var(--color-info-100))] text-[rgb(var(--color-info-700))]'
                    }`}
                  >
                    {getDueState(row.days_until_due) === 'overdue'
                      ? `Overdue by ${Math.abs(row.days_until_due ?? 0)}d`
                      : `${row.days_until_due ?? 0}d`}
                  </span>
                </div>
                <p className="text-xs text-[rgb(var(--color-text-500))]">
                  {row.client_name ?? row.client_id} • due {row.decision_due_date ?? 'n/a'}
                </p>
                <p
                  data-testid="renewals-queue-row-available-actions"
                  className="mt-1 text-[11px] text-[rgb(var(--color-text-400))]"
                >
                  Actions: {row.available_actions.join(', ')}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  {row.available_actions.includes('mark_renewing') && (
                    <button
                      type="button"
                      data-testid="renewals-row-action-mark-renewing"
                      disabled={Boolean(pendingRowActions[row.client_contract_id])}
                      onClick={() => handleMarkRenewing(row)}
                      className="rounded border border-[rgb(var(--color-border-200))] px-2 py-1 text-[11px] disabled:opacity-50"
                    >
                      Mark renewing
                    </button>
                  )}
                  {row.available_actions.includes('mark_non_renewing') && (
                    <button
                      type="button"
                      data-testid="renewals-row-action-mark-non-renewing"
                      disabled={Boolean(pendingRowActions[row.client_contract_id])}
                      onClick={() => handleMarkNonRenewing(row)}
                      className="rounded border border-[rgb(var(--color-border-200))] px-2 py-1 text-[11px] disabled:opacity-50"
                    >
                      Mark non-renewing
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
