import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, './client-tickets.ts'), 'utf8');

function updateTicketStatusSource() {
  const start = source.indexOf('export const updateTicketStatus = withAuth');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('export const deleteClientTicketComment', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function eventPayloadBlock(actionSource: string, eventType: 'TICKET_CLOSED' | 'TICKET_UPDATED') {
  const eventIndex = actionSource.indexOf(`eventType: '${eventType}'`);
  expect(eventIndex).toBeGreaterThan(-1);
  const nextEventIndex = actionSource.indexOf("eventType: 'TICKET_", eventIndex + 1);
  return actionSource.slice(eventIndex, nextEventIndex === -1 ? undefined : nextEventIndex);
}

describe('client portal ticket notification suppression contract', () => {
  it('does not expose suppression options on client portal status updates', () => {
    const actionSource = updateTicketStatusSource();
    const signature = actionSource.slice(0, actionSource.indexOf('): Promise<void>'));

    expect(signature).toContain('ticketId: string');
    expect(signature).toContain('newStatusId: string');
    expect(signature).not.toContain('suppressContactNotifications');
    expect(signature).not.toContain('suppressInternalNotifications');
  });

  it.each(['TICKET_CLOSED', 'TICKET_UPDATED'] as const)(
    'publishes %s without suppression payload fields',
    (eventType) => {
      const block = eventPayloadBlock(updateTicketStatusSource(), eventType);

      expect(block).not.toContain('suppressContactNotifications');
      expect(block).not.toContain('suppressInternalNotifications');
    }
  );
});
