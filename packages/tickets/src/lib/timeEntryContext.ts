import type {
  ITicket,
  StopwatchEntrySpanView,
  StopwatchSessionView,
  TimeEntryWorkItemContext,
} from '@alga-psa/types';
import { formatStopwatchDuration } from '@alga-psa/ui/context';

interface BuildTicketTimeEntryContextParams {
  ticket: ITicket;
  clientName?: string | null;
  timeDescription?: string;
  masterTicketNumber?: string | null;
  /** Resolved/explicit default service for the time entry; null = none. */
  serviceId?: string | null;
  serviceName?: string | null;
}

export function buildTicketTimeEntryContext({
  ticket,
  clientName,
  timeDescription,
  masterTicketNumber,
  serviceId,
  serviceName,
}: BuildTicketTimeEntryContextParams): TimeEntryWorkItemContext {
  return {
    workItemId: ticket.ticket_id ?? '',
    workItemType: 'ticket',
    workItemName: ticket.title || `Ticket ${ticket.ticket_number}`,
    ticketNumber: ticket.ticket_number,
    masterTicketId: ticket.master_ticket_id ?? null,
    masterTicketNumber: masterTicketNumber ?? null,
    clientName: clientName ?? null,
    timeDescription,
    serviceId: serviceId ?? null,
    serviceName: serviceName ?? null,
  };
}

type Translate = (key: string, defaultValue: string, options?: Record<string, unknown>) => string;

interface StopwatchContextOptions {
  /** Translator for the notice and fallback name (msp/time-entry namespace). Required: no literals here. */
  translate: Translate;
  locale?: string;
  /** Description typed on the ticket screen; wins over the session's stored notes when non-empty. */
  descriptionOverride?: string;
  masterTicketId?: string | null;
  masterTicketNumber?: string | null;
}

/**
 * D4/D5: prefill for the time-entry drawer when a stopwatch session is stopped. Start, end and
 * duration come from the session span (start = first start, end = start + active minutes), so
 * the entry form's recomputation from the span cannot re-bill paused time.
 */
export function stopwatchSessionToTimeEntryContext(
  session: StopwatchSessionView,
  span: StopwatchEntrySpanView,
  options: StopwatchContextOptions,
): TimeEntryWorkItemContext {
  const { translate, locale, descriptionOverride, masterTicketId, masterTicketNumber } = options;
  const isTicket = session.work_item_type === 'ticket';

  let notice: string | undefined;
  if (span.pausedMs > 0) {
    const values = {
      active: formatStopwatchDuration(span.billableMinutes * 60_000, locale),
      paused: formatStopwatchDuration(span.pausedMs, locale),
      count: span.segmentCount,
    };
    notice = translate(
      'stopwatch.pausedNotice',
      'Tracked {{active}} across {{count}} segments (paused {{paused}})',
      values,
    );
  }

  return {
    workItemId: session.work_item_id ?? '',
    workItemType: isTicket ? 'ticket' : 'project_task',
    workItemName: session.work_item_title || (session.ticket_number
      ? translate('stopwatch.ticketFallbackName', 'Ticket {{number}}', { number: session.ticket_number })
      : ''),
    ticketNumber: isTicket ? session.ticket_number ?? undefined : undefined,
    masterTicketId: masterTicketId ?? null,
    masterTicketNumber: masterTicketNumber ?? null,
    clientName: session.client_name,
    projectName: session.project_name ?? undefined,
    taskName: isTicket ? undefined : session.work_item_title ?? undefined,
    startTime: span.start,
    endTime: span.end,
    timeDescription: descriptionOverride?.trim() ? descriptionOverride : session.notes || undefined,
    serviceId: session.service_id,
    serviceName: session.service_name,
    notice,
    stopwatchSessionId: session.session_id,
  };
}
