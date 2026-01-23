import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? ''),
  },
}));

vi.mock('@alga-psa/core/logger', () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return { default: stub, logger: stub };
});

vi.mock('@alga-psa/core/logger', () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return { default: stub, logger: stub };
});

const sentEmails: any[] = [];

vi.mock('server/src/lib/notifications/sendEventEmail', () => ({
  sendEventEmail: vi.fn(async (params: any) => {
    sentEmails.push(params);
  }),
}));

type SubHandler = (event: any) => Promise<void>;
const subscribers = new Map<string, SubHandler>();

vi.mock('server/src/lib/eventBus/index', () => ({
  getEventBus: vi.fn(() => ({
    subscribe: vi.fn(async (eventType: string, handler: SubHandler) => {
      subscribers.set(eventType, handler);
    }),
    unsubscribe: vi.fn(async (eventType: string) => {
      subscribers.delete(eventType);
    }),
  })),
}));

let runWithTenant: any;
let registerTicketEmailSubscriber: any;
let unregisterTicketEmailSubscriber: any;

describe('Ticket bundling email fanout integration', () => {
  let db: Knex;
  let tenantId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let agentUserId: string;

  beforeAll(async () => {
    db = await createTestDbConnection();

    ({ runWithTenant } = await import('@/lib/db'));
    ({ registerTicketEmailSubscriber, unregisterTicketEmailSubscriber } = await import(
      '@/lib/eventBus/subscribers/ticketEmailSubscriber'
    ));

    const tenantRow = await db('tenants').first<{ tenant: string }>('tenant');
    if (!tenantRow?.tenant) {
      throw new Error('No seeded tenant found for email fanout integration test');
    }
    tenantId = tenantRow.tenant;

    const board = await db('boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
    const status = await db('statuses')
      .where({ tenant: tenantId })
      .first<{ status_id: string }>('status_id');
    const priority = await db('priorities')
      .where({ tenant: tenantId })
      .first<{ priority_id: string }>('priority_id');
    if (!board?.board_id || !status?.status_id || !priority?.priority_id) {
      throw new Error('Missing seeded board/status/priority');
    }
    boardId = board.board_id;
    statusId = status.status_id;
    priorityId = priority.priority_id;

    agentUserId = uuidv4();
    await db('users').insert({
      tenant: tenantId,
      user_id: agentUserId,
      username: `agent.${agentUserId}`,
      first_name: 'Agent',
      last_name: 'Sender',
      email: `agent-${uuidv4().slice(0, 8)}@example.com`,
      hashed_password: 'x',
      created_at: db.fn.now(),
      two_factor_enabled: false,
      is_google_user: false,
      is_inactive: false,
      user_type: 'internal',
    });

    await registerTicketEmailSubscriber();
  }, 180_000);

  afterAll(async () => {
    await unregisterTicketEmailSubscriber().catch(() => undefined);
    await db?.destroy().catch(() => undefined);
  });

  it('fans out public master comments to child requesters (deduped) with child threading', async () => {
    sentEmails.length = 0;

    const clientId = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Client ${uuidv4().slice(0, 6)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      url: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
      is_inactive: false,
      credit_balance: 0,
      properties: {},
    });
    await db('client_locations').insert({
      tenant: tenantId,
      location_id: uuidv4(),
      client_id: clientId,
      location_name: 'Default',
      address_line1: '123 Test St',
      city: 'Test City',
      country_code: 'US',
      country_name: 'United States',
      is_default: true,
      is_active: true,
      email: `client-${uuidv4().slice(0, 6)}@example.com`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const masterContactId = uuidv4();
    const childContact1Id = uuidv4();
    const childContact2Id = uuidv4();
    const masterEmail = `master-${uuidv4().slice(0, 6)}@example.com`;
    const childEmail1 = `child1-${uuidv4().slice(0, 6)}@example.com`;
    const childEmail2 = `child2-${uuidv4().slice(0, 6)}@example.com`;

    await db('contacts').insert([
      {
        tenant: tenantId,
        contact_name_id: masterContactId,
        full_name: 'Master Contact',
        client_id: clientId,
        email: masterEmail,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
      {
        tenant: tenantId,
        contact_name_id: childContact1Id,
        full_name: 'Child Contact 1',
        client_id: clientId,
        email: childEmail1,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
      {
        tenant: tenantId,
        contact_name_id: childContact2Id,
        full_name: 'Child Contact 2',
        client_id: clientId,
        email: childEmail2,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
    ]);

    const masterTicketId = uuidv4();
    const childTicket1Id = uuidv4();
    const childTicket2Id = uuidv4();
    const masterNumber = `EML-${uuidv4().slice(0, 6)}`;
    const childNum1 = `EML-${uuidv4().slice(0, 6)}`;
    const childNum2 = `EML-${uuidv4().slice(0, 6)}`;

    const childMsg1 = `message-${uuidv4()}@mail`;
    const childMsg2 = `message-${uuidv4()}@mail`;

    await db('tickets').insert([
      {
        tenant: tenantId,
        ticket_id: masterTicketId,
        ticket_number: masterNumber,
        title: 'Master Ticket',
        client_id: clientId,
        contact_name_id: masterContactId,
        status_id: statusId,
        priority_id: priorityId,
        board_id: boardId,
        entered_at: db.fn.now(),
        updated_at: db.fn.now(),
        email_metadata: JSON.stringify({ messageId: `message-${uuidv4()}@mail`, threadId: `thread-${uuidv4()}`, references: [] }),
      },
      {
        tenant: tenantId,
        ticket_id: childTicket1Id,
        ticket_number: childNum1,
        title: 'Child Ticket 1',
        client_id: clientId,
        contact_name_id: childContact1Id,
        status_id: statusId,
        priority_id: priorityId,
        board_id: boardId,
        master_ticket_id: masterTicketId,
        entered_at: db.fn.now(),
        updated_at: db.fn.now(),
        email_metadata: JSON.stringify({ messageId: childMsg1, threadId: `thread-${uuidv4()}`, references: [childMsg1] }),
      },
      {
        tenant: tenantId,
        ticket_id: childTicket2Id,
        ticket_number: childNum2,
        title: 'Child Ticket 2',
        client_id: clientId,
        contact_name_id: childContact2Id,
        status_id: statusId,
        priority_id: priorityId,
        board_id: boardId,
        master_ticket_id: masterTicketId,
        entered_at: db.fn.now(),
        updated_at: db.fn.now(),
        email_metadata: JSON.stringify({ messageId: childMsg2, threadId: `thread-${uuidv4()}`, references: [childMsg2] }),
      },
    ]);

    const handler = subscribers.get('TICKET_COMMENT_ADDED');
    expect(handler).toBeTruthy();

    const event = {
      id: uuidv4(),
      eventType: 'TICKET_COMMENT_ADDED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId: masterTicketId,
        userId: agentUserId,
        comment: {
          id: uuidv4(),
          content: 'Public update',
          author: 'Agent Sender',
          isInternal: false,
        },
      },
    };

    await runWithTenant(tenantId, async () => {
      await handler!(event);
    });

    const recipients = sentEmails.map((e) => String(e.to).toLowerCase()).sort();
    expect(recipients).toEqual([childEmail1, childEmail2, masterEmail].map((x) => x.toLowerCase()).sort());

    const child1Email = sentEmails.find((e) => String(e.to).toLowerCase() === childEmail1.toLowerCase());
    expect(child1Email).toBeTruthy();
    expect(child1Email.headers?.['In-Reply-To']).toBe(childMsg1);

    const child2Email = sentEmails.find((e) => String(e.to).toLowerCase() === childEmail2.toLowerCase());
    expect(child2Email).toBeTruthy();
    expect(child2Email.headers?.['In-Reply-To']).toBe(childMsg2);
  });

  it('fans out master closure notifications to child requesters (deduped)', async () => {
    sentEmails.length = 0;

    const clientId = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Client ${uuidv4().slice(0, 6)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      url: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
      is_inactive: false,
      credit_balance: 0,
      properties: {},
    });
    await db('client_locations').insert({
      tenant: tenantId,
      location_id: uuidv4(),
      client_id: clientId,
      location_name: 'Default',
      address_line1: '123 Test St',
      city: 'Test City',
      country_code: 'US',
      country_name: 'United States',
      is_default: true,
      is_active: true,
      email: `client-${uuidv4().slice(0, 6)}@example.com`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const masterContactId = uuidv4();
    const childContact1Id = uuidv4();
    const masterEmail = `master-${uuidv4().slice(0, 6)}@example.com`;
    const childEmail = `child-${uuidv4().slice(0, 6)}@example.com`;

    await db('contacts').insert([
      {
        tenant: tenantId,
        contact_name_id: masterContactId,
        full_name: 'Master Contact',
        client_id: clientId,
        email: masterEmail,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
      {
        tenant: tenantId,
        contact_name_id: childContact1Id,
        full_name: 'Child Contact 1',
        client_id: clientId,
        email: childEmail,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
    ]);

    const masterTicketId = uuidv4();
    const childTicketId = uuidv4();
    const masterNumber = `CLS-${uuidv4().slice(0, 6)}`;
    const childNum = `CLS-${uuidv4().slice(0, 6)}`;

    const childMsg = `message-${uuidv4()}@mail`;

    await db('tickets').insert([
      {
        tenant: tenantId,
        ticket_id: masterTicketId,
        ticket_number: masterNumber,
        title: 'Master Ticket',
        client_id: clientId,
        contact_name_id: masterContactId,
        status_id: statusId,
        priority_id: priorityId,
        board_id: boardId,
        entered_at: db.fn.now(),
        updated_at: db.fn.now(),
        email_metadata: JSON.stringify({ messageId: `message-${uuidv4()}@mail`, threadId: `thread-${uuidv4()}`, references: [] }),
      },
      {
        tenant: tenantId,
        ticket_id: childTicketId,
        ticket_number: childNum,
        title: 'Child Ticket',
        client_id: clientId,
        contact_name_id: childContact1Id,
        status_id: statusId,
        priority_id: priorityId,
        board_id: boardId,
        master_ticket_id: masterTicketId,
        entered_at: db.fn.now(),
        updated_at: db.fn.now(),
        email_metadata: JSON.stringify({ messageId: childMsg, threadId: `thread-${uuidv4()}`, references: [childMsg] }),
      },
    ]);

    const handler = subscribers.get('TICKET_CLOSED');
    expect(handler).toBeTruthy();

    const event = {
      id: uuidv4(),
      eventType: 'TICKET_CLOSED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId: masterTicketId,
        userId: agentUserId,
        changes: {},
      },
    };

    await runWithTenant(tenantId, async () => {
      await handler!(event);
    });

    const recipients = sentEmails.map((e) => String(e.to).toLowerCase()).sort();
    expect(recipients).toEqual([childEmail, masterEmail].map((x) => x.toLowerCase()).sort());
  });
});
