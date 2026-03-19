/**
 * Integration tests for Phase 3: Client Portal Documents Hub
 *
 * Tests:
 * - T015: getClientDocuments() returns only documents with is_client_visible=true
 * - T016: getClientDocuments() aggregates documents across multiple sources
 * - T017: Client A cannot see client B's documents (security)
 * - T018: downloadClientDocument() returns 403 for non-visible and other client's docs
 * - T019: File view API route respects is_client_visible for client users
 */
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createClient, createUser } from '../../../test-utils/testDataFactory';
import { setupCommonMocks, createMockUser, setMockUser } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let mspUserId: string;

// Action imports
let getClientDocuments: typeof import('@alga-psa/client-portal/actions').getClientDocuments;
let getClientDocumentFolders: typeof import('@alga-psa/client-portal/actions').getClientDocumentFolders;
let downloadClientDocument: typeof import('@alga-psa/client-portal/actions').downloadClientDocument;

// Mock the database module to return test database
vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
    getConnection: vi.fn(async () => db),
    withTransaction: vi.fn(async <T>(connection: Knex, fn: (trx: Knex.Transaction) => Promise<T>) => {
      return db.transaction(fn);
    })
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

// Track created resources
type CreatedIds = {
  clientIds: string[];
  userIds: string[];
  contactIds: string[];
  documentIds: string[];
  ticketIds: string[];
};

let createdIds: CreatedIds = {
  clientIds: [],
  userIds: [],
  contactIds: [],
  documentIds: [],
  ticketIds: []
};

async function cleanupCreatedRecords(db: Knex, tenantId: string, ids: CreatedIds): Promise<void> {
  const safeDelete = async (table: string, where: Record<string, unknown>) => {
    try {
      await db(table).where(where).del();
    } catch {
      // Ignore cleanup issues
    }
  };

  // Delete in reverse dependency order
  for (const docId of ids.documentIds) {
    await safeDelete('document_associations', { tenant: tenantId, document_id: docId });
    await safeDelete('documents', { tenant: tenantId, document_id: docId });
  }

  for (const ticketId of ids.ticketIds) {
    await safeDelete('tickets', { tenant: tenantId, ticket_id: ticketId });
  }

  for (const contactId of ids.contactIds) {
    await safeDelete('contacts', { tenant: tenantId, contact_name_id: contactId });
  }

  for (const clientId of ids.clientIds) {
    await safeDelete('clients', { tenant: tenantId, client_id: clientId });
  }

  for (const userId of ids.userIds) {
    await safeDelete('users', { tenant: tenantId, user_id: userId });
  }
}

async function createContact(
  db: Knex,
  tenantId: string,
  clientId: string,
  email: string
): Promise<string> {
  const contactId = uuidv4();
  const now = new Date();

  await db('contacts').insert({
    contact_name_id: contactId,
    tenant: tenantId,
    client_id: clientId,
    full_name: `Test Contact ${contactId.slice(0, 8)}`,
    email: email,
    created_at: now,
    updated_at: now
  });

  return contactId;
}

async function createClientUser(
  db: Knex,
  tenantId: string,
  contactId: string
): Promise<string> {
  const userId = uuidv4();
  const now = new Date();

  await db('users').insert({
    user_id: userId,
    tenant: tenantId,
    username: `client-user-${userId.slice(0, 8)}`,
    email: `client-${userId.slice(0, 8)}@test.com`,
    hashed_password: 'test_hash',
    user_type: 'client',
    contact_id: contactId,
    first_name: 'Client',
    last_name: 'User',
    is_inactive: false,
    created_at: now
  });

  return userId;
}

async function createDocument(
  db: Knex,
  tenantId: string,
  userId: string,
  name: string,
  isClientVisible: boolean,
  folderPath: string | null = null
): Promise<string> {
  const docId = uuidv4();
  const now = new Date();

  await db('documents').insert({
    tenant: tenantId,
    document_id: docId,
    document_name: name,
    content: '',
    folder_path: folderPath,
    created_by: userId,
    created_at: now,
    updated_at: now,
    is_client_visible: isClientVisible
  });

  return docId;
}

async function createDocumentAssociation(
  db: Knex,
  tenantId: string,
  documentId: string,
  entityId: string,
  entityType: string
): Promise<void> {
  const now = new Date();

  await db('document_associations').insert({
    tenant: tenantId,
    association_id: uuidv4(),
    document_id: documentId,
    entity_id: entityId,
    entity_type: entityType,
    created_at: now
  });
}

describe('Client Portal Documents Integration Tests', () => {
  beforeAll(async () => {
    // Set environment
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();

    tenantId = await createTenant(db, 'Client Portal Documents Test Tenant');
    mspUserId = await createUser(db, tenantId, { username: 'msp-admin-user' });

    // Import actions after mocks
    const clientPortalActions = await import('@alga-psa/client-portal/actions');
    getClientDocuments = clientPortalActions.getClientDocuments;
    getClientDocumentFolders = clientPortalActions.getClientDocumentFolders;
    downloadClientDocument = clientPortalActions.downloadClientDocument;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    if (db && tenantId) {
      await cleanupCreatedRecords(db, tenantId, createdIds);
    }
    createdIds = {
      clientIds: [],
      userIds: [],
      contactIds: [],
      documentIds: [],
      ticketIds: []
    };
    vi.clearAllMocks();
  });

  describe('T015: getClientDocuments visibility filtering', () => {
    it('should return only documents with is_client_visible=true', async () => {
      // Setup: Client with contact and user
      const clientId = await createClient(db, tenantId, 'Visibility Test Client');
      createdIds.clientIds.push(clientId);

      const contactId = await createContact(db, tenantId, clientId, 'visibility@test.com');
      createdIds.contactIds.push(contactId);

      const clientUserId = await createClientUser(db, tenantId, contactId);
      createdIds.userIds.push(clientUserId);

      // Create documents: one visible, one not
      const visibleDocId = await createDocument(db, tenantId, mspUserId, 'Visible Doc', true);
      const hiddenDocId = await createDocument(db, tenantId, mspUserId, 'Hidden Doc', false);
      createdIds.documentIds.push(visibleDocId, hiddenDocId);

      // Associate both with client
      await createDocumentAssociation(db, tenantId, visibleDocId, clientId, 'client');
      await createDocumentAssociation(db, tenantId, hiddenDocId, clientId, 'client');

      // Setup client user context
      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, ['document:read']);
      setupCommonMocks({
        tenantId,
        userId: clientUserId,
        user: clientUser,
        permissionCheck: () => true
      });

      // Call getClientDocuments
      const result = await getClientDocuments(1, 20, {});

      expect(result).toBeDefined();
      expect(result.documents).toBeDefined();

      const docNames = result.documents.map((d: { document_name: string }) => d.document_name);
      expect(docNames).toContain('Visible Doc');
      expect(docNames).not.toContain('Hidden Doc');
    });

    it('should exclude non-visible documents even when associated with client', async () => {
      const clientId = await createClient(db, tenantId, 'Exclude Test Client');
      createdIds.clientIds.push(clientId);

      const contactId = await createContact(db, tenantId, clientId, 'exclude@test.com');
      createdIds.contactIds.push(contactId);

      const clientUserId = await createClientUser(db, tenantId, contactId);
      createdIds.userIds.push(clientUserId);

      // Create only non-visible document
      const hiddenDocId = await createDocument(db, tenantId, mspUserId, 'Internal Only', false);
      createdIds.documentIds.push(hiddenDocId);

      await createDocumentAssociation(db, tenantId, hiddenDocId, clientId, 'client');

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, ['document:read']);
      setupCommonMocks({
        tenantId,
        userId: clientUserId,
        user: clientUser,
        permissionCheck: () => true
      });

      const result = await getClientDocuments(1, 20, {});

      expect(result.documents).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('T016: getClientDocuments aggregates multiple sources', () => {
    it('should aggregate documents from direct client association and tickets', async () => {
      const clientId = await createClient(db, tenantId, 'Aggregation Test Client');
      createdIds.clientIds.push(clientId);

      const contactId = await createContact(db, tenantId, clientId, 'aggregate@test.com');
      createdIds.contactIds.push(contactId);

      const clientUserId = await createClientUser(db, tenantId, contactId);
      createdIds.userIds.push(clientUserId);

      // Create direct client document
      const directDocId = await createDocument(db, tenantId, mspUserId, 'Direct Client Doc', true);
      createdIds.documentIds.push(directDocId);
      await createDocumentAssociation(db, tenantId, directDocId, clientId, 'client');

      // Create ticket and ticket document
      const ticketId = uuidv4();
      await db('tickets').insert({
        tenant: tenantId,
        ticket_id: ticketId,
        ticket_number: `TKT-${Date.now()}`,
        title: 'Test Ticket',
        client_id: clientId,
        entered_by: mspUserId,
        entered_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
        attributes: {}
      });
      createdIds.ticketIds.push(ticketId);

      const ticketDocId = await createDocument(db, tenantId, mspUserId, 'Ticket Doc', true);
      createdIds.documentIds.push(ticketDocId);
      await createDocumentAssociation(db, tenantId, ticketDocId, ticketId, 'ticket');

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, ['document:read']);
      setupCommonMocks({
        tenantId,
        userId: clientUserId,
        user: clientUser,
        permissionCheck: () => true
      });

      const result = await getClientDocuments(1, 20, {});

      expect(result.documents.length).toBeGreaterThanOrEqual(2);

      const docNames = result.documents.map((d: { document_name: string }) => d.document_name);
      expect(docNames).toContain('Direct Client Doc');
      expect(docNames).toContain('Ticket Doc');
    });
  });

  describe('T017: Client isolation security', () => {
    it('should not return documents belonging to another client', async () => {
      // Create two clients
      const clientAId = await createClient(db, tenantId, 'Client A');
      const clientBId = await createClient(db, tenantId, 'Client B');
      createdIds.clientIds.push(clientAId, clientBId);

      // Create contacts and users for both
      const contactAId = await createContact(db, tenantId, clientAId, 'clienta@test.com');
      const contactBId = await createContact(db, tenantId, clientBId, 'clientb@test.com');
      createdIds.contactIds.push(contactAId, contactBId);

      const userAId = await createClientUser(db, tenantId, contactAId);
      const userBId = await createClientUser(db, tenantId, contactBId);
      createdIds.userIds.push(userAId, userBId);

      // Create documents for each client
      const docAId = await createDocument(db, tenantId, mspUserId, 'Client A Secret Doc', true);
      const docBId = await createDocument(db, tenantId, mspUserId, 'Client B Secret Doc', true);
      createdIds.documentIds.push(docAId, docBId);

      await createDocumentAssociation(db, tenantId, docAId, clientAId, 'client');
      await createDocumentAssociation(db, tenantId, docBId, clientBId, 'client');

      // Login as Client A
      const clientAUser = createMockUser('client', {
        user_id: userAId,
        tenant: tenantId,
        contact_id: contactAId
      });
      setMockUser(clientAUser, ['document:read']);
      setupCommonMocks({
        tenantId,
        userId: userAId,
        user: clientAUser,
        permissionCheck: () => true
      });

      const resultA = await getClientDocuments(1, 20, {});

      const docNamesA = resultA.documents.map((d: { document_name: string }) => d.document_name);
      expect(docNamesA).toContain('Client A Secret Doc');
      expect(docNamesA).not.toContain('Client B Secret Doc');

      // Login as Client B
      const clientBUser = createMockUser('client', {
        user_id: userBId,
        tenant: tenantId,
        contact_id: contactBId
      });
      setMockUser(clientBUser, ['document:read']);
      setupCommonMocks({
        tenantId,
        userId: userBId,
        user: clientBUser,
        permissionCheck: () => true
      });

      const resultB = await getClientDocuments(1, 20, {});

      const docNamesB = resultB.documents.map((d: { document_name: string }) => d.document_name);
      expect(docNamesB).toContain('Client B Secret Doc');
      expect(docNamesB).not.toContain('Client A Secret Doc');
    });
  });

  describe('T018: downloadClientDocument access control', () => {
    it('should reject download for non-visible document', async () => {
      const clientId = await createClient(db, tenantId, 'Download Test Client');
      createdIds.clientIds.push(clientId);

      const contactId = await createContact(db, tenantId, clientId, 'download@test.com');
      createdIds.contactIds.push(contactId);

      const clientUserId = await createClientUser(db, tenantId, contactId);
      createdIds.userIds.push(clientUserId);

      // Create non-visible document
      const hiddenDocId = await createDocument(db, tenantId, mspUserId, 'Hidden Download Doc', false);
      createdIds.documentIds.push(hiddenDocId);
      await createDocumentAssociation(db, tenantId, hiddenDocId, clientId, 'client');

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, ['document:read']);
      setupCommonMocks({
        tenantId,
        userId: clientUserId,
        user: clientUser,
        permissionCheck: () => true
      });

      await expect(downloadClientDocument(hiddenDocId)).rejects.toThrow(/not found|access denied/i);
    });

    it('should reject download for document belonging to different client', async () => {
      const clientAId = await createClient(db, tenantId, 'Owner Client');
      const clientBId = await createClient(db, tenantId, 'Other Client');
      createdIds.clientIds.push(clientAId, clientBId);

      const contactBId = await createContact(db, tenantId, clientBId, 'other@test.com');
      createdIds.contactIds.push(contactBId);

      const userBId = await createClientUser(db, tenantId, contactBId);
      createdIds.userIds.push(userBId);

      // Create document owned by Client A
      const docId = await createDocument(db, tenantId, mspUserId, 'Client A Doc', true);
      createdIds.documentIds.push(docId);
      await createDocumentAssociation(db, tenantId, docId, clientAId, 'client');

      // Try to download as Client B
      const clientBUser = createMockUser('client', {
        user_id: userBId,
        tenant: tenantId,
        contact_id: contactBId
      });
      setMockUser(clientBUser, ['document:read']);
      setupCommonMocks({
        tenantId,
        userId: userBId,
        user: clientBUser,
        permissionCheck: () => true
      });

      await expect(downloadClientDocument(docId)).rejects.toThrow(/not found|access denied/i);
    });

    it('should allow download for visible document owned by client', async () => {
      const clientId = await createClient(db, tenantId, 'Download Owner Client');
      createdIds.clientIds.push(clientId);

      const contactId = await createContact(db, tenantId, clientId, 'owner@test.com');
      createdIds.contactIds.push(contactId);

      const clientUserId = await createClientUser(db, tenantId, contactId);
      createdIds.userIds.push(clientUserId);

      // Create visible document
      const visibleDocId = await createDocument(db, tenantId, mspUserId, 'Downloadable Doc', true);
      createdIds.documentIds.push(visibleDocId);
      await createDocumentAssociation(db, tenantId, visibleDocId, clientId, 'client');

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, ['document:read']);
      setupCommonMocks({
        tenantId,
        userId: clientUserId,
        user: clientUser,
        permissionCheck: () => true
      });

      const doc = await downloadClientDocument(visibleDocId);

      expect(doc).toBeDefined();
      expect(doc.document_id).toBe(visibleDocId);
      expect(doc.document_name).toBe('Downloadable Doc');
    });
  });

  describe('T019: File view API route visibility checks', () => {
    // Note: Testing the actual API route would require supertest or similar
    // These tests verify the underlying logic that the route uses

    it('should verify document visibility before serving to client user', async () => {
      const clientId = await createClient(db, tenantId, 'API Route Client');
      createdIds.clientIds.push(clientId);

      const contactId = await createContact(db, tenantId, clientId, 'api@test.com');
      createdIds.contactIds.push(contactId);

      const clientUserId = await createClientUser(db, tenantId, contactId);
      createdIds.userIds.push(clientUserId);

      // Create non-visible document
      const hiddenDocId = await createDocument(db, tenantId, mspUserId, 'API Hidden Doc', false);
      createdIds.documentIds.push(hiddenDocId);
      await createDocumentAssociation(db, tenantId, hiddenDocId, clientId, 'client');

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, ['document:read']);
      setupCommonMocks({
        tenantId,
        userId: clientUserId,
        user: clientUser,
        permissionCheck: () => true
      });

      // The downloadClientDocument action is what the API route uses
      await expect(downloadClientDocument(hiddenDocId)).rejects.toThrow();
    });

    it('should allow visible contract-associated document access for client user', async () => {
      // Note: Contract (billing_plan) association test would require billing_plans setup
      // This is a placeholder for the contract access test logic
      // The actual implementation uses billing_plans.company_id = client_id

      const clientId = await createClient(db, tenantId, 'Contract Client');
      createdIds.clientIds.push(clientId);

      const contactId = await createContact(db, tenantId, clientId, 'contract@test.com');
      createdIds.contactIds.push(contactId);

      const clientUserId = await createClientUser(db, tenantId, contactId);
      createdIds.userIds.push(clientUserId);

      // For now, test with direct client association as proxy
      const contractDocId = await createDocument(db, tenantId, mspUserId, 'Contract Doc', true);
      createdIds.documentIds.push(contractDocId);
      await createDocumentAssociation(db, tenantId, contractDocId, clientId, 'client');

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, ['document:read']);
      setupCommonMocks({
        tenantId,
        userId: clientUserId,
        user: clientUser,
        permissionCheck: () => true
      });

      const doc = await downloadClientDocument(contractDocId);
      expect(doc).toBeDefined();
    });
  });
});
