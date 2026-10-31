import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareUpgradeSchema } from '../../../../../../scripts/lib/upgrade-schema-source.mjs';
import type { Knex } from 'knex';
import { tenantDb, runWithTenant } from '@alga-psa/db';
import { prepareNativeAccessOperation } from './coManagedFixtures';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../../../server/test-utils/dbConfig';
import { NextRequest } from 'next/server';
import { getCoManagedAcceptanceState, acceptCoManagedRelationship } from '../../../../../../packages/co-managed/src/acceptance';
import { registerCoManagedCapability } from '../../../../../../packages/co-managed/src/capability';

// Activities run synchronously against a disposable database migrated from this
// branch's migration set. Every worker connection resolves to it.
const delivery = vi.hoisted(() => ({ send: vi.fn() }));
const runtime = vi.hoisted(() => ({ session: null as any }));
vi.mock('../../../../../../packages/auth/src/nextauth/auth', () => ({ auth: async () => runtime.session }));
vi.mock('../../../../../../packages/auth/src/nextauth/edge-auth', () => ({ auth: async () => runtime.session }));
vi.mock('next/headers.js', () => ({ headers: async () => new Headers({ 'next-action': 'test' }), cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'next-action': 'test' }), cookies: async () => ({ get: () => undefined }) }));
vi.mock('../../../../../../server/src/lib/db/db', () => ({ getConnection: async () => db }));
vi.mock('../../../../../../server/src/lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: async () => null }));
vi.mock('@alga-psa/tags', async () => await import('../../../../../../packages/tags/src/actions'));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: async () => undefined, publishWorkflowEvent: async () => undefined }));
vi.mock('../../../../../../packages/documents/src/lib/documentPreviewGenerator', () => ({ generateDocumentPreviews: async () => ({}) }));
const appliance = vi.hoisted(() => ({ check: vi.fn(async () => ({ seats: 0 })) }));
vi.mock('@alga-psa/db/tenant', async importOriginal => {
  const actual = await importOriginal<typeof import('@alga-psa/db/tenant')>();
  return { ...actual, getConnection: async () => db,
    createTenantKnex: async (tenant?: string) => ({ knex: db, tenant: tenant ?? actual.getTenantContext() }) };
});
vi.mock('@alga-psa/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, getAdminConnection: async () => db,
    getConnection: async () => db,
    createTenantKnex: async (tenant?: string) => ({ knex: db, tenant: tenant ?? actual.getTenantContext() }) };
});
// Re-export the real server modules without loading the barrel's React UI.
// No authentication, permission or lifecycle function is replaced.
vi.mock('@alga-psa/auth', async () => ({
  ...(await import('../../../../../../packages/auth/src/lib/withAuth')),
  ...(await import('../../../../../../packages/auth/src/lib/rbac')),
  ...(await import('../../../../../../packages/auth/src/lib/getSession')),
  ...(await import('../../../../../../packages/auth/src/lib/getCurrentUser')),
  ...(await import('../../../../../../packages/auth/src/lib/apiKeyUserContext')),
  ...(await import('../../../../../../packages/auth/src/lib/assertInteractiveUser')),
  ...(await import('../../../../../../packages/auth/src/lib/security/rateLimiting')),
  ...(await import('../../../../../../packages/auth/src/lib/localizeActionError')),
  ...(await import('../../../../../../packages/auth/src/lib/authenticator/authenticator')),
  ...(await import('../../../../../../packages/auth/src/lib/apiAuth')),
  ...(await import('../../../../../../packages/auth/src/services/apiKeyService')),
}));
vi.mock('@enterprise/lib/license/userSeatGuard', () => ({ checkApplianceLicenseSeatLimit: appliance.check }));
vi.mock('@temporalio/activity', async importOriginal => ({
  ...(await importOriginal<typeof import('@temporalio/activity')>()),
  Context: { current: () => ({ log: { info() {}, warn() {}, error() {} } }) },
}));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: delivery.send,
  TenantEmailService: { getInstance: () => ({ isConfigured: async () => true }) }, getSystemEmailService: async () => ({ isConfigured: async () => true }) }));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: async () => db,
  withAdminTransactionRetryReadOnly: (work: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(work),
}));

let db: Knex;
let migrationWork: string;
const databaseName = `co_managed_access_${randomUUID().replaceAll('-', '')}`.slice(0, 60);

// Transport I/O is substituted; action authentication, session revocation,
// RBAC, acceptance/cache, API-key authentication and controllers are real.
const bytes = Buffer.from('customer attachment');
vi.mock('@alga-psa/storage/StorageService', () => ({ StorageService: class {
  static validateFileUpload = async () => undefined;
  static uploadFile = async (tenant: string, buffer: Buffer, name: string, options: any) => {
    const row = { tenant, file_id: randomUUID(), file_name: name, original_name: name, mime_type: options.mime_type,
      file_size: buffer.length, storage_path: 'test-only', uploaded_by_id: options.uploaded_by_id };
    await tenantDb(db, tenant).table('external_files').insert(row);
    return row;
  };
  static downloadFile = async () => ({ buffer: bytes, metadata: { mime_type: 'text/plain', original_name: 'attachment.txt', file_size: bytes.length } });
} }));


export function registerNativeAccessTests(provision: (
  input: { sponsorTenant: string; operationId: string }, databaseName: string,
) => Promise<{ token: string; close: () => Promise<void> }>) {
  let closeProvisioner: void | (() => Promise<void>);
  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.NEXTAUTH_SECRET = 'co-managed-integration-test-secret';
    const root = path.resolve(__dirname, '../../../../../..');
    migrationWork = mkdtempSync(path.join(tmpdir(), 'co-managed-schema-'));
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const schema = prepareUpgradeSchema({ repository: root, commit, destination: path.join(migrationWork, 'schema'), edition: 'ee' });
    symlinkSync(path.join(root, 'node_modules'), path.join(migrationWork, 'schema', 'node_modules'));
    db = await createTestDbConnection({ databaseName, migrationsDir: schema.directory });
  }, 600000);

  afterAll(async () => {
    if (closeProvisioner) await closeProvisioner();
    await db?.destroy();
    const { default: knex } = await import('knex');
    const admin = knex({ client: 'pg', connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
      user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN, database: 'postgres' } });
    try {
      await admin.raw('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()', [databaseName]);
      await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]);
    } finally { await admin.destroy(); if (migrationWork) rmSync(migrationWork, { recursive: true, force: true }); }
  });

  const prepare = (overrides: { seats?: number; email?: string; capacity?: number } = {}) => prepareNativeAccessOperation(db, overrides);

  let operation: Awaited<ReturnType<typeof prepare>>;
  let actor: { tenant: string; userId: string };
  let ticketId: string;
  let foreignTicketId: string;
  let apiKey: string;
  const request = (pathname: string, tenant = actor.tenant) => new NextRequest(`http://localhost${pathname}`, {
    headers: { 'x-api-key': apiKey, 'x-tenant-id': tenant },
  });

  beforeAll(async () => {
    registerCoManagedCapability();
    operation = await prepare();
    const delivered = await provision({ sponsorTenant: operation.tenant, operationId: operation.operation_id }, databaseName);
    closeProvisioner = delivered.close;
    const customer = tenantDb(db, operation.customer_tenant);
    const invitation = await customer.table('user_invitations').first();
    const { completeUserInvitationSetup } = await import('../../../../../../packages/users/src/actions/user-actions/userInvitationActions');
    const signup = await completeUserInvitationSetup(delivered.token, 'ValidPassword!2026');
    expect(signup).toMatchObject({ success: true });
    actor = { tenant: operation.customer_tenant, userId: signup.userId! };
    expect(await customer.table('user_preferences').where({ user_id: actor.userId, setting_name: 'has_reset_password' }).first()).toMatchObject({ setting_value: true });
    const sessionId = randomUUID();
    await customer.table('sessions').insert({ tenant: actor.tenant, session_id: sessionId, user_id: actor.userId, expires_at: new Date(Date.now() + 3600000) });
    runtime.session = { user: { id: actor.userId, tenant: actor.tenant, user_type: 'internal', email: invitation.email },
      session_id: sessionId, expires: new Date(Date.now() + 3600000).toISOString() };
    apiKey = randomUUID();
    await customer.table('api_keys').insert({ tenant: actor.tenant, user_id: actor.userId, active: true, api_key: createHash('sha256').update(apiKey).digest('hex') });
    const board = await customer.table('boards').first();
    const status = await customer.table('statuses').where('item_type', 'ticket').first();
    const clientId = randomUUID();
    await customer.table('clients').insert({ tenant: actor.tenant, client_id: clientId, client_name: 'Native customer' });
    ticketId = randomUUID(); foreignTicketId = randomUUID();
    await customer.table('tickets').insert({ tenant: actor.tenant, ticket_id: ticketId, title: 'Customer native ticket', ticket_number: 'ACCESS-1', client_id: clientId,
      board_id: board.board_id, status_id: status.status_id, entered_by: actor.userId });
    await tenantDb(db, operation.tenant).table('tickets').insert({ tenant: operation.tenant, ticket_id: foreignTicketId,
      title: 'Foreign ticket', ticket_number: 'FOREIGN-1', client_id: (await tenantDb(db, operation.tenant).table('clients').first()).client_id, board_id: operation.escalation_board_id });
  });

  describe.sequential('fresh customer native access through real authentication', () => {
    it('refuses ticket actions and controller reads until acceptance, then reads only customer tickets', async () => {
      const { getTicketById } = await import('../../../../../../packages/tickets/src/actions/ticketActions');
      const { acceptCustomerCoManagedRelationship, getCoManagedPasswordStatus } = await import('../../../../../../server/src/lib/actions/coManagedAcceptanceActions');
      // Simulate a request handler loaded independently of the acceptance bundle.
      vi.resetModules();
      const requestLifecycle = await import('../../../../../../packages/licensing/src/lib/co-managed-lifecycle');
      requestLifecycle.registerCoManagedLifecycleProvider(requestLifecycle.coManagedLifecycleProvider);
      const { ApiTicketController } = await import('../../../../../../server/src/lib/api/controllers/ApiTicketController');
      const controller = new ApiTicketController();
      const { ApiKeyService } = await import('@alga-psa/auth');
      const { POST: validateKey } = await import('../../../../../../server/src/app/api/auth/validate-api-key/route');
      const { GET: downloadFile } = await import('../../../../../../server/src/app/api/documents/[documentId]/download/route');
      await expect(runWithTenant(actor.tenant, () => ApiKeyService.validateApiKey(apiKey))).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
      expect((await runWithTenant(actor.tenant, () => validateKey(request('/api/auth/validate-api-key')))).status).toBe(409);
      const pendingDownload = await downloadFile(request(`/api/documents/${ticketId}/download`), { params: Promise.resolve({ documentId: ticketId }) });
      expect(pendingDownload.status).toBe(409);
      expect(await pendingDownload.json()).toMatchObject({ error: { code: 'CO_MANAGED_NOT_ACTIVE' } });
      const keysBefore = await tenantDb(db, actor.tenant).table('api_keys');
      await expect(getTicketById(ticketId)).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
      for (const req of [request(`/api/v1/tickets/${ticketId}`), new NextRequest(`http://localhost/api/v1/tickets/${ticketId}`, { headers: { 'x-api-key': apiKey } })]) {
        const response = await controller.getById()(req);
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ error: { code: 'CO_MANAGED_NOT_ACTIVE' } });
      }
      expect(await tenantDb(db, actor.tenant).table('api_keys')).toEqual(keysBefore);
      const proposal = await getCoManagedAcceptanceState(db, actor);
      if (proposal.state !== 'pending_acceptance') throw new Error('Missing acceptance proposal');
      await acceptCustomerCoManagedRelationship({ relationshipId: proposal.relationshipId, revision: proposal.revision, scopeFingerprint: proposal.scopeFingerprint });
      expect(await getCoManagedPasswordStatus()).toEqual({ hasResetPassword: true });
      expect(await runWithTenant(actor.tenant, () => ApiKeyService.validateApiKey(apiKey))).toMatchObject({ user_id: actor.userId });
      expect(await getTicketById(ticketId)).toMatchObject({ ticket_id: ticketId, title: 'Customer native ticket' });
      const response = await controller.getById()(request(`/api/v1/tickets/${ticketId}`));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { ticket_id: ticketId } });
      expect(await getTicketById(foreignTicketId)).toMatchObject({ actionError: expect.stringContaining('Ticket not found') });
      expect((await controller.getById()(request(`/api/v1/tickets/${foreignTicketId}`))).status).toBe(404);
      expect((await controller.getById()(request(`/api/v1/tickets/${ticketId}`, operation.tenant))).status).toBe(401);
      const { ApiInvoiceController } = await import('../../../../../../server/src/lib/api/controllers/ApiInvoiceController');
      const { ApiQuoteController } = await import('../../../../../../server/src/lib/api/controllers/ApiQuoteController');
      const { ApiAccountingExportController } = await import('../../../../../../server/src/lib/api/controllers/ApiAccountingExportController');
      for (const [route, handler] of [
        ['/api/v1/invoices', new ApiInvoiceController().list()],
        ['/api/v1/quotes', new ApiQuoteController().list()],
        ['/api/v1/accounting/exports', new ApiAccountingExportController().list()],
      ] as const) {
        const denied = await handler(request(route));
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ error: { code: 'PRODUCT_ACCESS_DENIED' } });
      }
      const { getClientTaxRate } = await import('../../../../../../packages/billing/src/actions/billingAndTax');
      expect(await getClientTaxRate(randomUUID())).toMatchObject({ permissionError: expect.any(String) });
    });

    it('reads KB action/API content without general document grants, and refuses it after grant removal', async () => {
      const customer = tenantDb(db, actor.tenant);
      const documentId = randomUUID(), articleId = randomUUID();
      await customer.table('documents').insert({ tenant: actor.tenant, document_id: documentId, document_name: 'Scoped article', user_id: actor.userId, created_by: actor.userId, content: 'Customer article body' });
      await customer.table('kb_articles').insert({ tenant: actor.tenant, article_id: articleId, document_id: documentId, slug: 'scoped-article' });
      await customer.table('document_block_content').insert({ tenant: actor.tenant, document_id: documentId, block_data: JSON.stringify([{ id: 'paragraph', type: 'paragraph', content: [{ type: 'text', text: 'Customer article body', styles: {} }] }]) });
      const { getArticle } = await import('../../../../../../packages/documents/src/actions/kbArticleActions');
      expect(await getArticle(articleId)).toMatchObject({ article_id: articleId, content: 'Customer article body' });
      const { ApiKbArticleController } = await import('../../../../../../server/src/lib/api/controllers/ApiKbArticleController');
      const controller = new ApiKbArticleController();
      const response = await controller.getById()(request(`/api/v1/kb-articles/${articleId}`));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { article_id: articleId } });
      const content = await controller.getContent()(request(`/api/v1/kb-articles/${articleId}/content`));
      expect(content.status).toBe(200);
      expect(await content.json()).toMatchObject({ data: { content: expect.stringContaining('Customer article body') } });
      const permission = await customer.table('permissions').where({ resource: 'knowledge_base', action: 'read', msp: true, client: false }).first();
      const grants = await customer.table('role_permissions').where('permission_id', permission.permission_id);
      await customer.table('role_permissions').where('permission_id', permission.permission_id).delete();
      expect(await getArticle(articleId)).toMatchObject({ permissionError: expect.any(String) });
      expect((await controller.getById()(request(`/api/v1/kb-articles/${articleId}`))).status).toBe(403);
      await customer.table('role_permissions').insert(grants);
      const { getDocument } = await import('../../../../../../packages/documents/src/actions/documentActions');
      expect(await getDocument(documentId)).toMatchObject({ permissionError: expect.any(String) });
    });

    it('uploads, lists and downloads scoped attachments and refuses unrelated or foreign targets before storage', async () => {
      const { uploadDocument, getDocumentByTicketId, getDocumentDownloadUrl, downloadDocument, getDocument, getAuthorizedDocumentById, getAuthorizedDocumentByFileId } = await import('../../../../../../packages/documents/src/actions/documentActions');
      const form = () => { const value = new FormData(); value.set('file', new File([bytes], 'attachment.txt', { type: 'text/plain' })); return value; };
      const uploaded = await uploadDocument(form(), { userId: actor.userId, ticketId });
      expect(uploaded).toMatchObject({ success: true });
      if (!('document' in uploaded)) throw new Error('No uploaded document');
      const id = uploaded.document.document_id;
      const user = await tenantDb(db, actor.tenant).table('users').where('user_id', actor.userId).first();
      expect(await db.transaction(trx => getAuthorizedDocumentByFileId(trx, actor.tenant, user, uploaded.document.file_id!))).toMatchObject({ document_id: id });
      expect(await getDocumentByTicketId(ticketId)).toEqual(expect.arrayContaining([expect.objectContaining({ document_id: id })]));
      expect(await getDocumentDownloadUrl(id)).toBe(`/api/documents/download/${id}`);
      const response = await downloadDocument(id);
      expect(response).toBeInstanceOf(Response);
      expect(await (response as Response).text()).toBe(bytes.toString());
      const filesBefore = await tenantDb(db, actor.tenant).table('external_files');
      for (const target of [{}, { ticketId: foreignTicketId }, { ticketId, contractId: randomUUID() }]) {
        expect(await uploadDocument(form(), { userId: actor.userId, ...target })).toMatchObject({ permissionError: expect.any(String) });
      }
      expect(await tenantDb(db, actor.tenant).table('external_files')).toEqual(filesBefore);
      expect(await getDocumentByTicketId(foreignTicketId)).toMatchObject({ permissionError: expect.any(String) });
      const unrelated = randomUUID();
      await tenantDb(db, actor.tenant).table('documents').insert({ tenant: actor.tenant, document_id: unrelated, document_name: 'General document', user_id: actor.userId, created_by: actor.userId });
      expect(await db.transaction(trx => getAuthorizedDocumentById(trx, actor.tenant, user, unrelated))).toBeNull();
      expect(await getDocument(unrelated)).toMatchObject({ permissionError: expect.any(String) });
      expect(await getDocumentDownloadUrl(unrelated)).toMatchObject({ permissionError: expect.any(String) });
      expect(await getDocumentDownloadUrl(randomUUID())).toMatchObject({ permissionError: expect.any(String) });
      const customer = tenantDb(db, actor.tenant);
      const permissions = await customer.table('permissions').where({ resource: 'ticket_attachment' });
      const grants = await customer.table('role_permissions').whereIn('permission_id', permissions.map(row => row.permission_id));
      await customer.table('role_permissions').whereIn('permission_id', permissions.map(row => row.permission_id)).delete();
      expect(await getDocumentDownloadUrl(id)).toMatchObject({ permissionError: expect.any(String) });
      expect(await db.transaction(trx => getAuthorizedDocumentById(trx, actor.tenant, user, id))).toBeNull();
      expect(await uploadDocument(form(), { userId: actor.userId, ticketId })).toMatchObject({ permissionError: expect.any(String) });
      await customer.table('role_permissions').insert(grants);
    });
    it('keeps portal article reads published-only and ticket attachments within the contact client', async () => {
      const customer = tenantDb(db, actor.tenant);
      const savedSession = runtime.session;
      const portalId = randomUUID(), contactId = randomUUID(), sessionId = randomUUID();
      const ticket = await customer.table('tickets').where('ticket_id', ticketId).first();
      await customer.table('contacts').insert({ tenant: actor.tenant, contact_name_id: contactId, client_id: ticket.client_id, full_name: 'Portal Reader', email: `${portalId}@example.test`, is_inactive: false });
      await customer.table('users').insert({ tenant: actor.tenant, user_id: portalId, username: portalId, email: `${portalId}@example.test`, first_name: 'Portal', last_name: 'Reader', hashed_password: 'not-a-login', user_type: 'client', contact_id: contactId, is_inactive: false });
      const role = await customer.table('roles').where({ role_name: 'User', msp: false, client: true }).first();
      await customer.table('user_roles').insert({ tenant: actor.tenant, user_id: portalId, role_id: role.role_id });
      await customer.table('sessions').insert({ tenant: actor.tenant, session_id: sessionId, user_id: portalId, expires_at: new Date(Date.now() + 3600000) });
      runtime.session = { user: { id: portalId, tenant: actor.tenant, user_type: 'client', email: `${portalId}@example.test` }, session_id: sessionId, expires: new Date(Date.now() + 3600000).toISOString() };
      const documentId = randomUUID(), articleId = randomUUID();
      await customer.table('documents').insert({ tenant: actor.tenant, document_id: documentId, document_name: 'Public guide', user_id: actor.userId, created_by: actor.userId });
      await customer.table('kb_articles').insert({ tenant: actor.tenant, article_id: articleId, document_id: documentId, slug: 'public-guide', status: 'published', audience: 'client' });
      try {
        const { getClientKBArticles } = await import('../../../../../../packages/client-portal/src/actions/client-portal-actions/client-kb');
        const { getArticles } = await import('../../../../../../packages/documents/src/actions/kbArticleActions');
        const visible = await getClientKBArticles();
        expect(visible).toMatchObject({ total: 1, articles: [expect.objectContaining({ article_id: articleId })] });
        expect(await getArticles()).toMatchObject({ permissionError: expect.any(String) });
        const { canReadTicketDocuments, canUploadDocument } = await import('../../../../../../packages/documents/src/lib/documentPermissions');
        const user = await customer.table('users').where('user_id', portalId).first();
        expect(await canReadTicketDocuments(user, ticketId)).toBe(true);
        expect(await canUploadDocument(user, { ticketId })).toBe(true);
        expect(await canReadTicketDocuments(user, foreignTicketId)).toBe(false);
      } finally { runtime.session = savedSession; }
    });

    it('preserves the native PSA byte-reader result and steady-state statement count', async () => {
      const sponsor = tenantDb(db, operation.tenant);
      const user = await sponsor.table('users').where('user_id', operation.requested_by).first();
      const documentId = randomUUID();
      await sponsor.table('documents').insert({ tenant: operation.tenant, document_id: documentId, document_name: 'Native PSA document', user_id: user.user_id, created_by: user.user_id });
      const { getAuthorizedDocumentById, authorizeAndRedactDocuments } = await import('../../../../../../packages/documents/src/actions/documentActions');
      const { coManagedWorkspaceDenial } = await import('../../../../../../server/src/lib/api/coManagedWorkspaceDenial');
      await coManagedWorkspaceDenial(operation.tenant); // Warm the negative lifecycle cache.
      const measured = async (work: () => Promise<unknown>) => {
        let statements = 0;
        const record = () => { statements++; };
        db.on('query', record);
        try { return { value: await work(), statements }; }
        finally { db.removeListener('query', record); }
      };
      // The original native reader: one tenant-scoped document load followed by
      // the existing relationship/redaction policy, in the caller's transaction.
      const baseline = await measured(() => db.transaction(async trx => {
        const document = await tenantDb(trx, operation.tenant).table('documents').where('document_id', documentId).first();
        return (await authorizeAndRedactDocuments(trx, operation.tenant, user, [document]))[0];
      }));
      const current = await measured(async () => {
        expect(await coManagedWorkspaceDenial(operation.tenant)).toBeNull();
        return db.transaction(trx => getAuthorizedDocumentById(trx, operation.tenant, user, documentId));
      });
      expect(current.value).toEqual(baseline.value);
      expect(current.statements).toBe(baseline.statements);
    });

  });
}
