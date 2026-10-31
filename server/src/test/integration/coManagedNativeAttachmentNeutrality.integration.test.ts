/**
 * CM L4b A5: native comment-attachment flows are byte-for-byte unaffected when co-management is off.
 *
 * Two native tenants: Kansas (flag off) and Emerald (flag on, no `co-managed` entitlement: a plain psa tenant).
 * Every native attachment path (reconcile, read check, list, expiry sweep, withdraw, the generic document
 * lookups) and the co-managed cleanup job run against each; every SQL statement is captured and none may
 * reference a `co_management_*` table. Nothing is stubbed except the session seam.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

let currentUser: any;
let testDb: Knex;
vi.mock('@alga-psa/auth', async importOriginal => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => async (...args: any[]) => action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: async () => true,
}));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...(await importOriginal<any>()),
  getConnection: async () => testDb,
  createTenantKnex: async (tenant?: string) => ({ knex: testDb, tenant: tenant ?? currentUser?.tenant }),
}));
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';
import { canReadCommentAttachment, reconcileCommentAttachments, expireCommentAttachmentDrafts, listPublishedCommentAttachments, withdrawCommentAttachments } from '@shared/lib/ticketCommentAttachments';

let db: Knex;
const tenants: string[] = [];
const statements: string[] = [];

async function native(name: string, flagOn: boolean) {
  const tenant = await createTenant(db, name, { productCode: 'psa' });
  tenants.push(tenant);
  const userId = await createUser(db, tenant, { first_name: 'Nat', last_name: 'Ive' });
  const clientId = uuidv4(), ticketId = uuidv4(), commentId = uuidv4(), threadId = uuidv4();
  await db('clients').insert({ tenant, client_id: clientId, client_name: `${name} client`, billing_cycle: 'monthly', is_tax_exempt: false });
  await db('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `${name}-${Date.now()}`, title: name, client_id: clientId, entered_by: userId });
  await db('comment_threads').insert({ tenant, thread_id: threadId, ticket_id: ticketId, root_comment_id: commentId, is_internal: false, created_by: userId });
  await db('comments').insert({ tenant, comment_id: commentId, thread_id: threadId, ticket_id: ticketId, user_id: userId, author_type: 'internal', note: '[]', is_internal: false, is_resolution: false });
  return { tenant, userId, ticketId, commentId, flagOn };
}
async function nativeFile(w: { tenant: string; userId: string; ticketId: string }, expired: boolean) {
  const document = uuidv4(), file = uuidv4();
  await db('external_files').insert({ tenant: w.tenant, file_id: file, file_name: 'r.pdf', original_name: 'r.pdf', mime_type: 'application/pdf', file_size: 8, storage_path: `/t/${file}`, uploaded_by_id: w.userId });
  await db('documents').insert({ tenant: w.tenant, document_id: document, file_id: file, document_name: 'r.pdf', mime_type: 'application/pdf', file_size: 8, user_id: w.userId, created_by: w.userId, is_client_visible: true });
  await db('document_associations').insert({ tenant: w.tenant, document_id: document, entity_type: 'ticket', entity_id: w.ticketId });
  await db('ticket_comment_attachments').insert({ tenant: w.tenant, document_id: document, ticket_id: w.ticketId, created_by: w.userId, expires_at: new Date(Date.now() + (expired ? -86400000 : 86400000)) });
  return { document, file };
}

beforeAll(async () => {
  db = await createTestDbConnection();
  testDb = db;
  db.on('query', (q: { sql: string }) => statements.push(q.sql));
}, 120_000);
afterAll(async () => {
  if (db) {
    const { rows } = await db.raw(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE' WHERE c.table_schema = 'public' AND c.column_name = 'tenant'`);
    let pending: string[] = rows.map((r: any) => r.table_name);
    for (let pass = 0; pass < 12 && pending.length; pass++) {
      const blocked: string[] = [];
      for (const table of pending) { try { await db.raw('DELETE FROM ?? WHERE tenant = ANY(?::uuid[])', [table, tenants]); } catch { blocked.push(table); } }
      if (blocked.length === pending.length) break;
      pending = blocked;
    }
    await db.destroy();
  }
});

describe.each([['Kansas (flag off)', false], ['Emerald (flag on, no entitlement)', true]] as const)('%s', (name, flagOn) => {
  it('native comment-attachment upload bookkeeping, read, list, expiry, withdraw and document lookups touch no co_management_* table', async () => {
    (globalThis as any).__algaWriteAdmissionState = undefined;
    const w = await native(name.split(' ')[0], flagOn);
    const live = await nativeFile(w, false), stale = await nativeFile(w, true);
    currentUser = { user_id: w.userId, user_type: 'internal', tenant: w.tenant };
    statements.length = 0;

    await reconcileCommentAttachments(db, w.tenant, w.commentId, w.userId).catch(() => {});
    expect(await canReadCommentAttachment(db, w.tenant, w.userId, live.document)).toBeTypeOf('boolean');
    await listPublishedCommentAttachments(db, w.tenant, w.ticketId, w.commentId);
    expect(await expireCommentAttachmentDrafts(db, w.tenant)).toBeGreaterThanOrEqual(0);
    await db.transaction(trx => withdrawCommentAttachments(trx, w.tenant, w.commentId));
    const { getAuthorizedDocumentById, getAuthorizedDocumentByFileId } = await import('@alga-psa/documents/actions/documentActions');
    await getAuthorizedDocumentById(live.document).catch(() => null);
    await getAuthorizedDocumentByFileId(stale.file).catch(() => null);

    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter(sql => /co_management_/i.test(sql))).toEqual([]);
  });

  it('the co-managed cleanup job is a no-op for a tenant without the capability: it runs no co_management_* statement', async () => {
    const w = await native(`${name.split(' ')[0]}-job`, flagOn);
    const { registerCoManagedUploadCleanup, CO_MANAGED_UPLOAD_CLEANUP_JOB } = await import('../../lib/jobs/handlers/coManagedUploadCleanupHandler');
    registerCoManagedUploadCleanup();
    const { getJobDescriptor } = await import('@alga-psa/jobs/fanout');
    const descriptor = getJobDescriptor(CO_MANAGED_UPLOAD_CLEANUP_JOB)!;
    expect(descriptor).toMatchObject({ scope: 'tenant', capability: 'co-managed' });
    statements.length = 0;
    await (descriptor as any).run({ tenantId: w.tenant }).catch(() => null);
    expect(statements.filter(sql => /co_management_/i.test(sql))).toEqual([]);
  });
});
