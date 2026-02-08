import { describe, it, expect, vi } from 'vitest';
import { buildTicketTimeEntryContext, createTicketTimeEntryOnComplete } from './timeEntryContext';

const baseTicket = {
  ticket_id: 'ticket-1',
  ticket_number: 'T-100',
  title: 'Investigate issue',
  client_name: 'Acme',
} as any;

describe('ticket time entry context helpers', () => {
  it('builds context with ticket id, number, and title', () => {
    const context = buildTicketTimeEntryContext({
      ticket: baseTicket,
      clientName: 'Acme',
    });

    expect(context.workItemId).toBe('ticket-1');
    expect(context.ticketNumber).toBe('T-100');
    expect(context.workItemName).toBe('Investigate issue');
  });

  it('includes elapsed time and description from timer state', () => {
    const context = buildTicketTimeEntryContext({
      ticket: baseTicket,
      elapsedTime: 3600,
      timeDescription: 'Fixed bug',
    });

    expect(context.elapsedTime).toBe(3600);
    expect(context.timeDescription).toBe('Fixed bug');
  });

  it('onComplete resets timer state after save', () => {
    const stopTracking = vi.fn();
    const setElapsedTime = vi.fn();
    const setIsRunning = vi.fn();

    const onComplete = createTicketTimeEntryOnComplete({
      stopTracking,
      setElapsedTime,
      setIsRunning,
    });

    onComplete();

    expect(stopTracking).toHaveBeenCalled();
    expect(setElapsedTime).toHaveBeenCalledWith(0);
    expect(setIsRunning).toHaveBeenCalledWith(false);
  });
});
