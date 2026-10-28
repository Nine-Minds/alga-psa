/**
 * GET /api/documents/[documentId]/content authorizes the document instance
 * (not just the document:read type permission) before reading any content.
 *
 * - client-portal user of client A cannot read a client-visible document of client B (404)
 * - client-portal user cannot read a document that is not client-visible (404)
 * - positive controls: the owning client and an internal technician still read it (200)
 * - a client-visible document the client created itself (no associations) stays readable
 * - fields the kernel's decision redacts are absent from the response
 */
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { NextRequest } from 'next/server';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createClient, createUser } from '../../../test-utils/testDataFactory';
import { setupCommonMocks, createMockUser, setMockUser } from '../../../test-utils/testMocks';

const SECRET = 'SECRET-CONTENT';

// RBAC is supplied by the route fixture; this suite exercises document record and field rules.
vi.mock('@alga-psa/authorization/rbac', () => ({ hasPermission: async () => true }));

const refs = vi.hoisted(() => ({ db: null as any, tenantId: '', user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: refs.db, tenant: refs.tenantId })),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn(async () => refs.user),
}));

let db: Knex;
let tenantId: string;
let mspUserId: string;
let getContent: typeof import('../../app/api/documents/[documentId]/content/route').GET;

type Created = { clientIds: string[]; contactIds: string[]; userIds: string[]; documentIds: string[] };
let created: Created = { clientIds: [], contactIds: [], userIds: [], documentIds: [] };

const table = (name: string) => tenantDb(db, tenantId).table(name);

async function createContactAndClientUser(clientId: string) {
  const contactId = uuidv4();
  await table('contacts').insert({
    contact_name_id: contactId, tenant: tenantId, client_id: clientId,
    full_name: `Contact ${contactId.slice(0, 8)}`, email: `c-${contactId.slice(0, 8)}@test.com`,
    created_at: new Date(), updated_at: new Date(),
  });
  const userId = uuidv4();
  await table('users').insert({
    user_id: userId, tenant: tenantId, username: `client-${userId.slice(0, 8)}`,
    email: `client-${userId.slice(0, 8)}@test.com`, hashed_password: 'test_hash', user_type: 'client',
    contact_id: contactId, first_name: 'Client', last_name: 'User', is_inactive: false, created_at: new Date(),
  });
  created.contactIds.push(contactId);
  created.userIds.push(userId);
  return { contactId, userId };
}

async function createDocWithContent(name: string, isClientVisible: boolean, clientId?: string, createdBy: string = mspUserId) {
  const documentId = uuidv4();
  await table('documents').insert({
    tenant: tenantId, document_id: documentId, document_name: name, content: '',
    created_by: createdBy, user_id: createdBy, entered_at: new Date(), updated_at: new Date(),
    is_client_visible: isClientVisible,
  });
  await table('document_content').insert({
    tenant: tenantId, id: uuidv4(), document_id: documentId, content: SECRET, created_by_id: mspUserId, updated_by_id: mspUserId,
  });
  if (clientId) {
    await table('document_associations').insert({
      tenant: tenantId, association_id: uuidv4(), document_id: documentId,
      entity_id: clientId, entity_type: 'client', created_at: new Date(),
    });
  }
  created.documentIds.push(documentId);
  return documentId;
}

function actAs(user: any) {
  refs.user = user;
  setMockUser(user, ['document:read']);
  setupCommonMocks({ tenantId, userId: user.user_id, user, permissionCheck: () => true });
}

const callContent = (documentId: string) =>
  getContent(new NextRequest(`http://localhost/api/documents/${documentId}/content`), {
    params: Promise.resolve({ documentId }),
  });

describe('document content route authorization', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'Document Content Authorization Tenant');
    mspUserId = await createUser(db, tenantId, { username: 'content-msp-user' });
    refs.db = db;
    refs.tenantId = tenantId;
    getContent = (await import('../../app/api/documents/[documentId]/content/route')).GET;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const safeDelete = async (name: string, where: Record<string, unknown>) => {
      try { await table(name).where(where).del(); } catch { /* teardown only */ }
    };
    for (const id of created.documentIds) {
      await safeDelete('document_content', { document_id: id });
      await safeDelete('document_associations', { document_id: id });
      await safeDelete('documents', { document_id: id });
    }
    for (const id of created.userIds) await safeDelete('users', { user_id: id });
    for (const id of created.contactIds) await safeDelete('contacts', { contact_name_id: id });
    for (const id of created.clientIds) await safeDelete('clients', { client_id: id });
    created = { clientIds: [], contactIds: [], userIds: [], documentIds: [] };
  });

  async function twoClients() {
    const clientA = await createClient(db, tenantId, 'Content Client A');
    const clientB = await createClient(db, tenantId, 'Content Client B');
    created.clientIds.push(clientA, clientB);
    const a = await createContactAndClientUser(clientA);
    const clientUserA = createMockUser('client', { user_id: a.userId, tenant: tenantId, contact_id: a.contactId, clientId: clientA });
    return { clientA, clientB, clientUserA };
  }

  it("refuses a client-visible document that belongs to another client (404, no content)", async () => {
    const { clientB, clientUserA } = await twoClients();
    const documentId = await createDocWithContent('Client B doc', true, clientB);

    actAs(clientUserA);
    const response = await callContent(documentId);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(SECRET);
  });

  it('refuses a document that is not client-visible (404, no content)', async () => {
    const { clientA, clientUserA } = await twoClients();
    const documentId = await createDocWithContent('Hidden doc', false, clientA);

    actAs(clientUserA);
    const response = await callContent(documentId);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(SECRET);
  });

  it('positive control: the owning client and an internal technician still read the content (200)', async () => {
    const { clientA, clientUserA } = await twoClients();
    const documentId = await createDocWithContent('Client A doc', true, clientA);

    actAs(clientUserA);
    const clientResponse = await callContent(documentId);
    expect(clientResponse.status).toBe(200);
    expect(await clientResponse.text()).toContain(SECRET);

    actAs(createMockUser('internal', { user_id: mspUserId, tenant: tenantId }));
    const internalResponse = await callContent(documentId);
    expect(internalResponse.status).toBe(200);
    expect(await internalResponse.text()).toContain(SECRET);
  });

  it('does not over-block: a client-visible document the client created itself stays readable', async () => {
    const { clientUserA } = await twoClients();
    const documentId = await createDocWithContent('Own visible doc', true, undefined, clientUserA.user_id);

    actAs(clientUserA);
    const response = await callContent(documentId);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(SECRET);
  });

  it("serves only what the kernel's decision leaves: redacted fields are not in the response", async () => {
    const { clientA, clientUserA } = await twoClients();
    const documentId = await createDocWithContent('Redacted Name Doc', true, clientA);
    await table('documents').where({ document_id: documentId }).update({ mime_type: 'text/x-redaction-marker' });

    const bundles = await import('@alga-psa/authorization/bundles/service');
    const rulesSpy = vi.spyOn(bundles, 'resolveBundleNarrowingRulesForEvaluation').mockResolvedValue([
      { id: 'redact', resource: 'document', action: 'read', constraintKey: 'hide_sensitive_fields',
        redactedFields: ['content', 'document_name', 'mime_type'] },
    ] as any);

    actAs(clientUserA);
    const response = await callContent(documentId);
    expect(rulesSpy).toHaveBeenCalled();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('Redacted Name Doc');
    expect(text).not.toContain('text/x-redaction-marker');
    const body = JSON.parse(text);
    expect(body.data.document).not.toHaveProperty('document_name');
    expect(body.data.document).not.toHaveProperty('mime_type');
    expect(body.data.document.document_id).toBe(documentId);
    expect(body.data.content).toMatchObject({ has_content: false, text_content: null, block_content: null, extracted_text: null });

    // Control: a decision that redacts only the name still serves the content.
    rulesSpy.mockResolvedValue([
      { id: 'redact', resource: 'document', action: 'read', constraintKey: 'hide_sensitive_fields', redactedFields: ['document_name'] },
    ] as any);
    const nameOnly = await callContent(documentId);
    expect(nameOnly.status).toBe(200);
    const nameOnlyText = await nameOnly.text();
    expect(nameOnlyText).toContain(SECRET);
    expect(nameOnlyText).not.toContain('Redacted Name Doc');
  });
});
