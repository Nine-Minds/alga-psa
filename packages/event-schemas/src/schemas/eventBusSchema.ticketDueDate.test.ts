import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventSchemas } from './eventBusSchema';
import { dateTriggerPayloadSchemas } from './domain/dateTriggerPayloadSchemas';

const tenantId = randomUUID();
const ticketId = randomUUID();
const parseCreated = (payload: Record<string, unknown>) =>
  (EventSchemas as any).TICKET_CREATED.safeParse({ id: randomUUID(), eventType: 'TICKET_CREATED', timestamp: new Date().toISOString(), payload: { tenantId, ticketId, ...payload } });

describe('TICKET_CREATED due date, origin and recurrence', () => {
  it('accepts a payload without the new fields', () => {
    expect(parseCreated({}).success).toBe(true);
  });

  it('accepts and keeps dueDate, ticketOrigin and recurrence', () => {
    const recurrence = { definitionId: randomUUID(), occurrenceId: randomUUID(), occurrenceDate: '2027-01-08' };
    const result = parseCreated({ dueDate: '2027-01-08T17:00:00.000Z', ticketOrigin: 'recurring', recurrence });
    expect(result.success).toBe(true);
    expect(result.data.payload).toMatchObject({ dueDate: '2027-01-08T17:00:00.000Z', ticketOrigin: 'recurring', recurrence });
  });

  it('accepts a null due date and an unknown origin string', () => {
    expect(parseCreated({ dueDate: null, ticketOrigin: 'some_future_origin' }).success).toBe(true);
  });

  it('rejects a malformed recurrence and a non-datetime due date', () => {
    expect(parseCreated({ recurrence: { definitionId: randomUUID() } }).success).toBe(false);
    expect(parseCreated({ dueDate: 'next tuesday' }).success).toBe(false);
  });
});

describe('payload.TicketDueDate.v1', () => {
  const schema = dateTriggerPayloadSchemas['payload.TicketDueDate.v1'];
  const base = () => ({
    tenantId, occursOn: '2027-01-08', fireDate: '2026-11-09', offsetDays: -60, sourceId: 'ticket.due_date', ticketExists: true,
    ticketId, ticketNumber: 'T-1', title: 'Renewal', dueDate: '2027-01-08', dueAt: '2027-01-08T17:00:00.000Z',
    statusId: randomUUID(), statusName: 'Open', boardId: randomUUID(), boardName: 'Renewals', ticketOrigin: 'recurring',
  });
  const recurrence = () => ({ definitionId: randomUUID(), definitionClientId: randomUUID(), occurrenceId: randomUUID(), occurrenceDate: '2027-01-08' });

  it('is registered', () => { expect(schema).toBeDefined(); });

  it('accepts a payload with and without recurrence', () => {
    expect(schema.safeParse({ ...base(), recurrence: recurrence() }).success).toBe(true);
    expect(schema.safeParse(base()).success).toBe(true);
  });

  it('accepts a scheduled recurring occurrence with no ticket yet: no ticket fields, no occurrence id', () => {
    const { occurrenceId: _none, ...scheduled } = recurrence();
    const payload = {
      tenantId, occursOn: '2027-01-08', fireDate: '2026-11-09', offsetDays: -60, ticketExists: false,
      dueDate: '2027-01-08', dueAt: '2027-01-08T17:00:00.000Z', ticketOrigin: 'recurring',
      recurrence: { ...scheduled, definitionName: 'Annual renewal' },
    };
    expect(schema.safeParse(payload).success).toBe(true);
  });

  it('rejects a missing ticketOrigin, a missing ticketExists, a recurrence without its client row, and a non date-only dueDate', () => {
    const { ticketOrigin: _drop, ...noOrigin } = base();
    expect(schema.safeParse(noOrigin).success).toBe(false);
    const { ticketExists: _exists, ...noExists } = base();
    expect(schema.safeParse(noExists).success).toBe(false);
    const { definitionClientId: _dc, ...noClientRow } = recurrence();
    expect(schema.safeParse({ ...base(), recurrence: noClientRow }).success).toBe(false);
    expect(schema.safeParse({ ...base(), dueDate: '2027-01-08T17:00:00Z' }).success).toBe(false);
  });
});
