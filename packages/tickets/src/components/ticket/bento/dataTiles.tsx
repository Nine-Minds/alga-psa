'use client';

import React from 'react';
import { Calendar, CalendarCheck, Phone, CreditCard, Plus } from 'lucide-react';
import { fromZonedTime } from 'date-fns-tz';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import {
  BentoDateChip,
  BentoRow,
  BentoRowList,
  BentoTile,
  BentoTileEmpty,
  TileSkeleton,
  useTileData,
} from '@alga-psa/ui/components/bento';
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

// These run at module scope with no hook to read the app locale from, so it is
// passed in: omitting it would format in the browser's locale, not the app's.
function formatShortDate(iso: string, locale: string): { month: string; day: string } {
  const d = new Date(iso);
  return {
    month: d.toLocaleString(locale, { month: 'short' }),
    day: String(d.getDate()),
  };
}

function formatTimeRange(startIso: string, endIso: string, locale: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();
  const time = (d: Date) => d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `${time(start)} – ${time(end)}`;
  const day = (d: Date) => d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
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
  const { locale } = useFormatters();
  const date = formatShortDate(entry.scheduledStart, locale);
  return (
    <div id={id} className={`flex items-center gap-3 ${entry.isUpcoming ? '' : 'opacity-60'}`}>
      <BentoDateChip month={date.month} day={date.day} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-[rgb(var(--color-text-800))] truncate">{entry.title || t('bento.tiles.scheduledWork', 'Scheduled work')}</div>
        <div className="text-xs text-[rgb(var(--color-text-500))] truncate">
          {formatTimeRange(entry.scheduledStart, entry.scheduledEnd, locale)}
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

function formatAppointmentDateTime(date: string | null, time: string | null, tz: string | null, locale: string): string | null {
  if (!date || !time) return null;
  try {
    const dt = fromZonedTime(`${date}T${time}:00`, tz || 'UTC');
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
  const { locale } = useFormatters();
  const when = formatAppointmentDateTime(request.requestedDate, request.requestedTime, request.requesterTimezone, locale);
  const duration = request.requestedDurationMinutes ? formatMinutes(request.requestedDurationMinutes) : null;
  return (
    <BentoRow id={id} align="start" className="justify-between">
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
    </BentoRow>
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
        <BentoRowList>
          {requests.map((request) => (
            <AppointmentRequestRow
              key={request.appointmentRequestId}
              id={`${id}-row-${request.appointmentRequestId}`}
              request={request}
              t={t}
            />
          ))}
        </BentoRowList>
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
        <BentoRowList>
          {data.map((interaction) => (
            <InteractionRow key={interaction.interactionId} id={`${id}-row-${interaction.interactionId}`} interaction={interaction} t={t} />
          ))}
        </BentoRowList>
      )}
    </BentoTile>
  );
}

function InteractionRow({ id, interaction, t }: { id: string; interaction: TicketInteractionSummary; t: (key: string, defaultValue: string) => string }) {
  const { locale } = useFormatters();
  return (
    <BentoRow
      id={id}
      meta={new Date(interaction.interactionDate).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
    >
      <span className="min-w-0 truncate text-[rgb(var(--color-text-700))]">
        {interaction.title || interaction.typeName || t('bento.tiles.interaction', 'Interaction')}
      </span>
    </BentoRow>
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
