'use client';

import React, { use, useEffect, useRef, useState } from 'react';
import { Calendar, CalendarCheck, Phone, CreditCard, Plus } from 'lucide-react';
import { fromZonedTime } from 'date-fns-tz';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { BentoTile, BentoTileEmpty } from '@alga-psa/ui/components/bento/BentoTile';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  getTicketScheduleEntries,
  getTicketInteractions,
  getTicketBillingRollup,
  getTicketAppointmentRequests,
  type TicketScheduleEntrySummary,
  type TicketInteractionSummary,
  type TicketBillingRollup,
  type TicketAppointmentRequestSummary,
} from '../../../actions/ticketBentoActions';

type TileActionError = ActionMessageError | ActionPermissionError;
type TileDataResult<T> = T | TileActionError;

const isTileActionError = (value: unknown): value is TileActionError =>
  isActionMessageError(value) || isActionPermissionError(value);

/**
 * Tile data source. When `initial` (a server-started promise from the RSC
 * page) is provided, the FIRST paint resolves it via React `use()` — the tile
 * suspends into its <Suspense> skeleton and issues NO network request. The
 * mount fetch is skipped; later dep changes (refreshKey after a mutation)
 * fall back to the client action as before. Without `initial`, behavior is
 * the legacy fetch-on-mount.
 */
function useTileData<T>(
  load: () => Promise<TileDataResult<T>>,
  deps: React.DependencyList,
  t: (key: string, defaultValue: string) => string,
  initial?: Promise<TileDataResult<T>>,
): {
  data: T | null;
  error: string | null;
  loading: boolean;
} {
  // Conditional use() is allowed by React; a resolved streamed promise
  // returns synchronously on re-renders.
  const initialResult = initial ? use(initial) : null;
  const initialData = initialResult && !isTileActionError(initialResult) ? initialResult : null;
  const [data, setData] = useState<T | null>(initialData);
  const [error, setError] = useState<string | null>(
    initialResult && isTileActionError(initialResult) ? getErrorMessage(initialResult) : null,
  );
  const [loading, setLoading] = useState(!initial);
  const skipFirstLoad = useRef(Boolean(initial));

  useEffect(() => {
    if (skipFirstLoad.current) {
      skipFirstLoad.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (cancelled) return;
        if (isTileActionError(result)) {
          setData(null);
          setError(getErrorMessage(result));
          return;
        }
        setData(result);
      })
      .catch((err: unknown) => {
        console.error('Failed to load ticket bento tile:', err);
        if (!cancelled) setError(t('bento.tiles.couldNotLoad', 'Could not load this tile'));
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
export function NextVisitTile({
  id,
  ticketId,
  refreshKey = 0,
  initialData,
  onScheduleVisit,
}: {
  id: string;
  ticketId: string;
  refreshKey?: number;
  initialData?: Promise<TicketScheduleEntrySummary[]>;
  /** Opens the scheduler drawer pre-scoped to this ticket. Falls back to a dispatch link when absent. */
  onScheduleVisit?: () => void;
}) {
  const { t } = useTranslation('features/tickets');
  const { data, error, loading } = useTileData(
    () => getTicketScheduleEntries(ticketId),
    [ticketId, refreshKey],
    t,
    initialData,
  );

  const upcoming = (data ?? []).filter((entry) => entry.isUpcoming);
  const past = (data ?? []).filter((entry) => !entry.isUpcoming).slice(0, 1);

  return (
    <BentoTile
      id={id}
      title={t('bento.tiles.nextVisit', 'Next visit')}
      icon={<Calendar className="h-4 w-4" />}
      error={error}
      action={
        onScheduleVisit ? (
          <button
            id={`${id}-schedule`}
            type="button"
            aria-label={t('bento.tiles.scheduleVisit', 'Schedule a visit')}
            className="text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-text-700))]"
            onClick={onScheduleVisit}
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : undefined
      }
    >
      {loading ? (
        <TileSkeleton id={`${id}-loading`} />
      ) : upcoming.length === 0 && past.length === 0 ? (
        <div>
          <BentoTileEmpty id={`${id}-empty`}>{t('bento.tiles.nothingScheduled', 'Nothing scheduled')}</BentoTileEmpty>
          {onScheduleVisit ? (
            <button
              id={`${id}-schedule-link`}
              type="button"
              onClick={onScheduleVisit}
              className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline mt-1"
            >
              <Plus className="h-3 w-3" /> {t('bento.tiles.scheduleVisit', 'Schedule a visit')}
            </button>
          ) : (
            <a
              id={`${id}-schedule-link`}
              href="/msp/technician-dispatch"
              className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline mt-1"
            >
              <Plus className="h-3 w-3" /> {t('bento.tiles.scheduleVisit', 'Schedule a visit')}
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {[...upcoming.slice(0, 2), ...(upcoming.length === 0 ? past : [])].map((entry) => (
            <ScheduleRow key={entry.entryId} id={`${id}-entry-${entry.entryId}`} entry={entry} t={t} />
          ))}
        </div>
      )}
    </BentoTile>
  );
}

function ScheduleRow({ id, entry, t }: { id: string; entry: TicketScheduleEntrySummary; t: (key: string, defaultValue: string) => string }) {
  const date = formatShortDate(entry.scheduledStart);
  return (
    <div id={id} className={`flex items-center gap-3 ${entry.isUpcoming ? '' : 'opacity-60'}`}>
      <div className="w-10 flex-shrink-0 rounded-md bg-[rgb(var(--color-primary-50))] dark:bg-[rgb(var(--color-primary-400)/0.15)] text-center py-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--color-primary-500))]">{date.month}</div>
        <div className="text-base font-semibold leading-none text-[rgb(var(--color-primary-600))] dark:text-[rgb(var(--color-primary-300))]">{date.day}</div>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-[rgb(var(--color-text-800))] truncate">{entry.title || t('bento.tiles.scheduledWork', 'Scheduled work')}</div>
        <div className="text-xs text-[rgb(var(--color-text-500))] truncate">
          {formatTimeRange(entry.scheduledStart, entry.scheduledEnd)}
          {entry.assignedUserNames.length > 0 ? ` · ${entry.assignedUserNames.join(', ')}` : ''}
          {!entry.isUpcoming ? ` · ${t('bento.tiles.scheduleDone', 'done')}` : ''}
        </div>
      </div>
    </div>
  );
}

function appointmentStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'approved':
      return 'success';
    case 'pending':
      return 'warning';
    case 'declined':
    case 'cancelled':
      return 'error';
    default:
      return 'outline';
  }
}

function formatAppointmentDateTime(date: string | null, time: string | null, tz: string | null): string | null {
  if (!date || !time) return null;
  try {
    const dt = fromZonedTime(`${date}T${time}:00`, tz || 'UTC');
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return null;
  }
}

function AppointmentRequestRow({
  id,
  request,
  t,
}: {
  id: string;
  request: TicketAppointmentRequestSummary;
  t: (key: string, defaultValue: string) => string;
}) {
  const when = formatAppointmentDateTime(request.requestedDate, request.requestedTime, request.requesterTimezone);
  const duration = request.requestedDurationMinutes ? formatMinutes(request.requestedDurationMinutes) : null;
  return (
    <li id={id} className="flex items-start justify-between gap-2 py-1.5 first:pt-0 last:pb-0 text-sm">
      <div className="min-w-0">
        <div className="truncate text-[rgb(var(--color-text-700))]">
          {request.serviceName || t('bento.tiles.appointment', 'Appointment')}
        </div>
        <div className="text-xs text-[rgb(var(--color-text-500))]">
          {when ?? t('bento.tiles.appointmentTimeUnset', 'Time not set')}
          {duration ? ` · ${duration}` : ''}
        </div>
      </div>
      <Badge variant={appointmentStatusVariant(request.status)} size="sm" className="flex-shrink-0">
        {t(`bento.tiles.apptStatus.${request.status}`, request.status)}
      </Badge>
    </li>
  );
}

/**
 * "Appointment requests" tile — client-requested appointment slots linked to
 * this ticket (pending/approved/declined). Distinct from booked visits in the
 * "Next visit" tile. Read-only surface, matching the legacy Entry layout.
 */
export function AppointmentRequestsTile({
  id,
  ticketId,
  refreshKey = 0,
}: {
  id: string;
  ticketId: string;
  refreshKey?: number;
}) {
  const { t } = useTranslation('features/tickets');
  const { data, error, loading } = useTileData(
    () => getTicketAppointmentRequests(ticketId),
    [ticketId, refreshKey],
    t,
  );

  const requests = data ?? [];

  return (
    <BentoTile
      id={id}
      title={t('bento.tiles.appointmentRequests', 'Appointment requests')}
      icon={<CalendarCheck className="h-4 w-4" />}
      error={error}
    >
      {loading ? (
        <TileSkeleton id={`${id}-loading`} />
      ) : requests.length === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>{t('bento.tiles.noAppointmentRequests', 'No appointment requests')}</BentoTileEmpty>
      ) : (
        <ul className="divide-y divide-[rgb(var(--color-border-100))]">
          {requests.map((request) => (
            <AppointmentRequestRow
              key={request.appointmentRequestId}
              id={`${id}-row-${request.appointmentRequestId}`}
              request={request}
              t={t}
            />
          ))}
        </ul>
      )}
    </BentoTile>
  );
}

/** "Calls and emails" tile — interactions logged against this ticket. */
export function CallsEmailsTile({
  id,
  ticketId,
  refreshKey = 0,
  viewAllHref,
  onLogInteraction,
  initialData,
}: {
  id: string;
  ticketId: string;
  refreshKey?: number;
  viewAllHref?: string;
  /** When provided, renders a "Log" affordance in the header that opens the quick-add flow. */
  onLogInteraction?: () => void;
  initialData?: Promise<TicketInteractionSummary[]>;
}) {
  const { t } = useTranslation('features/tickets');
  const { data, error, loading } = useTileData(
    () => getTicketInteractions(ticketId, { limit: 5 }),
    [ticketId, refreshKey],
    t,
    initialData,
  );

  const showViewAll = Boolean(viewAllHref && data && data.length > 0);

  return (
    <BentoTile
      id={id}
      title={t('bento.tiles.callsAndEmails', 'Calls and emails')}
      icon={<Phone className="h-4 w-4" />}
      error={error}
      action={
        showViewAll || onLogInteraction ? (
          <div className="flex items-center gap-2">
            {showViewAll ? (
              <a
                id={`${id}-view-all`}
                href={viewAllHref}
                className="text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline"
              >
                {t('bento.tiles.viewAll', 'View all')}
              </a>
            ) : null}
            {onLogInteraction ? (
              <button
                id={`${id}-log-interaction`}
                type="button"
                aria-label={t('bento.tiles.logInteraction', 'Log call or email')}
                className="text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-text-700))]"
                onClick={onLogInteraction}
              >
                <Plus className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <TileSkeleton id={`${id}-loading`} />
      ) : !data || data.length === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>{t('bento.tiles.noCallsOrEmails', 'No calls or emails logged')}</BentoTileEmpty>
      ) : (
        <ul className="divide-y divide-[rgb(var(--color-border-100))]">
          {data.map((interaction) => (
            <InteractionRow key={interaction.interactionId} id={`${id}-row-${interaction.interactionId}`} interaction={interaction} t={t} />
          ))}
        </ul>
      )}
    </BentoTile>
  );
}

function InteractionRow({ id, interaction, t }: { id: string; interaction: TicketInteractionSummary; t: (key: string, defaultValue: string) => string }) {
  return (
    <li id={id} className="py-1.5 first:pt-0 last:pb-0 flex items-baseline gap-2 text-sm">
      <span className="min-w-0 truncate text-[rgb(var(--color-text-700))]">
        {interaction.title || interaction.typeName || t('bento.tiles.interaction', 'Interaction')}
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
export function BillingTile({
  id,
  ticketId,
  refreshKey = 0,
  initialData,
}: {
  id: string;
  ticketId: string;
  refreshKey?: number;
  initialData?: Promise<TicketBillingRollup | null>;
}) {
  const { t } = useTranslation('features/tickets');
  const { data, error, loading } = useTileData(
    () => getTicketBillingRollup(ticketId),
    [ticketId, refreshKey],
    t,
    initialData,
  );

  const rollup: TicketBillingRollup | null = data;

  return (
    <BentoTile id={id} title={t('bento.tiles.billing', 'Billing')} icon={<CreditCard className="h-4 w-4" />} error={error}>
      {loading ? (
        <TileSkeleton id={`${id}-loading`} />
      ) : !rollup || rollup.entryCount === 0 ? (
        <BentoTileEmpty id={`${id}-empty`}>{t('bento.tiles.nothingBillable', 'Nothing billable yet')}</BentoTileEmpty>
      ) : (
        <div className="text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-[rgb(var(--color-text-500))]">{t('bento.tiles.billable', 'Billable')}</span>
            <span className="font-medium text-[rgb(var(--color-text-800))]">{formatMinutes(rollup.billableMinutes)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[rgb(var(--color-text-500))]">{t('bento.tiles.invoicing', 'Invoicing')}</span>
            <span className="font-medium text-[rgb(var(--color-text-800))]">
              {rollup.uninvoicedBillableMinutes > 0
                ? t('bento.tiles.notInvoicedYet', '{{amount}} not invoiced yet', { amount: formatMinutes(rollup.uninvoicedBillableMinutes) })
                : t('bento.tiles.nothingWaiting', 'Nothing waiting')}
            </span>
          </div>
          {rollup.contractName ? (
            <div className="flex justify-between gap-2">
              <span className="text-[rgb(var(--color-text-500))] flex-shrink-0">{t('bento.tiles.contract', 'Contract')}</span>
              <span className="font-medium text-[rgb(var(--color-text-800))] truncate" title={rollup.contractName}>
                {rollup.contractName}
              </span>
            </div>
          ) : null}
          {rollup.contractName ? (
            <p className="text-xs text-green-700 dark:text-green-400">{t('bento.tiles.coveredByContract', 'Covered by contract')}</p>
          ) : null}
        </div>
      )}
    </BentoTile>
  );
}
