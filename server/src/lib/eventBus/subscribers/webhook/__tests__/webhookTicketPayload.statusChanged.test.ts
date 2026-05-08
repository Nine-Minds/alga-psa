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
const TICKET_ID = 'ticket-status-1';
const PREVIOUS_STATUS_ID = 'status-old';
const NEW_STATUS_ID = 'status-new';
const PREVIOUS_STATUS_NAME = 'In Progress';

function makeTicketRow() {
  return {
    ticket_id: TICKET_ID,
    ticket_number: 'TKT-200',
    title: 'Status changed',
    status_id: NEW_STATUS_ID,
    status_name: 'Resolved',
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

function createFakeKnex(opts: {
  ticketRow: ReturnType<typeof makeTicketRow>;
  statusNameById: Record<string, string | null>;
}) {
  const calls = { tickets: 0, statuses: 0 };

  function makeChainable(table: string) {
    const chain: any = {
      leftJoin: () => chain,
      select: () => chain,
      where: () => chain,
      first: async () => {
        if (table.startsWith('tickets')) {
          return opts.ticketRow;
        }
        if (table === 'statuses') {
          // The implementation passes status_id in .where({...}); reading its
          // captured value is unnecessary because we drive the lookup table by
          // the test fixture's only entry.
          const [name] = Object.values(opts.statusNameById);
          return { name };
        }
        return undefined;
      },
    };
    return chain;
  }

  const knex: any = (table: unknown) => {
    if (typeof table === 'string') {
      if (table.startsWith('tickets')) calls.tickets += 1;
      if (table === 'statuses') calls.statuses += 1;
    }
    return makeChainable(typeof table === 'string' ? table : '');
  };
  knex.raw = (sql: string) => sql;

  return { knex, calls };
}

describe('buildTicketWebhookPayload status_changed (T021)', () => {
  beforeEach(() => {
    clearTicketWebhookPayloadCache();
    tagMappingState.getByEntityMock.mockReset();
    tagMappingState.getByEntityMock.mockResolvedValue([]);
  });

  afterEach(() => {
    clearTicketWebhookPayloadCache();
  });

  it('resolves previous_status_id from payload.changes.status_id.from and previous_status_name from the statuses table', async () => {
    const event: TicketWebhookSourceEvent = {
      eventType: 'TICKET_STATUS_CHANGED',
      timestamp: '2026-05-06T12:00:00.000Z',
      payload: {
        tenantId: TENANT,
        ticketId: TICKET_ID,
        changes: {
          status_id: {
            from: PREVIOUS_STATUS_ID,
            to: NEW_STATUS_ID,
          },
        },
      },
    };

    const { knex, calls } = createFakeKnex({
      ticketRow: makeTicketRow(),
      statusNameById: { [PREVIOUS_STATUS_ID]: PREVIOUS_STATUS_NAME },
    });

    const payload = await buildTicketWebhookPayload(event, knex);

    expect(payload.previous_status_id).toBe(PREVIOUS_STATUS_ID);
    expect(payload.previous_status_name).toBe(PREVIOUS_STATUS_NAME);
    expect(payload.status_id).toBe(NEW_STATUS_ID);
    expect(calls.tickets).toBe(1);
    expect(calls.statuses).toBe(1);
  });

  it('falls back to payload.previousStatusId when payload.changes is absent', async () => {
    const event: TicketWebhookSourceEvent = {
      eventType: 'TICKET_STATUS_CHANGED',
      timestamp: '2026-05-06T12:00:00.000Z',
      payload: {
        tenantId: TENANT,
        ticketId: TICKET_ID,
        previousStatusId: PREVIOUS_STATUS_ID,
      },
    };

    const { knex } = createFakeKnex({
      ticketRow: makeTicketRow(),
      statusNameById: { [PREVIOUS_STATUS_ID]: PREVIOUS_STATUS_NAME },
    });

    const payload = await buildTicketWebhookPayload(event, knex);

    expect(payload.previous_status_id).toBe(PREVIOUS_STATUS_ID);
    expect(payload.previous_status_name).toBe(PREVIOUS_STATUS_NAME);
  });

  it('omits previous_status_* fields entirely when no prior status can be resolved', async () => {
    const event: TicketWebhookSourceEvent = {
      eventType: 'TICKET_STATUS_CHANGED',
      timestamp: '2026-05-06T12:00:00.000Z',
      payload: {
        tenantId: TENANT,
        ticketId: TICKET_ID,
      },
    };

    const { knex, calls } = createFakeKnex({
      ticketRow: makeTicketRow(),
      statusNameById: {},
    });

    const payload = await buildTicketWebhookPayload(event, knex);

    expect('previous_status_id' in payload).toBe(false);
    expect('previous_status_name' in payload).toBe(false);
    expect(calls.statuses).toBe(0);
  });
});
