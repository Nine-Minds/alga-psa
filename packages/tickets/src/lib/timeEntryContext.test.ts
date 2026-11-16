import { describe, it, expect } from 'vitest';
import { buildTicketTimeEntryContext, stopwatchSessionToTimeEntryContext } from './timeEntryContext';

const baseTicket = {
  ticket_id: 'ticket-1',
  ticket_number: 'T-100',
  title: 'Investigate issue',
  client_name: 'Acme',
} as any;

const session = {
  session_id: 'session-1',
  user_id: 'user-1',
  work_item_type: 'ticket',
  work_item_id: 'ticket-1',
  service_id: 'svc-1',
  notes: 'stored notes',
  status: 'paused',
  time_entry_id: null,
  closed_at: null,
  created_at: '2026-09-09T10:00:00Z',
  updated_at: '2026-09-09T10:00:00Z',
  time_entry_ids: [],
  segments: [],
  active_ms: 5_400_000,
  server_now: '2026-09-09T11:30:00Z',
  ticket_number: 'T-100',
  work_item_title: 'Investigate issue',
  project_name: null,
  client_name: 'Acme',
  service_name: 'Support',
} as any;

const span = (overrides = {}) => ({
  start: new Date('2026-09-09T10:00:00Z'),
  end: new Date('2026-09-09T11:30:00Z'),
  billableMinutes: 90,
  pausedMs: 0,
  segmentCount: 1,
  ...overrides,
});

describe('ticket time entry context helpers', () => {
  it('builds context with ticket id, number, and title', () => {
    const context = buildTicketTimeEntryContext({ ticket: baseTicket, clientName: 'Acme' });

    expect(context.workItemId).toBe('ticket-1');
    expect(context.ticketNumber).toBe('T-100');
    expect(context.workItemName).toBe('Investigate issue');
    expect(context).not.toHaveProperty('elapsedTime');
  });

  it('includes the description typed on the ticket', () => {
    const context = buildTicketTimeEntryContext({ ticket: baseTicket, timeDescription: 'Fixed bug' });
    expect(context.timeDescription).toBe('Fixed bug');
  });

  it('carries bundle info when the ticket is a bundled child', () => {
    const context = buildTicketTimeEntryContext({
      ticket: { ...baseTicket, master_ticket_id: 'master-1' },
      masterTicketNumber: 'T-099',
    });

    expect(context.masterTicketId).toBe('master-1');
    expect(context.masterTicketNumber).toBe('T-099');
  });
});

const translate = (_key: string, defaultValue: string, values?: Record<string, unknown>) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(values?.[name] ?? ''));

describe('stopwatchSessionToTimeEntryContext', () => {
  it('prefills times, service, notes and the session id from the span', () => {
    const context = stopwatchSessionToTimeEntryContext(session, span(), { translate });

    expect(context.workItemType).toBe('ticket');
    expect(context.workItemId).toBe('ticket-1');
    expect(context.ticketNumber).toBe('T-100');
    expect(context.startTime).toEqual(new Date('2026-09-09T10:00:00Z'));
    expect(context.endTime).toEqual(new Date('2026-09-09T11:30:00Z'));
    expect(context.serviceId).toBe('svc-1');
    expect(context.timeDescription).toBe('stored notes');
    expect(context.stopwatchSessionId).toBe('session-1');
    expect(context.notice).toBeUndefined();
  });

  it('carries the session segments so the launcher can split them per work day', () => {
    const segments = [
      { segment_id: 's1', started_at: '2026-10-28T23:06:00Z', ended_at: '2026-10-29T05:06:00Z' },
      { segment_id: 's2', started_at: '2026-11-03T13:21:00Z', ended_at: '2026-11-03T19:55:00Z' },
    ];
    const context = stopwatchSessionToTimeEntryContext(
      { ...session, segments },
      span({ pausedMs: 128 * 3_600_000, segmentCount: 2, billableMinutes: 754 }),
      { translate },
    );

    expect(context.stopwatchSegments).toEqual(segments);
    expect(context.stopwatchSessionId).toBe('session-1');
    // The single-span view stays for other consumers, and the paused notice is unchanged.
    expect(context.startTime).toEqual(new Date('2026-09-09T10:00:00Z'));
    expect(context.notice).toContain('across 2 segments');
  });

  it('prefers a non-empty description typed on the screen over stored notes', () => {
    expect(stopwatchSessionToTimeEntryContext(session, span(), { translate, descriptionOverride: 'typed' }).timeDescription).toBe('typed');
    expect(stopwatchSessionToTimeEntryContext(session, span(), { translate, descriptionOverride: '  ' }).timeDescription).toBe('stored notes');
  });

  it('adds a paused notice only when time was paused', () => {
    const context = stopwatchSessionToTimeEntryContext(
      session,
      span({ pausedMs: 600_000, segmentCount: 2 }),
      { translate: (_key, defaultValue, values) => `${defaultValue}|${values?.count}` },
    );

    expect(context.notice).toContain('|2');
  });

  it('routes the ticket fallback name through the translator', () => {
    const context = stopwatchSessionToTimeEntryContext(
      { ...session, work_item_title: '' },
      span(),
      { translate: (key, _d, values) => `${key}:${values?.number}` },
    );
    expect(context.workItemName).toBe('stopwatch.ticketFallbackName:T-100');
  });

  it('maps project task sessions', () => {
    const context = stopwatchSessionToTimeEntryContext(
      { ...session, work_item_type: 'project_task', ticket_number: null, work_item_title: 'Build it', project_name: 'Proj' },
      span(),
      { translate },
    );

    expect(context.workItemType).toBe('project_task');
    expect(context.taskName).toBe('Build it');
    expect(context.projectName).toBe('Proj');
    expect(context.ticketNumber).toBeUndefined();
  });
});
