import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { parseTicketWatchListAttributes } from '@alga-psa/shared/lib/tickets/watchList';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const sent: Array<{ to: string; template: string }> = [];
let testDb: Knex;

vi.mock('../../lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db/db')>()),
  getConnection: async () => testDb,
}));
vi.mock('../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db')>()),
  createTenantKnex: async (tenant?: string) => ({ knex: testDb, tenant }),
}));
vi.mock('../../lib/notifications/sendEventEmail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/notifications/sendEventEmail')>()),
  sendEventEmail: vi.fn(async (params: { to: string; template: string }) => {
    sent.push({ to: params.to, template: params.template });
  }),
}));

describe('board default watchers (integration)', () => {
  let tenant: string;
  let clientId: string;
  let boardId: string;
  let priorityId: string;
  let scoped: ReturnType<typeof tenantDb>;
  let users: Record<string, string>;
  let handleTicketUpdated: (event: any) => Promise<void>;
  const noopPublisher = { publishTicketCreated: vi.fn(async () => undefined) } as any;

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    ({ ticketEmailSubscriberTestHarness: { handleTicketUpdated } } = await import(
      '../../lib/eventBus/subscribers/ticketEmailSubscriber'
    ));
    tenant = await createTenant(testDb, `Defaults ${uuidv4().slice(0, 6)}`);
    scoped = tenantDb(testDb, tenant);
    clientId = await createClient(testDb, tenant, 'Acme');
    users = {
      manager: await createUser(testDb, tenant, { email: 'manager@example.com', first_name: 'Ada', last_name: 'Manager' }),
      other: await createUser(testDb, tenant, { email: 'other@example.com' }),
      gone: await createUser(testDb, tenant, { email: 'gone@example.com', is_inactive: true }),
      clientUser: await createUser(testDb, tenant, { email: 'clientuser@example.com', user_type: 'client' }),
    };
    boardId = uuidv4();
    priorityId = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Accounts', is_default: true });
    await scoped.table('statuses').insert({ tenant, status_id: uuidv4(), board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false });
    await scoped.table('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: users.manager });
    await scoped.table('board_default_watchers').insert([
      { tenant, board_id: boardId, user_id: users.manager },
      { tenant, board_id: boardId, user_id: users.gone },
      { tenant, board_id: boardId, user_id: users.clientUser },
    ]);
  }, 900_000);

  afterAll(async () => {
    await testDb?.destroy();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  async function create(input: Record<string, unknown> = {}) {
    return testDb.transaction((trx) =>
      TicketModel.createTicket(
        { title: 'Quarterly review', client_id: clientId, board_id: boardId, priority_id: priorityId, ...input } as any,
        tenant,
        trx,
        {},
        noopPublisher,
      ),
    );
  }

  it('seeds the board default watchers (active internal users only) with source board_default', async () => {
    const created = await create();
    const row = await scoped.table('tickets').where({ ticket_id: created.ticket_id }).first();
    expect(parseTicketWatchListAttributes(row.attributes)).toEqual([
      expect.objectContaining({
        email: 'manager@example.com',
        active: true,
        name: 'Ada Manager',
        source: 'board_default',
        entity_type: 'user',
        entity_id: users.manager,
      }),
    ]);
    expect(row.assigned_to).toBeNull();
  });

  it('keeps an existing watcher entry (and its source) and adds the defaults', async () => {
    const created = await create({
      attributes: {
        watch_list: [
          { email: 'manager@example.com', active: true, source: 'inbound_cc' },
          { email: 'cc@client.example', active: true, source: 'inbound_cc' },
        ],
      },
    });
    const row = await scoped.table('tickets').where({ ticket_id: created.ticket_id }).first();
    const list = parseTicketWatchListAttributes(row.attributes);
    expect(list.map((entry) => entry.email).sort()).toEqual(['cc@client.example', 'manager@example.com']);
    expect(list.find((entry) => entry.email === 'manager@example.com')?.source).toBe('inbound_cc');
  });

  it('does not touch attributes on a board without default watchers', async () => {
    const otherBoard = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: otherBoard, board_name: 'Plain', is_default: false });
    await scoped.table('statuses').insert({ tenant, status_id: uuidv4(), board_id: otherBoard, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false });
    const created = await create({ board_id: otherBoard });
    const row = await scoped.table('tickets').where({ ticket_id: created.ticket_id }).first();
    expect(row.attributes?.watch_list).toBeUndefined();
  });

  it('delivers a later TICKET_UPDATED to the default watcher through the existing watcher email path', async () => {
    const created = await create();
    await runWithTenant(tenant, () =>
      handleTicketUpdated({
        id: uuidv4(),
        eventType: 'TICKET_UPDATED',
        timestamp: new Date().toISOString(),
        payload: {
          tenantId: tenant,
          ticketId: created.ticket_id,
          userId: users.other,
          changes: { title: { from: 'Quarterly review', to: 'Quarterly review (rev 2)' } },
        },
      }),
    );
    expect(sent.some((email) => email.to === 'manager@example.com')).toBe(true);
  });
});
