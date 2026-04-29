'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Clock, ChevronDown, ChevronRight, EyeOff } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { formatMinutesAsHoursAndMinutes, formatDateTime, utcToLocal, getUserTimeZone } from '@alga-psa/core';
import {
  fetchTimeEntriesForTicket,
  type TicketTimeEntriesSummary,
  type TicketTimeEntrySummaryEntry,
} from '@alga-psa/scheduling/actions/timeEntryTicketActions';

interface TicketTimeEntriesProps {
  id?: string;
  ticketId: string;
  currentUserId: string;
  dateTimeFormat?: string;
  /**
   * Increment this value to force the panel to re-fetch (e.g. after a new entry is saved).
   */
  refreshKey?: number;
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

const APPROVAL_STATUS_BADGE_CLASS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SUBMITTED: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
  CHANGES_REQUESTED: 'bg-amber-100 text-amber-800',
};

const TicketTimeEntries: React.FC<TicketTimeEntriesProps> = ({
  id,
  ticketId,
  currentUserId,
  dateTimeFormat = 'MMM d, yyyy h:mm a',
  refreshKey = 0,
}) => {
  const { t } = useTranslation('features/tickets');
  const [summary, setSummary] = useState<TicketTimeEntriesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMine, setShowMine] = useState(true);
  const [showOthers, setShowOthers] = useState(false);
  const userTimeZone = useMemo(() => getUserTimeZone(), []);

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
  }, [ticketId, refreshKey]);

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
        className="text-xs text-muted-foreground py-2"
      >
        {t('timeEntries.loading', 'Loading time entries…')}
      </div>
    );
  }

  if (error) {
    return (
      <div
        {...withDataAutomationId({ id: `${id}-time-entries-error` })}
        className="text-xs text-red-600 py-2"
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
          {formatMinutesAsHoursAndMinutes(summary.totalMinutes)}
        </span>
      </div>

      {!hasAnyEntries && (
        <p
          {...withDataAutomationId({ id: `${id}-time-entries-empty` })}
          className="text-xs text-muted-foreground"
        >
          {t('timeEntries.empty', 'No time has been logged on this ticket yet.')}
        </p>
      )}

      {summary.ownEntryCount > 0 && (
        <div {...withDataAutomationId({ id: `${id}-time-entries-mine` })}>
          <button
            {...withDataAutomationId({ id: `${id}-time-entries-mine-toggle` })}
            type="button"
            className="w-full flex items-center justify-between text-xs font-medium text-[rgb(var(--color-text-800))] hover:text-[rgb(var(--color-text-900))]"
            onClick={() => setShowMine((value) => !value)}
            aria-expanded={showMine}
          >
            <span className="flex items-center gap-1">
              {showMine ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              {t('timeEntries.myEntries', 'My entries')}{' '}
              <span className="text-muted-foreground">({summary.ownEntryCount})</span>
            </span>
            <span className="text-muted-foreground">
              {formatMinutesAsHoursAndMinutes(summary.ownTotalMinutes)}
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
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {summary.othersEntryCount > 0 && summary.canViewOthers && (
        <div {...withDataAutomationId({ id: `${id}-time-entries-others` })}>
          <button
            {...withDataAutomationId({ id: `${id}-time-entries-others-toggle` })}
            type="button"
            className="w-full flex items-center justify-between text-xs font-medium text-[rgb(var(--color-text-800))] hover:text-[rgb(var(--color-text-900))]"
            onClick={() => setShowOthers((value) => !value)}
            aria-expanded={showOthers}
          >
            <span className="flex items-center gap-1">
              {showOthers ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              {t('timeEntries.otherTeam', 'Other team members')}{' '}
              <span className="text-muted-foreground">({summary.othersEntryCount})</span>
            </span>
            <span className="text-muted-foreground">
              {formatMinutesAsHoursAndMinutes(summary.othersTotalMinutes)}
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
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {summary.othersEntryCount > 0 && !summary.canViewOthers && (
        <div
          {...withDataAutomationId({ id: `${id}-time-entries-others-anonymized` })}
          className="rounded-md border border-dashed border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-bg-50))] px-3 py-2 text-xs text-muted-foreground flex items-center gap-2"
        >
          <EyeOff className="w-3 h-3 flex-shrink-0" />
          <span>
            {t(
              'timeEntries.othersAnonymized',
              '{{count}} entries by other team members ({{duration}})',
              {
                count: summary.othersEntryCount,
                duration: formatMinutesAsHoursAndMinutes(summary.othersTotalMinutes),
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
}

const TimeEntryRow: React.FC<TimeEntryRowProps> = ({
  id,
  entry,
  dateTimeFormat,
  timeZone,
  showUserName,
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

  return (
    <li
      {...withDataAutomationId({ id })}
      className="text-xs rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-50))] px-3 py-2 space-y-1"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-[rgb(var(--color-text-900))]">
          {showUserName
            ? entry.user_name || t('timeEntries.unknownUser', 'Unknown user')
            : startLabel}
        </span>
        <span className="font-semibold text-[rgb(var(--color-text-800))]">
          {formatMinutesAsHoursAndMinutes(entry.billable_duration)}
        </span>
      </div>
      {showUserName && (
        <div className="text-[11px] text-muted-foreground">{startLabel}</div>
      )}
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          {entry.service_name || t('timeEntries.noService', 'No service')}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
            APPROVAL_STATUS_BADGE_CLASS[statusKey] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {statusLabel}
        </span>
      </div>
      {entry.notes && (
        <div className="text-[11px] text-[rgb(var(--color-text-700))] line-clamp-2 whitespace-pre-wrap">
          {entry.notes}
        </div>
      )}
    </li>
  );
};

export default TicketTimeEntries;
