import type { ITicket, TimeEntryWorkItemContext } from '@alga-psa/types';

interface BuildTicketTimeEntryContextParams {
  ticket: ITicket;
  clientName?: string | null;
  elapsedTime?: number;
  timeDescription?: string;
}

export function buildTicketTimeEntryContext({
  ticket,
  clientName,
  elapsedTime,
  timeDescription,
}: BuildTicketTimeEntryContextParams): TimeEntryWorkItemContext {
  return {
    workItemId: ticket.ticket_id ?? '',
    workItemType: 'ticket',
    workItemName: ticket.title || `Ticket ${ticket.ticket_number}`,
    ticketNumber: ticket.ticket_number,
    clientName: clientName ?? null,
    elapsedTime,
    timeDescription,
  };
}

interface TicketTimeEntryCompletionParams {
  stopTracking: () => Promise<void> | void;
  setElapsedTime: (value: number) => void;
  setIsRunning: (value: boolean) => void;
}

export function createTicketTimeEntryOnComplete({
  stopTracking,
  setElapsedTime,
  setIsRunning,
}: TicketTimeEntryCompletionParams): () => void {
  return () => {
    Promise.resolve(stopTracking()).catch(() => {});
    setElapsedTime(0);
    setIsRunning(false);
  };
}
