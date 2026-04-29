'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Clock, ChevronDown, ChevronRight, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { useSchedulingCallbacks } from '@alga-psa/ui/context';
import { formatMinutesAsHoursAndMinutes, formatDateTime, utcToLocal, getUserTimeZone } from '@alga-psa/core';
import type {
  TicketTimeEntriesSummary,
  TicketTimeEntrySummaryEntry,
} from '@alga-psa/types';

interface TicketTimeEntriesProps {
  id?: string;
  ticketId: string;
  currentUserId: string;
  dateTimeFormat?: string;
  /**
   * Increment this value to force the panel to re-fetch (e.g. after a new entry is saved).
   */
  refreshKey?: number;
  /**
   * Edit/delete are only ever exposed for entries owned by the current user.
   */
  onEditEntry?: (entry: TicketTimeEntrySummaryEntry) => void;
  onDeleteEntry?: (entry: TicketTimeEntrySummaryEntry) => void;
}

const APPROVAL_STATUS_LABEL_KEYS: Record<string, string> = {
  DRAFT: 'timeEntries.statusDraft',
  SUBMITTED: 'timeEntries.statusSubmitted',
  APPROVED: 'timeEntries.statusApproved',
  CHANGES_REQUESTED: 'timeEntries.statusChangesRequested',
};

const APPROVAL_STATUS_FALLBACK: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes Requested',
};

const APPROVAL_STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  DRAFT: 'default-muted',
  SUBMITTED: 'secondary',
  APPROVED: 'success',
  CHANGES_REQUESTED: 'warning',
};

const TicketTimeEntries: React.FC<TicketTimeEntriesProps> = ({
  id,
  ticketId,
  currentUserId,
  dateTimeFormat = 'MMM d, yyyy h:mm a',
  refreshKey = 0,
  onEditEntry,
  onDeleteEntry,
}) => {
  const { t } = useTranslation('features/tickets');
  const { fetchTimeEntriesForTicket } = useSchedulingCallbacks();
  const [summary, setSummary] = useState<TicketTimeEntriesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMine, setShowMine] = useState(true);
  const [showOthers, setShowOthers] = useState(false);
  const userTimeZone = useMemo(() => getUserTimeZone(), []);
  const durationLabels = useMemo(
    () => ({
      hr: t('timeEntries.duration.hr', 'hr'),
      hrs: t('timeEntries.duration.hrs', 'hrs'),
      min: t('timeEntries.duration.min', 'min'),
    }),
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    if (!ticketId) {
      setSummary(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    fetchTimeEntriesForTicket(ticketId)
      .then((result) => {
        if (cancelled) return;
        setSummary(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ticketId, refreshKey, fetchTimeEntriesForTicket]);

  const myEntries = useMemo(
    () => (summary?.entries ?? []).filter((entry) => entry.user_id === currentUserId),
    [summary?.entries, currentUserId],
  );
  const otherEntries = useMemo(
    () => (summary?.entries ?? []).filter((entry) => entry.user_id !== currentUserId),
    [summary?.entries, currentUserId],
  );

  if (loading) {
    return (
      <div
        {...withDataAutomationId({ id: `${id}-time-entries-loading` })}
        className="text-sm text-muted-foreground py-2"
      >
        {t('timeEntries.loading', 'Loading time entries…')}
      </div>
    );
  }

  if (error) {
    return (
      <div
        {...withDataAutomationId({ id: `${id}-time-entries-error` })}
        className="text-sm text-red-600 py-2"
      >
        {t('timeEntries.loadError', 'Could not load time entries')}
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  const hasAnyEntries =
    summary.ownEntryCount > 0 || summary.othersEntryCount > 0;

  return (
    <div
      {...withDataAutomationId({ id: `${id}-time-entries` })}
      className="border-t pt-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Clock className="w-4 h-4 text-[rgb(var(--color-text-700))]" />
          {t('timeEntries.title', 'Logged Time')}
        </h3>
        <span
          {...withDataAutomationId({ id: `${id}-time-entries-total` })}
          className="text-sm font-semibold text-[rgb(var(--color-text-900))]"
        >
          {formatMinutesAsHoursAndMinutes(summary.totalMinutes, durationLabels)}
        </span>
      </div>

      {!hasAnyEntries && (
        <p
          {...withDataAutomationId({ id: `${id}-time-entries-empty` })}
          className="text-sm text-muted-foreground"
        >
          {t('timeEntries.empty', 'No time has been logged on this ticket yet.')}
        </p>
      )}

      {summary.ownEntryCount > 0 && (
        <div {...withDataAutomationId({ id: `${id}-time-entries-mine` })}>
          <button
            {...withDataAutomationId({ id: `${id}-time-entries-mine-toggle` })}
            type="button"
            className="w-full flex items-center justify-between text-sm font-medium text-[rgb(var(--color-text-800))] hover:text-[rgb(var(--color-text-900))]"
            onClick={() => setShowMine((value) => !value)}
            aria-expanded={showMine}
          >
            <span className="flex items-center gap-1">
              {showMine ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              {t('timeEntries.myEntries', 'My entries')}{' '}
              <span className="text-muted-foreground">({summary.ownEntryCount})</span>
            </span>
            <span className="text-muted-foreground">
              {formatMinutesAsHoursAndMinutes(summary.ownTotalMinutes, durationLabels)}
            </span>
          </button>

          {showMine && (
            <ul className="mt-2 space-y-2">
              {myEntries.map((entry) => (
                <TimeEntryRow
                  key={entry.entry_id}
                  id={`${id}-mine-${entry.entry_id}`}
                  entry={entry}
                  dateTimeFormat={dateTimeFormat}
                  timeZone={userTimeZone}
                  showUserName={false}
                  durationLabels={durationLabels}
                  onEdit={onEditEntry}
                  onDelete={onDeleteEntry}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {summary.othersVisibleCount > 0 && (
        <div {...withDataAutomationId({ id: `${id}-time-entries-others` })}>
          <button
            {...withDataAutomationId({ id: `${id}-time-entries-others-toggle` })}
            type="button"
            className="w-full flex items-center justify-between text-sm font-medium text-[rgb(var(--color-text-800))] hover:text-[rgb(var(--color-text-900))]"
            onClick={() => setShowOthers((value) => !value)}
            aria-expanded={showOthers}
          >
            <span className="flex items-center gap-1">
              {showOthers ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              {t('timeEntries.otherTeam', 'Other team members')}{' '}
              <span className="text-muted-foreground">({summary.othersVisibleCount})</span>
            </span>
            <span className="text-muted-foreground">
              {formatMinutesAsHoursAndMinutes(summary.othersVisibleMinutes, durationLabels)}
            </span>
          </button>

          {showOthers && (
            <ul className="mt-2 space-y-2">
              {otherEntries.map((entry) => (
                <TimeEntryRow
                  key={entry.entry_id}
                  id={`${id}-other-${entry.entry_id}`}
                  entry={entry}
                  dateTimeFormat={dateTimeFormat}
                  timeZone={userTimeZone}
                  showUserName
                  durationLabels={durationLabels}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {summary.othersHiddenCount > 0 && (
        <div
          {...withDataAutomationId({ id: `${id}-time-entries-others-anonymized` })}
          className="rounded-md border border-dashed border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-bg-50))] px-3 py-2 text-sm text-muted-foreground flex items-center gap-2"
        >
          <EyeOff className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            {t(
              'timeEntries.othersAnonymized',
              '{{count}} entries by other team members ({{duration}})',
              {
                count: summary.othersHiddenCount,
                duration: formatMinutesAsHoursAndMinutes(summary.othersHiddenMinutes, durationLabels),
              },
            )}
          </span>
        </div>
      )}
    </div>
  );
};

interface TimeEntryRowProps {
  id?: string;
  entry: TicketTimeEntrySummaryEntry;
  dateTimeFormat: string;
  timeZone: string;
  showUserName: boolean;
  durationLabels?: { hr?: string; hrs?: string; min?: string };
  onEdit?: (entry: TicketTimeEntrySummaryEntry) => void;
  onDelete?: (entry: TicketTimeEntrySummaryEntry) => void;
}

const TimeEntryRow: React.FC<TimeEntryRowProps> = ({
  id,
  entry,
  dateTimeFormat,
  timeZone,
  showUserName,
  durationLabels,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation('features/tickets');
  const startLabel = useMemo(() => {
    try {
      return formatDateTime(utcToLocal(entry.start_time, timeZone), timeZone, dateTimeFormat);
    } catch {
      return entry.start_time;
    }
  }, [entry.start_time, timeZone, dateTimeFormat]);

  const statusKey = entry.approval_status ?? 'DRAFT';
  const statusLabel = t(
    APPROVAL_STATUS_LABEL_KEYS[statusKey] ?? 'timeEntries.statusUnknown',
    APPROVAL_STATUS_FALLBACK[statusKey] ?? statusKey,
  );
  const canEdit = entry.is_own && Boolean(onEdit) && (statusKey === 'DRAFT' || statusKey === 'CHANGES_REQUESTED');
  const canDelete = entry.is_own && Boolean(onDelete) && (statusKey === 'DRAFT' || statusKey === 'CHANGES_REQUESTED');

  return (
    <li
      {...withDataAutomationId({ id })}
      className="text-sm rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-50))] px-3 py-2 space-y-1"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-[rgb(var(--color-text-900))]">
          {showUserName
            ? entry.user_name || t('timeEntries.unknownUser', 'Unknown user')
            : startLabel}
        </span>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              {...withDataAutomationId({ id: `${id}-edit` })}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEdit?.(entry);
              }}
              className="p-1 rounded hover:bg-[rgb(var(--color-bg-100))] text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-text-900))]"
              aria-label={t('timeEntries.edit', 'Edit time entry')}
              title={t('timeEntries.edit', 'Edit time entry')}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {canDelete && (
            <button
              {...withDataAutomationId({ id: `${id}-delete` })}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete?.(entry);
              }}
              className="p-1 rounded hover:bg-red-50 text-[rgb(var(--color-text-600))] hover:text-red-600"
              aria-label={t('timeEntries.delete', 'Delete time entry')}
              title={t('timeEntries.delete', 'Delete time entry')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="font-semibold text-[rgb(var(--color-text-800))]">
            {formatMinutesAsHoursAndMinutes(entry.billable_duration, durationLabels)}
          </span>
        </div>
      </div>
      {showUserName && (
        <div className="text-xs text-muted-foreground">{startLabel}</div>
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {entry.service_name || t('timeEntries.noService', 'No service')}
        </span>
        <Badge
          variant={APPROVAL_STATUS_BADGE_VARIANT[statusKey] ?? 'outline'}
          size="sm"
        >
          {statusLabel}
        </Badge>
      </div>
      {entry.notes && (
        <div className="text-xs text-[rgb(var(--color-text-700))] line-clamp-2 whitespace-pre-wrap">
          {entry.notes}
        </div>
      )}
    </li>
  );
};

export default TicketTimeEntries;
