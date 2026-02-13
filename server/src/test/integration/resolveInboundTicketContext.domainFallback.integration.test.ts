import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import net from 'node:net';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

// shared/workflow/actions/emailWorkflowActions imports the event-bus publisher module at load time.
// In unit/integration tests we don't need the real publisher implementation (and dist artifacts may not exist),
// so we stub it.
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

const dbReachable: boolean = await new Promise((resolve) => {
  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT || '5432');
  const socket = net.createConnection({ host, port });
  const done = (value: boolean) => {
    socket.removeAllListeners();
    socket.destroy();
    resolve(value);
  };
  socket.on('connect', () => done(true));
  socket.on('error', () => done(false));
  socket.setTimeout(500, () => done(false));
});
const describeDb = dbReachable ? describe : describe.skip;

let db: Knex;
let tenantId: string;
let defaultsClientId: string;
let boardId: string;
let statusId: string;
let priorityId: string;
let enteredByUserId: string;
let actionRegistry: any;

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    if (!db) throw new Error('Test DB not initialized');
    return db;
  }),
  destroyAdminConnection: vi.fn(async () => {}),
}));

describeDb('resolve_inbound_ticket_context (integration)', () => {
  const cleanup: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    db = await createTestDbConnection();

    const tenant = await db('tenants').first<{ tenant: string }>('tenant');
    if (!tenant?.tenant) throw new Error('Expected seeded tenant');
    tenantId = tenant.tenant;

    const client = await db('clients').where({ tenant: tenantId }).first<{ client_id: string }>('client_id');
    if (!client?.client_id) throw new Error('Expected seeded client');
    defaultsClientId = client.client_id;

    const board = await db('boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
    if (!board?.board_id) throw new Error('Expected seeded board');
    boardId = board.board_id;

    const status = await db('statuses')
      .where({ tenant: tenantId, status_type: 'ticket' })
      .first<{ status_id: string }>('status_id');
    if (!status?.status_id) throw new Error('Expected seeded ticket status');
    statusId = status.status_id;

    const priority = await db('priorities').where({ tenant: tenantId }).first<{ priority_id: string }>('priority_id');
    if (!priority?.priority_id) throw new Error('Expected seeded priority');
    priorityId = priority.priority_id;

    const user = await db('users').where({ tenant: tenantId }).first<{ user_id: string }>('user_id');
    if (!user?.user_id) throw new Error('Expected seeded user');
    enteredByUserId = user.user_id;

    const { getActionRegistryV2 } = await import('@alga-psa/shared/workflow/runtime');
    const { registerEmailWorkflowActionsV2 } = await import(
      '@alga-psa/shared/workflow/runtime/actions/registerEmailWorkflowActions'
    );

    actionRegistry = getActionRegistryV2();
    if (!actionRegistry.get('resolve_inbound_ticket_context', 1)) {
      registerEmailWorkflowActionsV2();
    }
  }, 180_000);

  afterEach(async () => {
    while (cleanup.length) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('applies domain fallback + client default contact consistent with in-app logic', async () => {
    const providerId = uuidv4();
    const defaultsId = uuidv4();
    const defaultsLocationId = uuidv4();

    await db('client_locations').insert({
      tenant: tenantId,
      location_id: defaultsLocationId,
      client_id: defaultsClientId,
      location_name: 'Defaults Location',
      address_line1: '1 Main St',
      city: 'City',
      country_code: 'US',
      country_name: 'United States',
      is_default: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('inbound_ticket_defaults').insert({
      id: defaultsId,
      tenant: tenantId,
      short_name: `email-${defaultsId.slice(0, 6)}`,
      display_name: `Email Defaults ${defaultsId.slice(0, 6)}`,
      description: 'Test defaults',
      board_id: boardId,
      status_id: statusId,
      priority_id: priorityId,
      client_id: defaultsClientId,
      entered_by: enteredByUserId,
      location_id: defaultsLocationId,
      is_active: true,
      is_default: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('email_providers').insert({
      id: providerId,
      tenant: tenantId,
      provider_type: 'google',
      provider_name: 'Test Provider',
      mailbox: `support-${uuidv4().slice(0, 6)}@example.com`,
      is_active: true,
      status: 'connected',
      vendor_config: JSON.stringify({}),
      inbound_ticket_defaults_id: defaultsId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    cleanup.push(async () => {
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
      await db('client_locations').where({ tenant: tenantId, location_id: defaultsLocationId }).delete();
    });

    const domainClientId = uuidv4();
    const domain = `acme-${uuidv4().slice(0, 6)}.com`;
    const defaultContactId = uuidv4();

    await db('clients').insert({
      tenant: tenantId,
      client_id: domainClientId,
      client_name: `Domain Client ${uuidv4().slice(0, 6)}`,
      properties: JSON.stringify({
        primary_contact_id: defaultContactId,
        primary_contact_name: 'Primary Contact',
      }),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: defaultContactId,
      full_name: 'Primary Contact',
      email: `primary@${domain}`,
      client_id: domainClientId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: defaultContactId }).delete();
      await db('clients').where({ tenant: tenantId, client_id: domainClientId }).delete();
    });

    const action = actionRegistry.get('resolve_inbound_ticket_context', 1);
    if (!action) throw new Error('Expected resolve_inbound_ticket_context@1 to be registered');

    const ctx = {
      runId: 'test-run',
      stepPath: '0',
      tenantId,
      idempotencyKey: 'test',
      attempt: 1,
      nowIso: () => new Date().toISOString(),
      env: {},
    } as any;

    const output = await action.handler(
      { tenantId, providerId, senderEmail: `someoneelse@${domain}` },
      ctx
    );

    expect(output.ticketDefaults).toBeTruthy();
    expect(output.matchedClient ?? null).toBeNull();
    expect(output.targetClientId).toBe(domainClientId);
    expect(output.targetContactId).toBe(defaultContactId);
    expect(output.targetLocationId ?? null).toBeNull();
  });
});
