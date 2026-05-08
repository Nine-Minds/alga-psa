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
const TICKET_ID = 'ticket-comment-1';

function makeTicketRow() {
  return {
    ticket_id: TICKET_ID,
    ticket_number: 'TKT-300',
    title: 'A commented ticket',
    status_id: 'status-1',
    status_name: 'Open',
    priority_id: null,
    priority_name: null,
    client_id: null,
    client_name: null,
    contact_name_id: null,
    contact_name: null,
    contact_email: null,
    assigned_to: null,
    assigned_to_name: null,
    assigned_team_id: null,
    board_id: null,
    board_name: null,
    category_id: null,
    subcategory_id: null,
    is_closed: false,
    entered_at: null,
    updated_at: null,
    closed_at: null,
    due_date: null,
  };
}

function createFakeKnex(ticketRow: ReturnType<typeof makeTicketRow>) {
  function makeChainable(table: string) {
    const chain: any = {
      leftJoin: () => chain,
      select: () => chain,
      where: () => chain,
      first: async () => (table.startsWith('tickets') ? ticketRow : undefined),
    };
    return chain;
  }

  const knex: any = (table: unknown) => makeChainable(typeof table === 'string' ? table : '');
  knex.raw = (sql: string) => sql;
  return knex;
}

describe('buildTicketWebhookPayload comment (T022)', () => {
  beforeEach(() => {
    clearTicketWebhookPayloadCache();
    tagMappingState.getByEntityMock.mockReset();
    tagMappingState.getByEntityMock.mockResolvedValue([]);
  });

  afterEach(() => {
    clearTicketWebhookPayloadCache();
  });

  it('emits comment={text,author,timestamp,is_internal} from a TICKET_COMMENT_ADDED event', async () => {
    const event: TicketWebhookSourceEvent = {
      eventType: 'TICKET_COMMENT_ADDED',
      timestamp: '2026-05-06T13:00:00.000Z',
      payload: {
        tenantId: TENANT,
        ticketId: TICKET_ID,
        occurredAt: '2026-05-06T12:30:00.000Z',
        comment: {
          content: 'Hello from the customer',
          author: 'Jane Doe',
          isInternal: false,
        },
      },
    };

    const payload = await buildTicketWebhookPayload(event, createFakeKnex(makeTicketRow()));

    expect(payload.comment).toEqual({
      text: 'Hello from the customer',
      author: 'Jane Doe',
      timestamp: '2026-05-06T12:30:00.000Z',
      is_internal: false,
    });
    expect(Object.keys(payload.comment ?? {}).sort()).toEqual(
      ['author', 'is_internal', 'text', 'timestamp'].sort(),
    );
  });

  it('does not include attachments or any /attach/i-keyed field even when present in the source event', async () => {
    const event: TicketWebhookSourceEvent = {
      eventType: 'TICKET_COMMENT_ADDED',
      timestamp: '2026-05-06T13:00:00.000Z',
      payload: {
        tenantId: TENANT,
        ticketId: TICKET_ID,
        occurredAt: '2026-05-06T13:00:00.000Z',
        comment: {
          content: 'See attached',
          author: 'Jane Doe',
          isInternal: true,
          attachments: [{ id: 'att-1', filename: 'secret.pdf' }],
          attachment_ids: ['att-1'],
          AttachmentMetadata: { count: 1 },
        },
      },
    };

    const payload = await buildTicketWebhookPayload(event, createFakeKnex(makeTicketRow()));

    expect(payload.comment).toBeDefined();
    expect(payload.comment?.is_internal).toBe(true);

    const attachKey = /attach/i;
    function assertNoAttach(value: unknown, path: string): void {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach((item, idx) => assertNoAttach(item, `${path}[${idx}]`));
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        expect(attachKey.test(key), `${path}.${key} should not match /attach/i`).toBe(false);
        assertNoAttach(child, `${path}.${key}`);
      }
    }

    assertNoAttach(payload, 'payload');
  });

  it('falls back to event.timestamp when payload.occurredAt is missing', async () => {
    const event: TicketWebhookSourceEvent = {
      eventType: 'TICKET_COMMENT_ADDED',
      timestamp: '2026-05-06T14:00:00.000Z',
      payload: {
        tenantId: TENANT,
        ticketId: TICKET_ID,
        comment: {
          content: 'No occurredAt provided',
          author: null,
          isInternal: false,
        },
      },
    };

    const payload = await buildTicketWebhookPayload(event, createFakeKnex(makeTicketRow()));
    expect(payload.comment?.timestamp).toBe('2026-05-06T14:00:00.000Z');
    expect(payload.comment?.author).toBeNull();
  });
});
