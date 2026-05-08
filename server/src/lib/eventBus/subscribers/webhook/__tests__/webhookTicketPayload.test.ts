import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tagMappingState = vi.hoisted(() => ({
  getByEntityMock: vi.fn(),
}));

vi.mock('@alga-psa/tags/models/tagMapping', () => ({
  default: {
    getByEntity: (...args: unknown[]) => tagMappingState.getByEntityMock(...args),
  },
}));

import {
  buildTicketWebhookPayload,
  clearTicketWebhookPayloadCache,
  type TicketWebhookSourceEvent,
} from '../webhookTicketPayload';

const TENANT = '11111111-1111-1111-1111-111111111111';
const TICKET_ID = 'ticket-1234';

function makeTicketRow() {
  return {
    ticket_id: TICKET_ID,
    ticket_number: 'TKT-100',
    title: 'A ticket',
    status_id: 'status-1',
    status_name: 'Open',
    priority_id: 'priority-1',
    priority_name: 'High',
    client_id: 'client-1',
    client_name: 'Acme',
    contact_name_id: 'contact-1',
    contact_name: 'Jane Doe',
    contact_email: 'jane@acme.com',
    assigned_to: 'user-1',
    assigned_to_name: 'Alice Agent',
    assigned_team_id: 'team-1',
    board_id: 'board-1',
    board_name: 'Support',
    category_id: 'category-1',
    subcategory_id: 'subcategory-1',
    is_closed: false,
    entered_at: '2026-05-06T10:00:00.000Z',
    updated_at: '2026-05-06T11:00:00.000Z',
    closed_at: null,
    due_date: '2026-05-20T00:00:00.000Z',
  };
}

function createFakeKnex(ticketRow: ReturnType<typeof makeTicketRow>) {
  const calls = { ticketsCalls: 0, otherCalls: 0 };

  const chainable: any = {
    leftJoin: () => chainable,
    select: () => chainable,
    where: () => chainable,
    first: async () => ticketRow,
  };

  const knex: any = (table: unknown) => {
    if (typeof table === 'string' && table.startsWith('tickets')) {
      calls.ticketsCalls += 1;
    } else {
      calls.otherCalls += 1;
    }
    return chainable;
  };
  knex.raw = (sql: string) => sql;

  return { knex, calls };
}

const ASSIGNED_EVENT: TicketWebhookSourceEvent = {
  eventType: 'TICKET_ASSIGNED',
  timestamp: '2026-05-06T12:00:00.000Z',
  payload: {
    tenantId: TENANT,
    ticketId: TICKET_ID,
  },
};

describe('buildTicketWebhookPayload (T020)', () => {
  beforeEach(() => {
    clearTicketWebhookPayloadCache();
    tagMappingState.getByEntityMock.mockReset();
  });

  afterEach(() => {
    clearTicketWebhookPayloadCache();
  });

  it('returns the documented field set with tags as a (possibly empty) array and no undefined leaks', async () => {
    tagMappingState.getByEntityMock.mockResolvedValue([]);
    const { knex } = createFakeKnex(makeTicketRow());

    const payload = await buildTicketWebhookPayload(ASSIGNED_EVENT, knex);

    const expectedKeys = [
      'ticket_id',
      'ticket_number',
      'title',
      'status_id',
      'status_name',
      'priority_id',
      'priority_name',
      'client_id',
      'client_name',
      'contact_name_id',
      'contact_name',
      'contact_email',
      'assigned_to',
      'assigned_to_name',
      'assigned_team_id',
      'board_id',
      'board_name',
      'category_id',
      'subcategory_id',
      'is_closed',
      'entered_at',
      'updated_at',
      'closed_at',
      'due_date',
      'tags',
      'url',
    ];
    expect(Object.keys(payload).sort()).toEqual([...expectedKeys].sort());

    // No undefined leaks anywhere in the response.
    for (const value of Object.values(payload)) {
      expect(value).not.toBeUndefined();
    }

    // tags must always be an array even when no rows came back from TagMapping.
    expect(Array.isArray(payload.tags)).toBe(true);
    expect(payload.tags).toEqual([]);

    expect(payload.ticket_id).toBe(TICKET_ID);
    expect(payload.is_closed).toBe(false);
    expect(payload.url.endsWith(`/msp/tickets/${TICKET_ID}`)).toBe(true);
  });

  it('forwards tag_text values from TagMapping.getByEntity into the payload tags array', async () => {
    tagMappingState.getByEntityMock.mockResolvedValue([
      { tag_text: 'urgent' },
      { tag_text: 'vip' },
      { tag_text: '' },
    ]);
    const { knex } = createFakeKnex(makeTicketRow());

    const payload = await buildTicketWebhookPayload(ASSIGNED_EVENT, knex);

    // Empty tag_text values are filtered out; non-empty ones are forwarded in order.
    expect(payload.tags).toEqual(['urgent', 'vip']);
  });

  it('caches by (tenant, ticket_id) within 60s — second call hits neither the join nor the tag query', async () => {
    tagMappingState.getByEntityMock.mockResolvedValue([{ tag_text: 'urgent' }]);
    const { knex, calls } = createFakeKnex(makeTicketRow());

    const first = await buildTicketWebhookPayload(ASSIGNED_EVENT, knex);
    const second = await buildTicketWebhookPayload(ASSIGNED_EVENT, knex);

    expect(calls.ticketsCalls).toBe(1);
    expect(tagMappingState.getByEntityMock).toHaveBeenCalledTimes(1);

    // Cache returns the same field values (tags array is cloned so callers can't mutate the cache).
    expect(second).toEqual(first);
    expect(second.tags).toEqual(['urgent']);
    expect(second.tags).not.toBe(first.tags);
  });
});
