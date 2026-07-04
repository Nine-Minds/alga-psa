'use client';

import React, { use, useEffect, useMemo, useRef, useState } from 'react';
import { useSchedulingCallbacks } from '@alga-psa/ui/context';
import { formatMinutesAsHoursAndMinutes } from '@alga-psa/core';
import type { TicketTimeEntriesSummary } from '@alga-psa/types';

interface TimeLoggedSummaryProps {
  id: string;
  ticketId: string;
  refreshKey?: number;
  /**
   * Server-started summary promise, SHARED with TicketTimeEntries (one query,
   * two consumers). Resolved via React use() — the component suspends into its
   * <Suspense> fallback and skips the mount fetch.
   */
  initialSummary?: Promise<TicketTimeEntriesSummary | null>;
}

interface DayBucket {
  key: string;       // YYYY-MM-DD
  label: string;     // short day label, e.g. "Jun 5"
  minutes: number;
}

const MAX_BARS = 10;

function entryDayKey(entry: { work_date: string | null; start_time: string }): string {
  const raw = entry.work_date || entry.start_time;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Headline + per-day mini chart for the "Time logged" tile. Reads the same
 * per-ticket summary the entries list uses, so the two can never disagree.
 */
export function TimeLoggedSummary({ id, ticketId, refreshKey = 0, initialSummary }: TimeLoggedSummaryProps) {
  const { fetchTimeEntriesForTicket } = useSchedulingCallbacks();
  const initialData = initialSummary ? use(initialSummary) : null;
  const [summary, setSummary] = useState<TicketTimeEntriesSummary | null>(initialData);
  const skipFirstFetch = useRef(Boolean(initialSummary));

  useEffect(() => {
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false;
      return;
    }
    let cancelled = false;
    if (!ticketId) return;
    fetchTimeEntriesForTicket(ticketId)
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch(() => {
        // The entries list below surfaces fetch errors; the summary just stays empty.
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, refreshKey, fetchTimeEntriesForTicket]);

  const { totalMinutes, entryCount, buckets, maxMinutes } = useMemo(() => {
    const entries = summary?.entries ?? [];
    const byDay = new Map<string, number>();
    let total = 0;
    for (const entry of entries) {
      const key = entryDayKey(entry);
      const minutes = entry.billable_duration ?? 0;
      total += minutes;
      byDay.set(key, (byDay.get(key) ?? 0) + minutes);
    }
    const sorted: DayBucket[] = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-MAX_BARS)
      .map(([key, minutes]) => ({ key, label: dayLabel(key), minutes }));
    return {
      totalMinutes: total,
      entryCount: entries.length,
      buckets: sorted,
      maxMinutes: Math.max(1, ...sorted.map((bucket) => bucket.minutes)),
    };
  }, [summary]);

  if (entryCount === 0) return null;

  return (
    <div id={id} className="mb-3">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold text-[rgb(var(--color-text-900))]">
          {formatMinutesAsHoursAndMinutes(totalMinutes)}
        </span>
        <span className="text-xs text-[rgb(var(--color-text-500))]">
          across {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      {buckets.length > 1 ? (
        <div
          id={`${id}-chart`}
          role="img"
          aria-label={`Time logged per day: ${buckets.map((b) => `${b.label} ${formatMinutesAsHoursAndMinutes(b.minutes)}`).join(', ')}`}
          className="mt-2 flex items-end gap-1.5 h-14"
        >
          {buckets.map((bucket) => (
            <div key={bucket.key} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${bucket.label}: ${formatMinutesAsHoursAndMinutes(bucket.minutes)}`}>
              <div
                className="w-full rounded-t-sm bg-[rgb(var(--color-primary-400))]"
                style={{ height: `${Math.max(8, Math.round((bucket.minutes / maxMinutes) * 40))}px` }}
              />
              <span className="text-[9px] leading-none text-[rgb(var(--color-text-400))] truncate max-w-full">
                {bucket.label}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default TimeLoggedSummary;
