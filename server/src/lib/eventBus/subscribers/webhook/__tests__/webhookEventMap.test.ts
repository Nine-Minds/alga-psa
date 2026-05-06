import { describe, expect, it } from 'vitest';

import {
  publicEventsFor,
  TICKET_INTERNAL_TO_PUBLIC,
  type TicketWebhookInternalEvent,
  type TicketWebhookPublicEvent,
} from '../webhookEventMap';

const TABLE: Array<[TicketWebhookInternalEvent, TicketWebhookPublicEvent[]]> = [
  ['TICKET_CREATED', ['ticket.created']],
  ['TICKET_UPDATED', ['ticket.updated']],
  ['TICKET_STATUS_CHANGED', ['ticket.status_changed']],
  ['TICKET_ASSIGNED', ['ticket.assigned']],
  ['TICKET_CLOSED', ['ticket.closed']],
  ['TICKET_COMMENT_ADDED', ['ticket.comment.added']],
];

describe('publicEventsFor (T019)', () => {
  it.each(TABLE)('maps %s to its documented public event(s)', (internal, expected) => {
    expect(publicEventsFor(internal)).toEqual(expected);
  });

  it('returns an empty array for unknown internal event types', () => {
    expect(publicEventsFor('NOT_A_REAL_EVENT' as any)).toEqual([]);
    expect(publicEventsFor('ticket.created' as any)).toEqual([]);
    expect(publicEventsFor('' as any)).toEqual([]);
  });

  it('returns a fresh array each call so callers cannot mutate the table', () => {
    const first = publicEventsFor('TICKET_CREATED');
    first.push('ticket.updated');
    const second = publicEventsFor('TICKET_CREATED');
    expect(second).toEqual(['ticket.created']);
  });

  it('TABLE in the test mirrors the source mapping (guards against drift)', () => {
    const tableKeys = TABLE.map(([k]) => k).sort();
    const sourceKeys = Object.keys(TICKET_INTERNAL_TO_PUBLIC).sort();
    expect(tableKeys).toEqual(sourceKeys);
  });
});
