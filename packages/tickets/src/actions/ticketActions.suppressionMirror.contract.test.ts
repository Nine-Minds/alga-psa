import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const optimizedSource = readFileSync(resolve(__dirname, 'optimizedTicketActions.ts'), 'utf8');
const mirrorSource = readFileSync(resolve(__dirname, 'ticketActions.ts'), 'utf8');

function payloadBlock(source: string, eventType: 'TICKET_CLOSED' | 'TICKET_ASSIGNED' | 'TICKET_UPDATED') {
  const eventIndex = source.indexOf(`eventType: '${eventType}'`);
  expect(eventIndex).toBeGreaterThan(-1);

  const nextEventIndex = source.indexOf("eventType: 'TICKET_", eventIndex + 1);
  return source.slice(eventIndex, nextEventIndex === -1 ? undefined : nextEventIndex);
}

describe('ticket update notification suppression mirror contract', () => {
  it.each([
    'TICKET_CLOSED',
    'TICKET_ASSIGNED',
    'TICKET_UPDATED',
  ] as const)('threads suppression flags through %s payloads in both action paths', (eventType) => {
    for (const source of [optimizedSource, mirrorSource]) {
      const block = payloadBlock(source, eventType);

      expect(block).toContain('suppressContactNotifications');
      expect(block).toContain('suppressInternalNotifications');
    }
  });

  it('keeps the same internal-implies-contact validation in both action paths', () => {
    for (const source of [optimizedSource, mirrorSource]) {
      expect(source).toContain('suppressInternalNotifications && !suppressContactNotifications');
      expect(source).toContain('suppressInternalNotifications requires suppressContactNotifications');
    }
  });
});
