'use client';

import React, { useEffect, useState } from 'react';
import { Calendar, Phone, CreditCard, Plus } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { BentoTile, BentoTileEmpty } from './BentoTile';
import {
  getTicketScheduleEntries,
  getTicketInteractions,
  getTicketBillingRollup,
  type TicketScheduleEntrySummary,
  type TicketInteractionSummary,
  type TicketBillingRollup,
} from '../../../actions/ticketBentoActions';

function useTileData<T>(load: () => Promise<T>, deps: React.DependencyList): {
  data: T | null;
  error: string | null;
  loading: boolean;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this tile');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading };
}

function TileSkeleton({ id }: { id: string }) {
  return <div id={id} className="animate-pulse bg-[rgb(var(--color-border-100))] h-16 rounded-md" />;
}

function formatShortDate(iso: string): { month: string; day: string } {
  const d = new Date(iso);
  return {
    month: d.toLocaleString(undefined, { month: 'short' }),
    day: String(d.getDate()),
  };
}

function formatTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `${time(start)} – ${time(end)}`;
  const day = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day(start)} – ${day(end)}`;
}

/** "Next visit" tile — schedule entries linked to this ticket. */
export function NextVisitTile({ id, ticketId, refreshKey = 0 }: { id: string; ticketId: string; refreshKey?: number }) {
  const { data, error, loading } = useTileData(
    () => getTicketScheduleEntries(ticketId),
    [ticketId, refreshKey],
  );

  const upcoming = (data ?? []).filter((entry) => entry.isUpcoming);
  const past = (data ?? []).filter((entry) => !entry.isUpcoming).slice(0, 1);

  return (
    <BentoTile id={id} title="Next visit" icon={<Calendar className="h-4 w-4" />} error={error}>
      {loading ? (
        <TileSkeleton id={`${id}-loading`} />
      ) : upcoming.length === 0 && past.length === 0 ? (
        <div>
          <BentoTileEmpty id={`${id}-empty`}>Nothing scheduled</BentoTileEmpty>
          <a
            id={`${id}-schedule-link`}
            href="/msp/technician-dispatch"
            className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline mt-1"
          >
            <Plus className="h-3 w-3" /> Schedule a visit
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          {[...upcoming.slice(0, 2), ...(upcoming.length === 0 ? past : [])].map((entry) => (
            <ScheduleRow key={entry.entryId} id={`${id}-entry-${entry.entryId}`} entry={entry} />
          ))}
        </div>
      )}
    </BentoTile>
  );
}

function ScheduleRow({ id, entry }: { id: string; entry: TicketScheduleEntrySummary }) {
  const date = formatShortDate(entry.scheduledStart);
  return (
    <div id={id} className={`flex items-center gap-3 ${entry.isUpcoming ? '' : 'opacity-60'}`}>
      <div className="w-10 flex-shrink-0 rounded-md bg-[rgb(var(--color-primary-50))] dark:bg-[rgb(var(--color-primary-400)/0.15)] text-center py-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--color-primary-500))]">{date.month}</div>
        <div className="text-base font-semibold leading-none text-[rgb(var(--color-primary-600))] dark:text-[rgb(var(--color-primary-300))]">{date.day}</div>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-[rgb(var(--color-text-800))] truncate">{entry.title || 'Scheduled work'}</div>
        <div className="text-xs text-[rgb(var(--color-text-500))] truncate">
          {formatTimeRange(entry.scheduledStart, entry.scheduledEnd)}
          {entry.assignedUserNames.length > 0 ? ` · ${entry.assignedUserNames.join(', ')}` : ''}
          {!entry.isUpcoming ? ' · done' : ''}
        </div>
      </div>
    </div>
  );
}

/** "Calls and emails" tile — interactions logged against this ticket. */
export function CallsEmailsTile({
  id,
  ticketId,
  refreshKey = 0,
  viewAllHref,
}: {
  id: string;
  ticketId: string;
  refreshKey?: number;
  viewAllHref?: string;
}) {
  const { data, error, loading } = useTileData(
    () => getTicketInteractions(ticketId, { limit: 5 }),
    [ticketId, refreshKey],
  );

  return (
    <BentoTile
      id={id}
      title="Calls and emails"
      icon={<Phone className="h-4 w-4" />}
      error={error}
      action={
        viewAllHref && data && data.length > 0 ? (
          <a
            id={`${id}-view-all`}
            href={viewAllHref}
            className="text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline"
          >
            View all
          </a>
        ) : undefined
      }
    >
      {loading ? (
        <TileSkeleton id={`${id}-loading`} />
      ) : !data || data.length === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>No calls or emails logged</BentoTileEmpty>
      ) : (
        <ul className="divide-y divide-[rgb(var(--color-border-100))]">
          {data.map((interaction) => (
            <InteractionRow key={interaction.interactionId} id={`${id}-row-${interaction.interactionId}`} interaction={interaction} />
          ))}
        </ul>
      )}
    </BentoTile>
  );
}

function InteractionRow({ id, interaction }: { id: string; interaction: TicketInteractionSummary }) {
  return (
    <li id={id} className="py-1.5 first:pt-0 last:pb-0 flex items-baseline gap-2 text-sm">
      <span className="min-w-0 truncate text-[rgb(var(--color-text-700))]">
        {interaction.title || interaction.typeName || 'Interaction'}
      </span>
      <span className="ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))]">
        {new Date(interaction.interactionDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </span>
    </li>
  );
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

/** "Billing" tile — hours-only rollup for this ticket (v1: no dollar amounts). */
export function BillingTile({ id, ticketId, refreshKey = 0 }: { id: string; ticketId: string; refreshKey?: number }) {
  const { data, error, loading } = useTileData(
    () => getTicketBillingRollup(ticketId),
    [ticketId, refreshKey],
  );

  const rollup: TicketBillingRollup | null = data;

  return (
    <BentoTile id={id} title="Billing" icon={<CreditCard className="h-4 w-4" />} error={error}>
      {loading ? (
        <TileSkeleton id={`${id}-loading`} />
      ) : !rollup || rollup.entryCount === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>No time logged yet</BentoTileEmpty>
      ) : (
        <div className="text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-[rgb(var(--color-text-500))]">Logged</span>
            <span className="font-medium text-[rgb(var(--color-text-800))]">
              {formatMinutes(rollup.totalMinutes)} · {formatMinutes(rollup.billableMinutes)} billable
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[rgb(var(--color-text-500))]">Invoicing</span>
            <span className="font-medium text-[rgb(var(--color-text-800))]">
              {rollup.uninvoicedBillableMinutes > 0
                ? `${formatMinutes(rollup.uninvoicedBillableMinutes)} not invoiced yet`
                : 'Nothing waiting'}
            </span>
          </div>
          {rollup.contractName ? (
            <div className="flex justify-between gap-2">
              <span className="text-[rgb(var(--color-text-500))] flex-shrink-0">Contract</span>
              <span className="font-medium text-[rgb(var(--color-text-800))] truncate" title={rollup.contractName}>
                {rollup.contractName}
              </span>
            </div>
          ) : null}
          {rollup.contractName ? (
            <p className="text-xs text-green-700 dark:text-green-400">Covered by contract</p>
          ) : null}
        </div>
      )}
    </BentoTile>
  );
}
