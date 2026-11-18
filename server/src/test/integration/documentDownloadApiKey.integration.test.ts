/**
 * GET /api/documents/download/{fileId} accepts API keys (alga ticket: Joymode's 401 on
 * `?format=markdown`), through the shared document-route principal.
 *
 * For each export format (markdown, pdf, original file):
 * - internal user's API key -> 200
 * - no credentials -> 401
 * - client-portal user's API key -> 401 (assertApiPrincipal)
 * - session -> unchanged (200)
 */
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { NextRequest } from 'next/server';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

const MARKDOWN_BODY = 'EXPORT-BODY-TEXT';
const FILE_BYTES = Buffer.from('%PDF-1.4 original file bytes');

vi.mock('@alga-psa/authorization/rbac', () => ({ hasPermission: async () => true }));

const refs = vi.hoisted(() => ({
  db: null as any,
  tenantId: '',
  sessionUser: null as any,
  keys: new Map<string, { tenant: string; user_id: string }>(),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: refs.db, tenant: refs.tenantId })),
}));
vi.mock('server/src/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('server/src/lib/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: refs.db, tenant: refs.tenantId })),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: vi.fn(async () => refs.sessionUser) }));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: { validateApiKeyAnyTenant: vi.fn(async (key: string) => refs.keys.get(key) ?? null) },
}));
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async (userId: string, tenant: string) =>
    tenantDb(refs.db, tenant).table('users').where({ user_id: userId }).first(),
  ),
}));
vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: {
    downloadFile: vi.fn(async () => ({ buffer: FILE_BYTES, metadata: { mime_type: 'application/pdf' } })),
  },
}));
vi.mock('@alga-psa/billing/services', () => ({
  createPDFGenerationService: () => ({ generateAndStore: vi.fn(async () => ({ file_id: 'generated-file' })) }),
}));

let db: Knex;
let tenantId: string;
let internalUserId: string;
let clientUserId: string;
let getDownload: typeof import('../../app/api/documents/download/[fileId]/route').GET;
let documentIds: string[] = [];
let fileIds: string[] = [];
let contactIds: string[] = [];
let clientIds: string[] = [];
const table = (name: string) => tenantDb(db, tenantId).table(name);

async function createDoc(opts: { fileId?: string | null; name: string }) {
  const documentId = uuidv4();
  if (opts.fileId) {
    await table('external_files').insert({
      tenant: tenantId, file_id: opts.fileId, file_name: 'scan.pdf', original_name: 'scan.pdf',
      mime_type: 'application/pdf', file_size: FILE_BYTES.length, storage_path: `/t/${opts.fileId}`, uploaded_by_id: internalUserId,
    });
    fileIds.push(opts.fileId);
  }
  await table('documents').insert({
    tenant: tenantId, document_id: documentId, document_name: opts.name, content: '',
    created_by: internalUserId, user_id: internalUserId, entered_at: new Date(), updated_at: new Date(),
    file_id: opts.fileId ?? null, mime_type: opts.fileId ? 'application/pdf' : null,
  });
  if (!opts.fileId) {
    await table('document_content').insert({
      tenant: tenantId, id: uuidv4(), document_id: documentId, content: MARKDOWN_BODY,
      created_by_id: internalUserId, updated_by_id: internalUserId,
    });
  }
  documentIds.push(documentId);
  return documentId;
}

const call = (id: string, format: string | null, headers: Record<string, string> = {}) =>
  getDownload(
    new NextRequest(`http://localhost/api/documents/download/${id}${format ? `?format=${format}` : ''}`, { headers }),
    { params: Promise.resolve({ fileId: id }) },
  );

describe('document download/export route accepts API keys', () => {
  let inAppDocId: string;
  let fileDocId: string;
  const fileId = uuidv4();

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'Document Download ApiKey Tenant');
    internalUserId = await createUser(db, tenantId, { username: 'dl-internal' });

    const clientId = uuidv4();
    await table('clients').insert({ client_id: clientId, tenant: tenantId, client_name: 'DL Client', created_at: new Date(), updated_at: new Date() });
    clientIds.push(clientId);
    const contactId = uuidv4();
    await table('contacts').insert({
      contact_name_id: contactId, tenant: tenantId, client_id: clientId, full_name: 'DL Contact',
      email: `dl-${contactId.slice(0, 8)}@test.com`, created_at: new Date(), updated_at: new Date(),
    });
    contactIds.push(contactId);
    clientUserId = await createUser(db, tenantId, { username: 'dl-client', user_type: 'client', contact_id: contactId });

    refs.db = db;
    refs.tenantId = tenantId;
    refs.keys.set('internal-key', { tenant: tenantId, user_id: internalUserId });
    refs.keys.set('client-key', { tenant: tenantId, user_id: clientUserId });
    getDownload = (await import('../../app/api/documents/download/[fileId]/route')).GET;

    inAppDocId = await createDoc({ name: 'In-app note' });
    fileDocId = await createDoc({ name: 'Scan.pdf', fileId });
  }, 120_000);

  afterAll(async () => {
    const safe = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* teardown only */ } };
    for (const id of documentIds) {
      await safe(() => table('document_content').where({ document_id: id }).del());
      await safe(() => table('documents').where({ document_id: id }).del());
    }
    for (const id of fileIds) await safe(() => table('external_files').where({ file_id: id }).del());
    await safe(() => table('users').where({ user_id: clientUserId }).del());
    for (const id of contactIds) await safe(() => table('contacts').where({ contact_name_id: id }).del());
    for (const id of clientIds) await safe(() => table('clients').where({ client_id: id }).del());
    await db?.destroy();
  });

  afterEach(() => {
    refs.sessionUser = null;
  });

  const FORMATS: Array<{ label: string; format: string | null; target: () => string; check: (r: Response) => Promise<void> }> = [
    {
      label: 'markdown',
      format: 'markdown',
      target: () => inAppDocId,
      check: async (r) => {
        expect(r.headers.get('content-type')).toContain('text/markdown');
        expect(await r.text()).toContain(MARKDOWN_BODY);
      },
    },
    {
      label: 'pdf',
      format: 'pdf',
      target: () => inAppDocId,
      check: async (r) => {
        expect(r.headers.get('content-type')).toBe('application/pdf');
        expect(Buffer.from(await r.arrayBuffer()).equals(FILE_BYTES)).toBe(true);
      },
    },
    {
      label: 'original',
      format: null,
      target: () => fileDocId,
      check: async (r) => {
        expect(r.headers.get('content-type')).toBe('application/pdf');
        expect(r.headers.get('content-disposition')).toContain('Scan.pdf');
        expect(Buffer.from(await r.arrayBuffer()).equals(FILE_BYTES)).toBe(true);
      },
    },
  ];

  for (const f of FORMATS) {
    describe(f.label, () => {
      it('internal user API key -> 200', async () => {
        const r = await call(f.target(), f.format, { 'x-api-key': 'internal-key' });
        expect(r.status).toBe(200);
        await f.check(r);
      });

      it('no credentials -> 401', async () => {
        const r = await call(f.target(), f.format);
        expect(r.status).toBe(401);
      });

      it('unknown API key -> 401', async () => {
        const r = await call(f.target(), f.format, { 'x-api-key': 'nope' });
        expect(r.status).toBe(401);
      });

      it('client-portal user API key -> 401', async () => {
        const r = await call(f.target(), f.format, { 'x-api-key': 'client-key' });
        expect(r.status).toBe(401);
      });

      it('session user -> unchanged (200)', async () => {
        refs.sessionUser = await tenantDb(db, tenantId).table('users').where({ user_id: internalUserId }).first();
        const r = await call(f.target(), f.format);
        expect(r.status).toBe(200);
        await f.check(r);
      });
    });
  }
});
