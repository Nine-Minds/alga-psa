import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import * as dbModule from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { StorageProviderFactory } from '@alga-psa/storage';
import { NextRequest } from 'next/server';

// Session/permission plumbing mirrors ticketCommentAttachmentsIntegration so these
// tests exercise the real route handlers rather than a reimplementation of them.
const routeSession = vi.hoisted(() => ({ user: null as any, permitted: true, documentsPermitted: true }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => routeSession.user }));
vi.mock('@alga-psa/auth', async importOriginal => ({ ...await importOriginal<typeof import('@alga-psa/auth')>(),
  withAuth: (fn: any) => (...args: any[]) => fn(routeSession.user, { tenant: routeSession.user?.tenant }, ...args),
  hasPermission: async (_user: unknown, resource: string) => routeSession.permitted && (resource !== 'document' || routeSession.documentsPermitted),
  getCurrentUser: async () => routeSession.user,
  getSession: async () => routeSession.user ? { session_id: 'test-session', user: { id: routeSession.user.user_id, tenant: routeSession.user.tenant, user_type: routeSession.user.user_type } } : null,
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_user: unknown, resource: string) => routeSession.permitted && (resource !== 'document' || routeSession.documentsPermitted),
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: async () => routeSession.permitted }));
// Real PDF generation needs a renderer that does not exist in the test harness; left
// unmocked the ?format=pdf branch 500s and its deny-assertion would be vacuous.
const pdfGenerated = vi.hoisted(() => vi.fn(async () => ({ file_id: 'generated-pdf-file' })));
vi.mock('@alga-psa/billing/services', async importOriginal => ({ ...await importOriginal<any>(),
  createPDFGenerationService: () => ({ generateAndStore: pdfGenerated }),
}));
// The route handlers import createTenantKnex from server/src/lib/db, NOT @alga-psa/db.
// Without this the routes open a real pool that cannot see the test transaction, and
// every assertion would pass vacuously on a 404.
const routeDb = vi.hoisted(() => ({ knex: null as any, tenant: null as any }));
vi.mock('server/src/lib/db', async importOriginal => ({ ...await importOriginal<any>(),
  createTenantKnex: async () => ({ knex: routeDb.knex, tenant: routeDb.tenant }),
}));
vi.mock('@/lib/db', async importOriginal => ({ ...await importOriginal<any>(),
  createTenantKnex: async () => ({ knex: routeDb.knex, tenant: routeDb.tenant }),
}));
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { reconcileCommentAttachments, canReadCommentAttachment } from '@shared/lib/ticketCommentAttachments';
import { authorizeAndRedactDocuments } from '@alga-psa/documents/actions/documentActions';

/**
 * Regression coverage for the attachment-authorization bypass: a withdrawn or
 * out-of-audience comment attachment must never be turned into bytes, by any
 * addressing mode (file_id or document_id) or any export format.
 *
 * These assert on real HTTP responses and on whether storage was touched at all,
 * so they fail if the authorization term is removed from the shared engine.
 */
describe('document download authorization (migrated PostgreSQL)', () => {
  let conn: Knex;
  let trx: Knex.Transaction;
  let tenant: string, actor: string, clientUser: string, otherUser: string, client: string, ticket: string, comment: string;
  const table = (name: string) => tenantDb(trx, tenant).table(name);
  const recipient = 'download-recipient@example.test';
  let connectionSpy: ReturnType<typeof vi.spyOn>;
  // Two distinct byte sources: StorageService.downloadFile serves originals, while
  // preview/thumbnail go through StorageProviderFactory. Both are spied so a test can
  // assert storage was never touched, not merely that the response body was empty.
  let storage: ReturnType<typeof vi.spyOn>;
  let providerDownload: ReturnType<typeof vi.fn>;

  beforeAll(async () => { conn = await createTestDbConnection(); });
  afterAll(async () => { await conn?.destroy(); });

  beforeEach(async () => {
    trx = await conn.transaction();
    tenant = randomUUID(); actor = randomUUID(); clientUser = randomUUID(); otherUser = randomUUID();
    client = randomUUID(); ticket = randomUUID();
    await tenantDb(trx, tenant).unscoped('tenants', 'create isolated test tenant')
      .insert({ tenant, client_name: 'Download tests', email: 'tenant@example.test', product_code: 'psa' });
    const otherClient = randomUUID(), contact = randomUUID(), otherContact = randomUUID();
    await table('clients').insert([{tenant,client_id:client,client_name:'A'},{tenant,client_id:otherClient,client_name:'B'}]);
    await table('contacts').insert([
      {tenant,contact_name_id:contact,client_id:client,full_name:'Recipient',email:recipient},
      {tenant,contact_name_id:otherContact,client_id:otherClient,full_name:'Other',email:'other@example.test'},
    ]);
    await table('users').insert([
      {tenant,user_id:actor,username:actor,email:'agent@example.test',hashed_password:'unused',user_type:'internal',is_inactive:false},
      {tenant,user_id:clientUser,username:clientUser,email:recipient,hashed_password:'unused',user_type:'client',contact_id:contact,is_inactive:false},
      {tenant,user_id:otherUser,username:otherUser,email:'other@example.test',hashed_password:'unused',user_type:'client',contact_id:otherContact,is_inactive:false},
    ]);
    await table('tickets').insert({tenant,ticket_id:ticket,ticket_number:'DL-1',client_id:client,title:'Download tests',entered_by:actor});
    comment = await makeComment();
    connectionSpy = vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: trx, tenant } as any);
    routeDb.knex = trx; routeDb.tenant = tenant;
    storage = vi.spyOn(StorageService, 'downloadFile')
      .mockResolvedValue({ buffer: Buffer.from('SECRET-BYTES'), metadata: { mime_type: 'application/pdf' } } as any);
    providerDownload = vi.fn(async () => Buffer.from('SECRET-BYTES'));
    vi.spyOn(StorageProviderFactory, 'createProvider').mockResolvedValue({
      download: providerDownload,
      // The view route streams rather than buffers; without this it 500s and every
      // view assertion would pass vacuously.
      getReadStream: (...args: unknown[]) => {
        providerDownload(...(args as []));
        return Readable.from([Buffer.from('SECRET-BYTES')]);
      },
    } as any);
    routeSession.permitted = true; routeSession.documentsPermitted = true;
  });
  afterEach(async () => { vi.restoreAllMocks(); await trx?.rollback(); });

  async function makeComment(overrides: Record<string, unknown> = {}) {
    const id = randomUUID(), thread = randomUUID();
    await table('comment_threads').insert({tenant,thread_id:thread,ticket_id:ticket,root_comment_id:id,is_internal:overrides.is_internal ?? false,created_by:actor});
    await table('comments').insert({tenant,comment_id:id,thread_id:thread,ticket_id:ticket,user_id:actor,author_type:'internal',note:'[]',is_internal:false,is_resolution:false,publish_state:'published',...overrides});
    return id;
  }
  async function upload(name = 'report.pdf', owner = actor) {
    const document = randomUUID(), file = randomUUID();
    // Derived renditions must exist, otherwise preview/thumbnail 404 on a null
    // preview_file_id and their deny-assertions would pass vacuously.
    const preview = randomUUID(), thumbnail = randomUUID();
    await table('external_files').insert([
      {tenant,file_id:file,file_name:name,original_name:name,mime_type:'application/pdf',file_size:12,storage_path:`/test/${file}`,uploaded_by_id:owner},
      {tenant,file_id:preview,file_name:'preview.jpg',original_name:'preview.jpg',mime_type:'image/jpeg',file_size:12,storage_path:`/test/${preview}`,uploaded_by_id:owner},
      {tenant,file_id:thumbnail,file_name:'thumb.jpg',original_name:'thumb.jpg',mime_type:'image/jpeg',file_size:12,storage_path:`/test/${thumbnail}`,uploaded_by_id:owner},
    ]);
    await table('documents').insert({tenant,document_id:document,file_id:file,document_name:name,mime_type:'application/pdf',file_size:12,user_id:owner,created_by:owner,is_client_visible:true,preview_file_id:preview,thumbnail_file_id:thumbnail,preview_generated_at:new Date()});
    await table('document_associations').insert({tenant,document_id:document,entity_type:'ticket',entity_id:ticket});
    await table('ticket_comment_attachments').insert({tenant,document_id:document,ticket_id:ticket,created_by:owner,expires_at:new Date(Date.now()+86400000)});
    // Exportable body, so the ?format=markdown branch has something to return for an
    // authorized user — otherwise it 404s on "no content" and proves nothing.
    await table('document_block_content').insert({
      tenant, content_id: randomUUID(), document_id: document,
      block_data: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'SECRET-CONTENT' }] }]),
    });
    return { document, file };
  }
  function note(...files: string[]) {
    return JSON.stringify(files.map(file => ({type:'file',props:{url:`/api/documents/download/${file}`,name:'report.pdf'}})));
  }
  async function attach(file: string, id = comment, user = actor) {
    await table('comments').where({comment_id:id}).update({note:note(file)});
    await reconcileCommentAttachments(trx, tenant, id, user);
  }
  async function withdraw(id = comment, user = actor) {
    await table('comments').where({comment_id:id}).update({note:note()});
    await reconcileCommentAttachments(trx, tenant, id, user);
  }
  const asUser = async (id: string, clientId?: string) => {
    routeSession.user = { ...await table('users').where({ user_id: id }).first(), tenant, ...(clientId ? { clientId } : {}) };
  };

  /** Every addressing mode / export format that turns an id into bytes. */
  async function fetchAllWays(ids: { document: string; file: string }) {
    const download = (await import('@/app/api/documents/download/[fileId]/route')).GET;
    const view = (await import('@/app/api/documents/view/[fileId]/route')).GET;
    const byIdDownload = (await import('@/app/api/documents/[documentId]/download/route')).GET;
    const preview = (await import('@/app/api/documents/[documentId]/preview/route')).GET;
    const thumbnail = (await import('@/app/api/documents/[documentId]/thumbnail/route')).GET;
    const content = (await import('@/app/api/documents/[documentId]/content/route')).GET;
    const req = (url: string) => new NextRequest(url, { headers: { 'cache-control': 'no-store' } });
    const base = 'http://localhost/api/documents';
    // Cleared here so "storage was never touched" is measured across exactly this sweep.
    storage.mockClear(); providerDownload.mockClear();
    return {
      // file-id addressed
      plainByFile: await download(req(`${base}/download/${ids.file}`), { params: Promise.resolve({ fileId: ids.file }) }),
      markdownByFile: await download(req(`${base}/download/${ids.file}?format=markdown`), { params: Promise.resolve({ fileId: ids.file }) }),
      pdfByFile: await download(req(`${base}/download/${ids.file}?format=pdf`), { params: Promise.resolve({ fileId: ids.file }) }),
      viewByFile: await view(req(`${base}/view/${ids.file}`), { params: Promise.resolve({ fileId: ids.file }) }),
      // document-id addressed (the route accepts either in the fileId slot)
      plainByDocument: await download(req(`${base}/download/${ids.document}`), { params: Promise.resolve({ fileId: ids.document }) }),
      viewByDocument: await view(req(`${base}/view/${ids.document}`), { params: Promise.resolve({ fileId: ids.document }) }),
      documentDownload: await byIdDownload(req(`${base}/${ids.document}/download`), { params: Promise.resolve({ documentId: ids.document }) }),
      documentPreview: await preview(req(`${base}/${ids.document}/preview`), { params: Promise.resolve({ documentId: ids.document }) }),
      documentThumbnail: await thumbnail(req(`${base}/${ids.document}/thumbnail`), { params: Promise.resolve({ documentId: ids.document }) }),
      // Derived text rather than file bytes, but the same defect class.
      documentContent: await content(req(`${base}/${ids.document}/content`), { params: Promise.resolve({ documentId: ids.document }) }),
      markdownByDocument: await download(req(`${base}/download/${ids.document}?format=markdown`), { params: Promise.resolve({ fileId: ids.document }) }),
      pdfByDocument: await download(req(`${base}/download/${ids.document}?format=pdf`), { params: Promise.resolve({ fileId: ids.document }) }),
    };
  }

  async function expectNoBytes(responses: Record<string, Response>) {
    for (const [label, response] of Object.entries(responses)) {
      expect.soft(response.status, `${label} must not return 200`).not.toBe(200);
      expect.soft([401, 403, 404], `${label} status ${response.status}`).toContain(response.status);
      const body = await response.clone().text();
      expect.soft(body, `${label} leaked bytes`).not.toContain('SECRET-BYTES');
      expect.soft(body, `${label} leaked content`).not.toContain('SECRET-CONTENT');
    }
    // The strongest form of the assertion: an unauthorized request must never reach
    // storage at all. A route that fetched bytes and then discarded them would still
    // have loaded the file into memory and still be one refactor from leaking it.
    expect.soft(storage, 'StorageService.downloadFile was called while denied').not.toHaveBeenCalled();
    expect.soft(providerDownload, 'storage provider download was called while denied').not.toHaveBeenCalled();
  }

  it('denies a withdrawn (state=removed) attachment on every route and addressing mode', async () => {
    const { document, file } = await upload();
    await attach(file);
    await withdraw();
    expect((await table('ticket_comment_attachments').where({ document_id: document }).first()).state).toBe('removed');

    await asUser(actor);
    await expectNoBytes(await fetchAllWays({ document, file }));
    expect(await canReadCommentAttachment(trx, tenant, actor, document)).toBe(false);
  });

  it('denies a client-portal user an attachment on an internal (non-client-visible) comment', async () => {
    const internalComment = await makeComment({ is_internal: true });
    const { document, file } = await upload();
    await attach(file, internalComment);

    await asUser(clientUser, client);
    await expectNoBytes(await fetchAllWays({ document, file }));
    expect(await canReadCommentAttachment(trx, tenant, clientUser, document)).toBe(false);
  });

  it('denies a client-portal user from a different client', async () => {
    const { document, file } = await upload();
    await attach(file);

    await asUser(otherUser, randomUUID());
    await expectNoBytes(await fetchAllWays({ document, file }));
    expect(await canReadCommentAttachment(trx, tenant, otherUser, document)).toBe(false);
  });

  it('denies a cross-tenant user', async () => {
    const { document, file } = await upload();
    await attach(file);

    const foreignTenant = randomUUID();
    await tenantDb(trx, foreignTenant).unscoped('tenants', 'create isolated test tenant')
      .insert({ tenant: foreignTenant, client_name: 'Foreign', email: 'foreign@example.test', product_code: 'psa' });
    const foreignUser = randomUUID();
    await tenantDb(trx, foreignTenant).table('users').insert({
      tenant: foreignTenant, user_id: foreignUser, username: foreignUser, email: 'foreign@example.test',
      hashed_password: 'unused', user_type: 'internal', is_inactive: false,
    });
    routeSession.user = { user_id: foreignUser, tenant: foreignTenant, user_type: 'internal' };
    await expectNoBytes(await fetchAllWays({ document, file }));
  });

  // Guard against over-blocking, and — just as important — prove the deny assertions
  // above are not vacuous: the very same sweep must return 200 for an allowed user.
  // Without this, a route that 404s for unrelated harness reasons would look "secure".
  it('still serves a currently-attached attachment to the technician on every route', async () => {
    const { document, file } = await upload();
    await attach(file);
    await asUser(actor);

    const responses = await fetchAllWays({ document, file });
    for (const [label, response] of Object.entries(responses)) {
      expect.soft(response.status, `${label} should be readable but returned ${response.status}`).toBe(200);
    }
    expect(await responses.plainByFile.clone().text()).toContain('SECRET-BYTES');
    expect(await responses.documentThumbnail.clone().text()).toContain('SECRET-BYTES');
    expect(await responses.documentPreview.clone().text()).toContain('SECRET-BYTES');
    expect(storage).toHaveBeenCalled();
    expect(providerDownload).toHaveBeenCalled();
    expect(await canReadCommentAttachment(trx, tenant, actor, document)).toBe(true);
  });

  it('still serves a public attachment to the requester audience', async () => {
    const { document, file } = await upload();
    await attach(file);
    await asUser(clientUser, client);

    expect(await canReadCommentAttachment(trx, tenant, clientUser, document)).toBe(true);
    const [allowed] = await authorizeAndRedactDocuments(
      trx, tenant, routeSession.user, [await table('documents').where({ document_id: document }).first()],
    );
    expect(allowed).toBeTruthy();
    expect(allowed.comment_attachment_is_public).toBe(true);
  });

  it('annotates comment_attachment_is_public=false once the attachment is withdrawn', async () => {
    const { document, file } = await upload();
    await attach(file);
    await withdraw();
    await asUser(actor);
    const [allowed] = await authorizeAndRedactDocuments(
      trx, tenant, routeSession.user, [await table('documents').where({ document_id: document }).first()],
    );
    expect(allowed).toBeUndefined();
  });

  // The content route returns block_data / text content rather than file bytes, but it
  // is the same defect class: an id turned into document payload. It previously gated on
  // `document:read` alone, so any tenant user could read a withdrawn attachment's content.
  it('denies withdrawn / out-of-audience attachments on the content route', async () => {
    const content = (await import('@/app/api/documents/[documentId]/content/route')).GET;
    const req = (id: string) => new NextRequest(`http://localhost/api/documents/${id}/content`, { headers: { 'cache-control': 'no-store' } });

    const withdrawn = await upload(); // upload() already seeds SECRET-CONTENT block data
    await attach(withdrawn.file);
    await withdraw();

    await asUser(actor);
    const denied = await content(req(withdrawn.document), { params: Promise.resolve({ documentId: withdrawn.document }) });
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain('SECRET-CONTENT');

    // An internal comment's attachment must stay unreadable for the portal audience.
    const internalComment = await makeComment({ is_internal: true });
    const hidden = await upload();
    await attach(hidden.file, internalComment);
    await asUser(clientUser, client);
    const forbidden = await content(req(hidden.document), { params: Promise.resolve({ documentId: hidden.document }) });
    expect([403, 404]).toContain(forbidden.status);

    // ...while a live attachment still resolves for the technician.
    const live = await upload();
    await attach(live.file, await makeComment());
    await asUser(actor);
    const ok = await content(req(live.document), { params: Promise.resolve({ documentId: live.document }) });
    expect(ok.status).toBe(200);
  });

  // Non-attachment documents (incl. co-managed meeting artifacts) keep their original
  // policy: canReadCommentAttachment returns true when no attachment row exists, and
  // the meeting-admission hook is a no-op for tenants without co-managed scheduling.
  it('leaves ordinary non-attachment documents downloadable', async () => {
    const document = randomUUID(), file = randomUUID();
    await table('external_files').insert({tenant,file_id:file,file_name:'plain.pdf',original_name:'plain.pdf',mime_type:'application/pdf',file_size:12,storage_path:`/test/${file}`,uploaded_by_id:actor});
    await table('documents').insert({tenant,document_id:document,file_id:file,document_name:'plain.pdf',mime_type:'application/pdf',file_size:12,user_id:actor,created_by:actor,is_client_visible:true});
    await asUser(actor);

    expect(await canReadCommentAttachment(trx, tenant, actor, document)).toBe(true);
    const download = (await import('@/app/api/documents/download/[fileId]/route')).GET;
    const response = await download(
      new NextRequest(`http://localhost/api/documents/download/${file}`, { headers: { 'cache-control': 'no-store' } }),
      { params: Promise.resolve({ fileId: file }) },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('SECRET-BYTES');
  });
});
