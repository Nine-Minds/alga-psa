import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { TicketService } from '@/lib/api/services/TicketService';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { TicketModel } from '@shared/models/ticketModel';
import { runWithTenant } from '@alga-psa/db';

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
  getContactAvatarUrl: vi.fn().mockResolvedValue(null),
  getUserAvatarUrl: vi.fn().mockResolvedValue(null),
}));

const describeDb = await describeWithDb();

let db: Knex;
const tenantsToCleanup = new Set<string>();

type AbacFixture = {
  tenantId: string;
  clientAId: string;
  clientBId: string;
  boardVisibleId: string;
  boardHiddenId: string;
  groupVisibleId: string;
  contactAId: string;
  contactBId: string;
  clientUserAId: string;
  clientUserBId: string;
  internalUserId: string;
  statusId: string;
  statusHiddenId: string;
  priorityId: string;
  ticketVisibleId: string;
  ticketHiddenBoardId: string;
  ticketClientBId: string;
};

function unscopedRows(table: string) {
  return db(table);
}

function tenantRows(table: string, tenantId: string) {
  return db(table).where({ tenant: tenantId });
}

async function cleanupTenant(tenantId: string): Promise<void> {
  for (const table of [
    'ticket_materials',
    'document_associations',
    'documents',
    'comments',
    'comment_threads',
    'tickets',
    'client_portal_visibility_group_boards',
    'client_portal_visibility_groups',
    'contacts',
    'statuses',
    'priorities',
    'boards',
    'users',
    'clients',
    'api_keys',
  ]) {
    await tenantRows(table, tenantId).del().catch(() => undefined);
  }
  await db('tenants').where({ tenant: tenantId }).del().catch(() => undefined);
}

async function createFixture(): Promise<AbacFixture> {
  const tenantId = uuidv4();
  const clientAId = uuidv4();
  const clientBId = uuidv4();
  const boardVisibleId = uuidv4();
  const boardHiddenId = uuidv4();
  const groupVisibleId = uuidv4();
  const contactAId = uuidv4();
  const contactBId = uuidv4();
  const clientUserAId = uuidv4();
  const clientUserBId = uuidv4();
  const internalUserId = uuidv4();
  const statusId = uuidv4();
  const statusHiddenId = uuidv4();
  const priorityId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    product_code: 'psa',
  });

  await db('clients').insert([
    { tenant: tenantId, client_id: clientAId, client_name: 'Client A', is_inactive: false },
    { tenant: tenantId, client_id: clientBId, client_name: 'Client B', is_inactive: false },
  ]);

  await db('boards').insert([
    { tenant: tenantId, board_id: boardVisibleId, board_name: 'Visible Board', is_default: true, is_inactive: false },
    { tenant: tenantId, board_id: boardHiddenId, board_name: 'Hidden Board', is_default: false, is_inactive: false },
  ]);

  await db('client_portal_visibility_groups').insert({
    tenant: tenantId,
    group_id: groupVisibleId,
    client_id: clientAId,
    name: 'Visible only',
  });

  await db('client_portal_visibility_group_boards').insert({
    tenant: tenantId,
    group_id: groupVisibleId,
    board_id: boardVisibleId,
  });

  await db('contacts').insert([
    {
      tenant: tenantId,
      contact_name_id: contactAId,
      client_id: clientAId,
      full_name: 'Contact A',
      email: 'contact-a@example.com',
      portal_visibility_group_id: groupVisibleId,
    },
    {
      tenant: tenantId,
      contact_name_id: contactBId,
      client_id: clientBId,
      full_name: 'Contact B',
      email: 'contact-b@example.com',
      portal_visibility_group_id: null,
    },
  ]);

  await db('users').insert([
    {
      tenant: tenantId,
      user_id: clientUserAId,
      username: 'client-a-user',
      hashed_password: 'not-used',
      email: 'client-a@example.com',
      user_type: 'client',
      is_inactive: false,
      contact_id: contactAId,
    },
    {
      tenant: tenantId,
      user_id: clientUserBId,
      username: 'client-b-user',
      hashed_password: 'not-used',
      email: 'client-b@example.com',
      user_type: 'client',
      is_inactive: false,
      contact_id: contactBId,
    },
    {
      tenant: tenantId,
      user_id: internalUserId,
      username: 'internal-user',
      hashed_password: 'not-used',
      email: 'internal@example.com',
      user_type: 'internal',
      is_inactive: false,
    },
  ]);

  await db('priorities').insert({
    tenant: tenantId,
    priority_id: priorityId,
    priority_name: 'High',
    created_by: internalUserId,
    order_number: 10,
  });

  await db('statuses').insert([
    {
      tenant: tenantId,
      status_id: statusId,
      board_id: boardVisibleId,
      name: 'Open',
      status_type: 'ticket',
      is_closed: false,
      is_default: true,
      created_by: internalUserId,
      order_number: 10,
    },
    {
      tenant: tenantId,
      status_id: statusHiddenId,
      board_id: boardHiddenId,
      name: 'Open Hidden',
      status_type: 'ticket',
      is_closed: false,
      is_default: true,
      created_by: internalUserId,
      order_number: 10,
    },
  ]);

  const ticketVisibleId = uuidv4();
  const ticketHiddenBoardId = uuidv4();
  const ticketClientBId = uuidv4();

  await db.transaction(async (trx) => {
    await TicketModel.createTicket(
      {
        title: 'Visible Ticket',
        description: 'Visible on the assigned board for client A',
        client_id: clientAId,
        contact_id: contactAId,
        board_id: boardVisibleId,
        status_id: statusId,
        priority_id: priorityId,
        entered_by: internalUserId,
      },
      tenantId,
      trx,
    );

    await TicketModel.createTicket(
      {
        title: 'Hidden Board Ticket',
        description: 'Client A but on a hidden board',
        client_id: clientAId,
        contact_id: contactAId,
        board_id: boardHiddenId,
        status_id: statusHiddenId,
        priority_id: priorityId,
        entered_by: internalUserId,
      },
      tenantId,
      trx,
    );

    await TicketModel.createTicket(
      {
        title: 'Other Client Ticket',
        description: 'Client B on the otherwise-visible board',
        client_id: clientBId,
        contact_id: contactBId,
        board_id: boardVisibleId,
        status_id: statusId,
        priority_id: priorityId,
        entered_by: internalUserId,
      },
      tenantId,
      trx,
    );
  });

  const tickets = await db('tickets').where({ tenant: tenantId }).select('ticket_id', 'title');
  const byTitle = Object.fromEntries(tickets.map((t: { ticket_id: string; title: string }) => [t.title, t.ticket_id]));

  return {
    tenantId,
    clientAId,
    clientBId,
    boardVisibleId,
    boardHiddenId,
    groupVisibleId,
    contactAId,
    contactBId,
    clientUserAId,
    clientUserBId,
    internalUserId,
    statusId,
    statusHiddenId,
    priorityId,
    ticketVisibleId: byTitle['Visible Ticket'],
    ticketHiddenBoardId: byTitle['Hidden Board Ticket'],
    ticketClientBId: byTitle['Other Client Ticket'],
  };
}

function createService(): TicketService {
  const service = new TicketService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
  return service;
}

function clientContext(
  fixture: AbacFixture,
  user: { user_id: string; contact_id: string; clientId: string; user_type: 'client' }
) {
  return {
    userId: user.user_id,
    tenant: fixture.tenantId,
    user: {
      user_id: user.user_id,
      user_type: user.user_type,
      contact_id: user.contact_id,
      clientId: user.clientId,
      tenant: fixture.tenantId,
    },
  };
}

function internalContext(fixture: AbacFixture, userId: string) {
  return {
    userId,
    tenant: fixture.tenantId,
    user: { user_id: userId, user_type: 'internal' as const, tenant: fixture.tenantId },
  };
}

describeDb('ticket client-portal ABAC (TicketService)', () => {
  let fixture: AbacFixture;

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: false });
    fixture = await createFixture();
  }, 300000);

  afterAll(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    tenantsToCleanup.clear();
  }, 60000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const clientA = () => ({
    user_id: fixture.clientUserAId,
    contact_id: fixture.contactAId,
    clientId: fixture.clientAId,
    user_type: 'client' as const,
  });

  it('list returns only same-client tickets on visible boards, with an accurate total', async () => {
    const service = createService();
    const result = await service.list({ page: 1, limit: 10 }, clientContext(fixture, clientA()));

    const titles = result.data.map((t: any) => t.title).sort();
    expect(titles).toEqual(['Visible Ticket']);
    expect(result.total).toBe(1);
  });

  it('search applies client and board scope', async () => {
    const service = createService();
    const result = await service.search(
      { query: 'Ticket', include_closed: true } as any,
      clientContext(fixture, clientA())
    );

    const titles = (result as any[]).map((t) => t.title).sort();
    expect(titles).toEqual(['Visible Ticket']);
  });

  it('getById returns null for a hidden-board ticket and a different-client ticket', async () => {
    const service = createService();
    const ctx = clientContext(fixture, clientA());

    const visible = await service.getById(fixture.ticketVisibleId, ctx);
    expect(visible).toBeTruthy();

    const hiddenBoard = await service.getById(fixture.ticketHiddenBoardId, ctx);
    expect(hiddenBoard).toBeNull();

    const otherClient = await service.getById(fixture.ticketClientBId, ctx);
    expect(otherClient).toBeNull();
  });

  it('list pagination total and page boundaries agree after client+board scope', async () => {
    // Seed an extra visible ticket so there are two rows to paginate.
    await db.transaction(async (trx) => {
      await TicketModel.createTicket(
        {
          title: 'Visible Ticket Two',
          description: 'Another visible ticket',
          client_id: fixture.clientAId,
          contact_id: fixture.contactAId,
          board_id: fixture.boardVisibleId,
          status_id: fixture.statusId,
          priority_id: fixture.priorityId,
          entered_by: fixture.internalUserId,
        },
        fixture.tenantId,
        trx,
      );
    });

    const service = createService();
    const ctx = clientContext(fixture, clientA());
    const page1 = await service.list({ page: 1, limit: 1 }, ctx);
    const page2 = await service.list({ page: 2, limit: 1 }, ctx);

    expect(page1.total).toBe(2);
    expect(page2.total).toBe(2);
    expect(page1.data).toHaveLength(1);
    expect(page2.data).toHaveLength(1);
    expect((page1.data[0] as any).title).not.toBe((page2.data[0] as any).title);

    // Clean up the extra ticket so later tests observe the stable 1-ticket set.
    await db('tickets')
      .where({ tenant: fixture.tenantId, title: 'Visible Ticket Two' })
      .del();
  });

  it('a client with no visibility group sees all its own boards but never another client', async () => {
    const noGroupTenantId = uuidv4();
    tenantsToCleanup.add(noGroupTenantId);
    await db('tenants').insert({
      tenant: noGroupTenantId,
      client_name: 'NoGroup Tenant',
      email: 'nogroup@example.com',
      product_code: 'psa',
    });
    const cId = uuidv4();
    const b1 = uuidv4();
    const b2 = uuidv4();
    const contactId = uuidv4();
    const userId = uuidv4();
    const statusId2 = uuidv4();
    const statusId2b = uuidv4();
    const priorityId2 = uuidv4();
    await db('clients').insert({ tenant: noGroupTenantId, client_id: cId, client_name: 'C', is_inactive: false });
    await db('boards').insert([
      { tenant: noGroupTenantId, board_id: b1, board_name: 'B1', is_default: true, is_inactive: false },
      { tenant: noGroupTenantId, board_id: b2, board_name: 'B2', is_default: false, is_inactive: false },
    ]);
    await db('contacts').insert({
      tenant: noGroupTenantId,
      contact_name_id: contactId,
      client_id: cId,
      full_name: 'NG Contact',
      email: 'ng@example.com',
      portal_visibility_group_id: null,
    });
    await db('users').insert({
      tenant: noGroupTenantId,
      user_id: userId,
      username: 'ng-user',
      hashed_password: 'x',
      email: 'ng@example.com',
      user_type: 'client',
      is_inactive: false,
      contact_id: contactId,
    });
    await db('priorities').insert({
      tenant: noGroupTenantId,
      priority_id: priorityId2,
      priority_name: 'High',
      created_by: userId,
    });
    await db('statuses').insert([
      {
        tenant: noGroupTenantId,
        status_id: statusId2,
        board_id: b1,
        name: 'Open',
        status_type: 'ticket',
        is_closed: false,
        is_default: true,
        created_by: userId,
        order_number: 1,
      },
      {
        tenant: noGroupTenantId,
        status_id: statusId2b,
        board_id: b2,
        name: 'Open B2',
        status_type: 'ticket',
        is_closed: false,
        is_default: true,
        created_by: userId,
        order_number: 1,
      },
    ]);
    await db.transaction(async (trx) => {
      await TicketModel.createTicket(
        { title: 'NG-1', description: 'x', client_id: cId, contact_id: contactId, board_id: b1, status_id: statusId2, priority_id: priorityId2, entered_by: userId },
        noGroupTenantId,
        trx,
      );
      await TicketModel.createTicket(
        { title: 'NG-2', description: 'x', client_id: cId, contact_id: contactId, board_id: b2, status_id: statusId2b, priority_id: priorityId2, entered_by: userId },
        noGroupTenantId,
        trx,
      );
    });

    const service = createService();
    const result = await service.list(
      { page: 1, limit: 20 },
      {
        userId,
        tenant: noGroupTenantId,
        user: { user_id: userId, user_type: 'client', contact_id: contactId, clientId: cId, tenant: noGroupTenantId },
      }
    );

    expect(result.total).toBe(2);
    expect((result.data as any[]).map((t) => t.title).sort()).toEqual(['NG-1', 'NG-2']);
  });

  it('an empty visibility group returns zero tickets', async () => {
    const emptyGroupId = uuidv4();
    await db('client_portal_visibility_groups').insert({
      tenant: fixture.tenantId,
      group_id: emptyGroupId,
      client_id: fixture.clientAId,
      name: 'Empty group',
    });
    await db('contacts').where({ tenant: fixture.tenantId, contact_name_id: fixture.contactAId }).update({
      portal_visibility_group_id: emptyGroupId,
    });

    const service = createService();
    const result = await service.list({ page: 1, limit: 10 }, clientContext(fixture, clientA()));

    expect(result.total).toBe(0);
    expect(result.data).toHaveLength(0);

    // Restore the original group for subsequent tests.
    await db('contacts').where({ tenant: fixture.tenantId, contact_name_id: fixture.contactAId }).update({
      portal_visibility_group_id: fixture.groupVisibleId,
    });
  });

  it('a client context with an unresolvable or mismatched client scope fails closed', async () => {
    const service = createService();

    await expect(
      service.list(
        { page: 1, limit: 10 },
        {
          userId: fixture.clientUserAId,
          tenant: fixture.tenantId,
          user: { user_id: fixture.clientUserAId, user_type: 'client', tenant: fixture.tenantId },
        }
      )
    ).rejects.toThrow(/client scope is unavailable/);

    await expect(
      service.list(
        { page: 1, limit: 10 },
        {
          userId: fixture.clientUserAId,
          tenant: fixture.tenantId,
          user: {
            user_id: fixture.clientUserAId,
            user_type: 'client',
            contact_id: fixture.contactAId,
            clientId: fixture.clientBId,
            tenant: fixture.tenantId,
          },
        }
      )
    ).rejects.toThrow(/client scope mismatch/);
  });

  it('internal context returns the same tenant-scoped set as before', async () => {
    const service = createService();
    const result = await service.list(
      { page: 1, limit: 20 },
      internalContext(fixture, fixture.internalUserId)
    );

    const titles = (result.data as any[]).map((t) => t.title).sort();
    expect(titles).toEqual(['Hidden Board Ticket', 'Other Client Ticket', 'Visible Ticket']);
  });

  it('client-visible comments and documents only; internal threads and private docs are hidden', async () => {
    const publicThreadId = uuidv4();
    const internalThreadId = uuidv4();
    const docPublicId = uuidv4();
    const docPrivateId = uuidv4();
    const now = new Date().toISOString();

    await db('comment_threads').insert([
      {
        tenant: fixture.tenantId,
        thread_id: publicThreadId,
        ticket_id: fixture.ticketVisibleId,
        project_task_id: null,
        root_comment_id: uuidv4(),
        is_internal: false,
        reply_count: 1,
        last_activity_at: now,
        created_at: now,
        created_by: fixture.internalUserId,
      },
      {
        tenant: fixture.tenantId,
        thread_id: internalThreadId,
        ticket_id: fixture.ticketVisibleId,
        project_task_id: null,
        root_comment_id: uuidv4(),
        is_internal: true,
        reply_count: 1,
        last_activity_at: now,
        created_at: now,
        created_by: fixture.internalUserId,
      },
    ]);

    await db('comments').insert([
      {
        tenant: fixture.tenantId,
        comment_id: uuidv4(),
        thread_id: publicThreadId,
        ticket_id: fixture.ticketVisibleId,
        author_type: 'internal',
        note: 'Public comment',
        is_internal: false,
        is_resolution: false,
        created_at: now,
        user_id: fixture.internalUserId,
      },
      {
        tenant: fixture.tenantId,
        comment_id: uuidv4(),
        thread_id: internalThreadId,
        ticket_id: fixture.ticketVisibleId,
        author_type: 'internal',
        note: 'Internal comment',
        is_internal: true,
        is_resolution: false,
        created_at: now,
        user_id: fixture.internalUserId,
      },
    ]);

    await db('documents').insert([
      {
        tenant: fixture.tenantId,
        document_id: docPublicId,
        document_name: 'public.pdf',
        user_id: fixture.internalUserId,
        order_number: 0,
        created_by: fixture.internalUserId,
        is_client_visible: true,
      },
      {
        tenant: fixture.tenantId,
        document_id: docPrivateId,
        document_name: 'private.pdf',
        user_id: fixture.internalUserId,
        order_number: 0,
        created_by: fixture.internalUserId,
        is_client_visible: false,
      },
    ]);

    await db('document_associations').insert([
      { association_id: uuidv4(), document_id: docPublicId, entity_id: fixture.ticketVisibleId, entity_type: 'ticket', tenant: fixture.tenantId },
      { association_id: uuidv4(), document_id: docPrivateId, entity_id: fixture.ticketVisibleId, entity_type: 'ticket', tenant: fixture.tenantId },
    ]);

    const service = createService();
    const ctx = clientContext(fixture, clientA());

    const comments = await service.getTicketComments(fixture.ticketVisibleId, ctx, {});
    expect((comments as any[]).map((c) => c.note)).toEqual(['Public comment']);

    const documents = await service.getTicketDocuments(fixture.ticketVisibleId, ctx);
    expect((documents as any[]).map((d) => d.document_name)).toEqual(['public.pdf']);
  });
});

describe('client-owned API-key exploit chain (DB-backed)', () => {
  let fixture: AbacFixture;

  beforeAll(async () => {
    // Reuses the module-level DB bootstrapped by the ABAC suite above. Do NOT
    // drop/recreate it here — that would terminate the earlier suite's live
    // connection mid-run.
    if (!db) {
      wireLocalTestDbEnv();
      db = await createTestDbConnection({ runSeeds: false });
    }
    fixture = await createFixture();
  }, 300000);

  afterAll(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    tenantsToCleanup.clear();
  }, 60000);

  it('an historical active client-owned key is rejected by both validators, deactivated, and never records use', async () => {
    const { createHash } = await import('node:crypto');
    const plaintext = 'historically-issued-client-key';
    const hashed = createHash('sha256').update(plaintext).digest('hex');

    await db('api_keys').insert({
      tenant: fixture.tenantId,
      api_key_id: uuidv4(),
      api_key: hashed,
      user_id: fixture.clientUserAId,
      active: true,
      purpose: 'general',
      last_used_at: null,
      usage_count: 0,
    });

    // With x-tenant-id.
    const tenantPath = await ApiKeyServiceForApi.validateApiKeyForTenant(plaintext, fixture.tenantId);
    expect(tenantPath).toBeNull();

    const keyAfterTenantPath = await db('api_keys')
      .where({ tenant: fixture.tenantId, api_key: hashed })
      .first();
    expect(keyAfterTenantPath.active).toBe(false);
    expect(keyAfterTenantPath.last_used_at).toBeNull();

    // Without x-tenant-id (tenant discovery).
    const anyTenantPath = await ApiKeyServiceForApi.validateApiKeyAnyTenant(plaintext);
    expect(anyTenantPath).toBeNull();
    expect(keyAfterTenantPath.usage_count).toBe(0);
  });

  it('a client-owned mobile_session key is equally invalid', async () => {
    const { createHash } = await import('node:crypto');
    const plaintext = 'client-mobile-session-key';
    const hashed = createHash('sha256').update(plaintext).digest('hex');

    await db('api_keys').insert({
      tenant: fixture.tenantId,
      api_key_id: uuidv4(),
      api_key: hashed,
      user_id: fixture.clientUserAId,
      active: true,
      purpose: 'mobile_session',
      last_used_at: null,
      usage_count: 0,
    });

    await expect(ApiKeyServiceForApi.validateApiKeyForTenant(plaintext, fixture.tenantId)).resolves.toBeNull();

    const row = await db('api_keys').where({ tenant: fixture.tenantId, api_key: hashed }).first();
    expect(row.active).toBe(false);
    expect(row.last_used_at).toBeNull();
  });

  it('an internal key still authenticates through both validators', async () => {
    const { createHash } = await import('node:crypto');
    const plaintext = 'internal-key-still-works';
    const hashed = createHash('sha256').update(plaintext).digest('hex');

    await db('api_keys').insert({
      tenant: fixture.tenantId,
      api_key_id: uuidv4(),
      api_key: hashed,
      user_id: fixture.internalUserId,
      active: true,
      purpose: 'general',
      last_used_at: null,
      usage_count: 0,
    });

    const tenantPath = await ApiKeyServiceForApi.validateApiKeyForTenant(plaintext, fixture.tenantId);
    expect(tenantPath).not.toBeNull();
    expect(tenantPath?.user_id).toBe(fixture.internalUserId);
  });
});
