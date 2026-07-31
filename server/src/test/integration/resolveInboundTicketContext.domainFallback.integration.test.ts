import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { tenantDb } from '@alga-psa/db';

// @alga-psa/workflows/actions/emailWorkflowActions imports the event-bus publisher module at load time.
// In unit/integration tests we don't need the real publisher implementation (and dist artifacts may not exist),
// so we stub it.
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

const describeDb = await describeWithDb();

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

    const tenant = await tenantDb(db, '__test_discovery__')
      .unscoped('tenants', 'test discovery of seeded tenant for inbound context domain fallback')
      .first<{ tenant: string }>('tenant');
    if (!tenant?.tenant) throw new Error('Expected seeded tenant');
    tenantId = tenant.tenant;

    const scopedDb = tenantDb(db, tenantId);

    const client = await scopedDb.table('clients').first<{ client_id: string }>('client_id');
    if (!client?.client_id) throw new Error('Expected seeded client');
    defaultsClientId = client.client_id;

    const board = await scopedDb.table('boards').first<{ board_id: string }>('board_id');
    if (!board?.board_id) throw new Error('Expected seeded board');
    boardId = board.board_id;

    const status = await scopedDb.table('statuses')
      .where({ status_type: 'ticket' })
      .first<{ status_id: string }>('status_id');
    if (!status?.status_id) throw new Error('Expected seeded ticket status');
    statusId = status.status_id;

    const priority = await scopedDb.table('priorities').first<{ priority_id: string }>('priority_id');
    if (!priority?.priority_id) throw new Error('Expected seeded priority');
    priorityId = priority.priority_id;

    const user = await scopedDb.table('users').first<{ user_id: string }>('user_id');
    if (!user?.user_id) throw new Error('Expected seeded user');
    enteredByUserId = user.user_id;

    const { getActionRegistryV2 } = await import('@alga-psa/workflows/runtime');
    const { registerEmailWorkflowActionsV2 } = await import(
      '@alga-psa/workflows/runtime/actions/registerEmailWorkflowActions'
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
    const scopedDb = tenantDb(db, tenantId);

    await scopedDb.table('client_locations').insert({
      tenant: tenantId,
      location_id: defaultsLocationId,
      client_id: defaultsClientId,
      location_name: 'Defaults Location',
      address_line1: '1 Main St',
      city: 'City',
      country_code: 'US',
      country_name: 'United States',
      // The defaults row below pins this location by id; the seeded client already
      // owns the single allowed default (ux_client_locations_default_per_client).
      is_default: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await scopedDb.table('inbound_ticket_defaults').insert({
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
    await scopedDb.table('email_providers').insert({
      id: providerId,
      tenant: tenantId,
      provider_type: 'google',
      provider_name: 'Test Provider',
      mailbox: `support-${uuidv4().slice(0, 6)}@example.com`,
      is_active: true,
      status: 'connected',
      inbound_ticket_defaults_id: defaultsId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    cleanup.push(async () => {
      const scopedDb = tenantDb(db, tenantId);
      await scopedDb.table('email_providers').where({ id: providerId }).delete();
      await scopedDb.table('inbound_ticket_defaults').where({ id: defaultsId }).delete();
      await scopedDb.table('client_locations').where({ location_id: defaultsLocationId }).delete();
    });

    const domainClientId = uuidv4();
    const domain = `acme-${uuidv4().slice(0, 6)}.com`;
    const defaultContactId = uuidv4();

    await scopedDb.table('clients').insert({
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

    const domainMappingId = uuidv4();
    await scopedDb.table('client_inbound_email_domains').insert({
      tenant: tenantId,
      id: domainMappingId,
      client_id: domainClientId,
      domain,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await scopedDb.table('contacts').insert({
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
      const scopedDb = tenantDb(db, tenantId);
      await scopedDb.table('contacts').where({ contact_name_id: defaultContactId }).delete();
      await scopedDb.table('client_inbound_email_domains').where({ id: domainMappingId }).delete();
      await scopedDb.table('clients').where({ client_id: domainClientId }).delete();
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
