import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as any,
  tenant: '' as string,
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

const permissionRef = vi.hoisted(() => ({
  canDeleteDocument: true,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async (_user: any, resource: string, action: string) => {
    if (resource === 'document' && action === 'delete') {
      return permissionRef.canDeleteDocument;
    }
    return false;
  }),
}));

import { deleteDraftClipboardImages } from '@alga-psa/tickets/actions/comment-actions/clipboardImageDraftActions';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
const tenantsToCleanup = new Set<string>();

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'document_associations').del();
  await tenantTable(tenantId, 'documents').del();
  await tenantTable(tenantId, 'comments').del();
  await tenantTable(tenantId, 'tickets').del();
  await tenantTable(tenantId, 'next_number').del();
  await tenantTable(tenantId, 'statuses').del();
  await tenantTable(tenantId, 'priorities').del();
  await tenantTable(tenantId, 'boards').del();
  await tenantTable(tenantId, 'contacts').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function seedFixture() {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const clientId = uuidv4();
  const ticketId = uuidv4();
  const statusId = uuidv4();
  const priorityId = uuidv4();
  const boardId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    product_code: 'algadesk',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `user-${tenantId.slice(0, 8)}@example.com`,
    user_type: 'internal',
    is_inactive: false,
    created_at: db.fn.now(),
  });

  await tenantTable(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${tenantId.slice(0, 8)}`,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await tenantTable(tenantId, 'boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: 'Support',
    is_default: true,
    is_inactive: false,
  });

  await tenantTable(tenantId, 'priorities').insert({
    tenant: tenantId,
    priority_id: priorityId,
    priority_name: 'High',
    item_type: 'ticket',
    color: '#EF4444',
    order_number: 10,
    created_by: userId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await tenantTable(tenantId, 'statuses').insert({
    tenant: tenantId,
    status_id: statusId,
    board_id: boardId,
    name: 'Open',
    status_type: 'ticket',
    is_closed: false,
    is_default: true,
    order_number: 10,
    created_by: userId,
    created_at: db.fn.now(),
  });

  await tenantTable(tenantId, 'tickets').insert({
    tenant: tenantId,
    ticket_id: ticketId,
    ticket_number: `T-${Date.now()}`,
    title: 'Ticket with draft images',
    client_id: clientId,
    board_id: boardId,
    status_id: statusId,
    priority_id: priorityId,
    entered_by: userId,
    entered_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  const deletableDocumentId = uuidv4();
  const blockedDocumentId = uuidv4();

  await tenantTable(tenantId, 'documents').insert([
    {
      tenant: tenantId,
      document_id: deletableDocumentId,
      document_name: 'draft-inline-image.png',
      mime_type: 'image/png',
      // documents.file_id has an FK to external_files; drafts in this test
      // never touch storage, so leave it unset (the action's reference-token
      // matching falls back to document_id).
      file_id: null,
      content: null,
      created_by: userId,
      user_id: userId,
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
      is_client_visible: false,
    },
    {
      tenant: tenantId,
      document_id: blockedDocumentId,
      document_name: 'shared-image.png',
      mime_type: 'image/png',
      file_id: null,
      content: null,
      created_by: userId,
      user_id: userId,
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
      is_client_visible: false,
    },
  ]);

  await tenantTable(tenantId, 'document_associations').insert([
    {
      tenant: tenantId,
      document_id: deletableDocumentId,
      entity_type: 'ticket',
      entity_id: ticketId,
      created_at: db.fn.now(),
    },
    {
      tenant: tenantId,
      document_id: blockedDocumentId,
      entity_type: 'ticket',
      entity_id: ticketId,
      created_at: db.fn.now(),
    },
    {
      tenant: tenantId,
      document_id: blockedDocumentId,
      entity_type: 'client',
      entity_id: clientId,
      created_at: db.fn.now(),
    },
  ]);

  return { tenantId, userId, ticketId, deletableDocumentId, blockedDocumentId };
}

describe('AlgaDesk ticket attachment draft integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
    dbRef.knex = db;
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('T011: deletes ticket-scoped draft image attachments while blocking non-ticket/shared docs and keeps AlgaDesk composition restrictions', async () => {
    const fixture = await seedFixture();

    dbRef.tenant = fixture.tenantId;
    userRef.user = { user_id: fixture.userId, tenant: fixture.tenantId };
    permissionRef.canDeleteDocument = true;

    const deletedByAction: string[] = [];
    const result = await deleteDraftClipboardImages({
      ticketId: fixture.ticketId,
      documentIds: [fixture.deletableDocumentId, fixture.blockedDocumentId],
      deleteDocumentFn: async (documentId: string) => {
        deletedByAction.push(documentId);
        await tenantTable(fixture.tenantId, 'document_associations').where({ document_id: documentId }).del();
        await tenantTable(fixture.tenantId, 'documents').where({ document_id: documentId }).del();
        return { success: true, deleted: true };
      },
    });

    expect(result.deletedDocumentIds).toEqual([fixture.deletableDocumentId]);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ documentId: fixture.blockedDocumentId, reason: 'has_other_associations' }),
    );
    expect(deletedByAction).toEqual([fixture.deletableDocumentId]);

    permissionRef.canDeleteDocument = false;
    await expect(
      deleteDraftClipboardImages({
        ticketId: fixture.ticketId,
        documentIds: [fixture.deletableDocumentId],
        deleteDocumentFn: async () => ({ success: true, deleted: true }),
      }),
    ).rejects.toThrow('Permission denied: cannot delete document attachments.');

  }, HOOK_TIMEOUT);
});
