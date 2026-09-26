/**
 * Integration tests for Phase 3: Client Portal Documents Hub
 *
 * Tests:
 * - T015: getClientDocuments() returns only documents with is_client_visible=true
 * - T016: getClientDocuments() aggregates documents across multiple sources
 * - T017: Client A cannot see client B's documents (security)
 * - T018: downloadClientDocument() returns 403 for non-visible and other client's docs
 * - T019: File view API route respects is_client_visible for client users
 * - T045: Contract-linked documents resolve for the owning client
 * - T046: Contract-linked documents do not leak through stale shared assignments
 */
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createClient, createUser } from '../../../test-utils/testDataFactory';
import { setupCommonMocks, createMockUser, setMockUser } from '../../../test-utils/testMocks';
import { NextRequest } from 'next/server';

const portalRouteMocks = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock('@alga-psa/storage/StorageService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/storage/StorageService')>();
  return { ...actual, StorageService: { ...actual.StorageService, downloadFile: portalRouteMocks.downloadFile } };
});

let db: Knex;
let tenantId: string;
let mspUserId: string;

// Action imports
let getClientDocuments: typeof import('@alga-psa/client-portal/actions').getClientDocuments;
let getClientDocumentFolders: typeof import('@alga-psa/client-portal/actions').getClientDocumentFolders;
let downloadClientDocument: typeof import('@alga-psa/client-portal/actions').downloadClientDocument;
let getClientDocumentContent: typeof import('@alga-psa/client-portal/actions/client-portal-actions/client-documents').getClientDocumentContent;
let getClientPortalFile: typeof import('../../app/api/client-portal/documents/[documentId]/file/route').GET;
let getClientPortalExport: typeof import('../../app/api/client-portal/documents/[documentId]/export/route').GET;

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
  folderIds: string[];
  ticketIds: string[];
  contractIds: string[];
  clientContractIds: string[];
  storageProviderIds: string[];
  storageBucketIds: string[];
  fileIds: string[];
  commentIds: string[];
  commentThreadIds: string[];
  commentAttachmentIds: string[];
  foreignDocuments: Array<{ tenantId: string; documentId: string; userId: string }>;
};

let createdIds: CreatedIds = {
  clientIds: [],
  userIds: [],
  contactIds: [],
  documentIds: [],
  folderIds: [],
  ticketIds: [],
  contractIds: [],
  clientContractIds: [],
  storageProviderIds: [], storageBucketIds: [], fileIds: [], commentIds: [], commentThreadIds: [], commentAttachmentIds: [], foreignDocuments: [],
};

function tenantTable(db: Knex, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

async function cleanupCreatedRecords(db: Knex, tenantId: string, ids: CreatedIds): Promise<void> {
  const safeDelete = async (table: string, where: Record<string, unknown>) => {
    try {
      await tenantTable(db, tenantId, table).where(where).del();
    } catch {
      // Ignore cleanup issues
    }
  };

  // Delete in reverse dependency order
  for (const docId of ids.documentIds) {
    await safeDelete('ticket_comment_attachments', { tenant: tenantId, document_id: docId });
    await safeDelete('document_block_content', { tenant: tenantId, document_id: docId });
    await safeDelete('document_content', { tenant: tenantId, document_id: docId });
    await safeDelete('document_associations', { tenant: tenantId, document_id: docId });
    await safeDelete('documents', { tenant: tenantId, document_id: docId });
  }
  for (const record of ids.foreignDocuments) {
    try {
      await tenantDb(db, record.tenantId).table('document_associations').where({ document_id: record.documentId }).del();
      await tenantDb(db, record.tenantId).table('documents').where({ document_id: record.documentId }).del();
      await tenantDb(db, record.tenantId).table('users').where({ user_id: record.userId }).del();
    } catch {
      // Ignore cleanup issues in test teardown.
    }
  }

  for (const commentId of ids.commentIds) await safeDelete('comments', { tenant: tenantId, comment_id: commentId });
  for (const threadId of ids.commentThreadIds) await safeDelete('comment_threads', { tenant: tenantId, thread_id: threadId });

  await safeDelete('document_folders', { tenant: tenantId });

  for (const fileId of ids.fileIds) await safeDelete('external_files', { tenant: tenantId, file_id: fileId });
  for (const bucketId of ids.storageBucketIds) await safeDelete('storage_configurations', { tenant: tenantId, configuration_id: bucketId });
  for (const providerId of ids.storageProviderIds) await safeDelete('storage_providers', { tenant: tenantId, provider_id: providerId });

  for (const ticketId of ids.ticketIds) {
    await safeDelete('tickets', { tenant: tenantId, ticket_id: ticketId });
  }

  for (const clientContractId of ids.clientContractIds) {
    await safeDelete('client_contracts', { tenant: tenantId, client_contract_id: clientContractId });
  }

  for (const contractId of ids.contractIds) {
    await safeDelete('contracts', { tenant: tenantId, contract_id: contractId });
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

  await tenantTable(db, tenantId, 'contacts').insert({
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

  await tenantTable(db, tenantId, 'users').insert({
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

  await tenantTable(db, tenantId, 'documents').insert({
    tenant: tenantId,
    document_id: docId,
    document_name: name,
    content: '',
    folder_path: folderPath,
    created_by: userId,
    user_id: userId,
    entered_at: now,
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

  await tenantTable(db, tenantId, 'document_associations').insert({
    tenant: tenantId,
    association_id: uuidv4(),
    document_id: documentId,
    entity_id: entityId,
    entity_type: entityType,
    created_at: now
  });
}

async function createEntityFolder(
  db: Knex,
  tenantId: string,
  entityId: string,
  entityType: 'client' | 'contract',
  folderPath: string,
  isClientVisible: boolean
): Promise<string> {
  const folderId = uuidv4();

  await tenantTable(db, tenantId, 'document_folders').insert({
    tenant: tenantId,
    folder_id: folderId,
    folder_path: folderPath,
    folder_name: folderPath.split('/').filter(Boolean).at(-1) ?? folderPath,
    entity_id: entityId,
    entity_type: entityType,
    is_client_visible: isClientVisible,
    parent_folder_id: null,
    created_by: mspUserId
  });

  return folderId;
}

async function createOwnedContract(
  db: Knex,
  tenantId: string,
  clientId: string,
  contractName: string
): Promise<{ contractId: string; clientContractId: string }> {
  const contractId = uuidv4();
  const clientContractId = uuidv4();
  const now = new Date();

  await tenantTable(db, tenantId, 'contracts').insert({
    tenant: tenantId,
    contract_id: contractId,
    contract_name: contractName,
    contract_description: `${contractName} description`,
    owner_client_id: clientId,
    billing_frequency: 'monthly',
    currency_code: 'USD',
    status: 'active',
    is_active: true,
    is_template: false,
    created_at: now,
    updated_at: now
  });

  await tenantTable(db, tenantId, 'client_contracts').insert({
    tenant: tenantId,
    client_contract_id: clientContractId,
    client_id: clientId,
    contract_id: contractId,
    start_date: new Date('2026-01-01'),
    end_date: null,
    is_active: true,
    created_at: now,
    updated_at: now
  });

  return { contractId, clientContractId };
}

function collectFolderPaths(nodes: Array<{ path: string; children: any[] }>): string[] {
  const paths: string[] = [];

  for (const node of nodes) {
    paths.push(node.path);
    paths.push(...collectFolderPaths(node.children || []));
  }

  return paths;
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
    getClientDocumentContent = (await import('@alga-psa/client-portal/actions/client-portal-actions/client-documents')).getClientDocumentContent;
    getClientPortalFile = (await import('../../app/api/client-portal/documents/[documentId]/file/route')).GET;
    getClientPortalExport = (await import('../../app/api/client-portal/documents/[documentId]/export/route')).GET;
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
      folderIds: [],
      ticketIds: [],
      contractIds: [],
      clientContractIds: [],
      storageProviderIds: [], storageBucketIds: [], fileIds: [], commentIds: [], commentThreadIds: [], commentAttachmentIds: [], foreignDocuments: [],
    };
    vi.clearAllMocks();
    portalRouteMocks.downloadFile.mockReset();
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
      await tenantTable(db, tenantId, 'tickets').insert({
        tenant: tenantId,
        ticket_id: ticketId,
        ticket_number: `TKT-${Date.now()}`,
        title: 'Test Ticket',
        client_id: clientId,
        entered_by: mspUserId,
        entered_at: new Date(),
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

  describe('Contract-linked document ownership invariants', () => {
    it('T045: returns contract-linked documents, folders, and downloads for the owning client', async () => {
      const clientId = await createClient(db, tenantId, 'Owning Contract Client');
      createdIds.clientIds.push(clientId);

      const contactId = await createContact(db, tenantId, clientId, 'owned-contract@test.com');
      createdIds.contactIds.push(contactId);

      const clientUserId = await createClientUser(db, tenantId, contactId);
      createdIds.userIds.push(clientUserId);

      const { contractId, clientContractId } = await createOwnedContract(
        db,
        tenantId,
        clientId,
        'Owned Contract'
      );
      createdIds.contractIds.push(contractId);
      createdIds.clientContractIds.push(clientContractId);

      const documentId = await createDocument(
        db,
        tenantId,
        mspUserId,
        'Owned Contract Doc',
        true,
        '/contracts/owned-client'
      );
      createdIds.documentIds.push(documentId);
      await createDocumentAssociation(db, tenantId, documentId, contractId, 'contract');

      const explicitFolderId = await createEntityFolder(
        db,
        tenantId,
        contractId,
        'contract',
        '/contracts/explicit-owner-folder',
        true
      );
      createdIds.folderIds.push(explicitFolderId);

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

      const listed = await getClientDocuments(1, 20, { sourceType: 'contract' });
      const folders = await getClientDocumentFolders();
      const downloaded = await downloadClientDocument(documentId);

      expect(listed.documents.map((doc) => doc.document_id)).toContain(documentId);
      expect(collectFolderPaths(folders)).toContain('/contracts/owned-client');
      expect(collectFolderPaths(folders)).toContain('/contracts/explicit-owner-folder');
      expect(downloaded.document_id).toBe(documentId);
    });

    it('T046: blocks stale shared-assignment leaks for contract-linked documents', async () => {
      const ownerClientId = await createClient(db, tenantId, 'Owner Client');
      const staleClientId = await createClient(db, tenantId, 'Stale Shared Client');
      createdIds.clientIds.push(ownerClientId, staleClientId);

      const ownerContactId = await createContact(db, tenantId, ownerClientId, 'owner-contract@test.com');
      const staleContactId = await createContact(db, tenantId, staleClientId, 'stale-contract@test.com');
      createdIds.contactIds.push(ownerContactId, staleContactId);

      const ownerUserId = await createClientUser(db, tenantId, ownerContactId);
      const staleUserId = await createClientUser(db, tenantId, staleContactId);
      createdIds.userIds.push(ownerUserId, staleUserId);

      const { contractId, clientContractId } = await createOwnedContract(
        db,
        tenantId,
        ownerClientId,
        'Owner Protected Contract'
      );
      createdIds.contractIds.push(contractId);
      createdIds.clientContractIds.push(clientContractId);

      const staleClientContractId = uuidv4();
      createdIds.clientContractIds.push(staleClientContractId);
      await tenantTable(db, tenantId, 'client_contracts').insert({
        tenant: tenantId,
        client_contract_id: staleClientContractId,
        client_id: staleClientId,
        contract_id: contractId,
        start_date: new Date('2026-02-01'),
        end_date: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      });

      const leakedDocumentId = await createDocument(
        db,
        tenantId,
        mspUserId,
        'Should Not Leak',
        true,
        '/contracts/owner-only'
      );
      createdIds.documentIds.push(leakedDocumentId);
      await createDocumentAssociation(db, tenantId, leakedDocumentId, contractId, 'contract');

      const staleClientUser = createMockUser('client', {
        user_id: staleUserId,
        tenant: tenantId,
        contact_id: staleContactId
      });
      setMockUser(staleClientUser, ['document:read']);
      setupCommonMocks({
        tenantId,
        userId: staleUserId,
        user: staleClientUser,
        permissionCheck: () => true
      });

      const listed = await getClientDocuments(1, 20, { sourceType: 'contract' });
      const folders = await getClientDocumentFolders();

      expect(listed.documents.map((doc) => doc.document_id)).not.toContain(leakedDocumentId);
      expect(collectFolderPaths(folders)).not.toContain('/contracts/owner-only');
      await expect(downloadClientDocument(leakedDocumentId)).rejects.toThrow(/not found|access denied/i);
    });
  });

  describe('Client portal content, file, and export routes use live visibility queries', () => {
    it('denies another client, another tenant, hidden documents, and private comment attachments', async () => {
      const clientAId = await createClient(db, tenantId, 'Route Client A');
      const clientBId = await createClient(db, tenantId, 'Route Client B');
      createdIds.clientIds.push(clientAId, clientBId);
      const contactAId = await createContact(db, tenantId, clientAId, 'route-a@test.com');
      createdIds.contactIds.push(contactAId);
      const clientAUserId = await createClientUser(db, tenantId, contactAId);
      createdIds.userIds.push(clientAUserId);

      const anotherClientDocument = await createDocument(db, tenantId, mspUserId, 'Other Client Route Doc', true);
      const hiddenDocument = await createDocument(db, tenantId, mspUserId, 'Hidden Route Doc', false);
      const privateDocument = await createDocument(db, tenantId, mspUserId, 'Private Comment Attachment', true);
      createdIds.documentIds.push(anotherClientDocument, hiddenDocument, privateDocument);
      await createDocumentAssociation(db, tenantId, anotherClientDocument, clientBId, 'client');
      await createDocumentAssociation(db, tenantId, hiddenDocument, clientAId, 'client');
      await createDocumentAssociation(db, tenantId, privateDocument, clientAId, 'client');

      const ticketId = uuidv4();
      const threadId = uuidv4();
      const commentId = uuidv4();
      const attachmentId = uuidv4();
      createdIds.ticketIds.push(ticketId);
      createdIds.commentThreadIds.push(threadId);
      createdIds.commentIds.push(commentId);
      createdIds.commentAttachmentIds.push(attachmentId);
      await tenantTable(db, tenantId, 'tickets').insert({
        tenant: tenantId, ticket_id: ticketId, ticket_number: `DOC-${Date.now()}`, title: 'Private attachment ticket',
        client_id: clientAId, entered_by: mspUserId, entered_at: new Date(), updated_at: new Date(), attributes: {},
      });
      await tenantTable(db, tenantId, 'comment_threads').insert({
        tenant: tenantId, thread_id: threadId, ticket_id: ticketId, root_comment_id: commentId, is_internal: true,
      });
      await tenantTable(db, tenantId, 'comments').insert({
        tenant: tenantId, comment_id: commentId, ticket_id: ticketId, thread_id: threadId, user_id: mspUserId,
        note: 'private', is_internal: true, is_resolution: false,
        author_type: 'internal', publish_state: 'published',
      });
      await tenantTable(db, tenantId, 'ticket_comment_attachments').insert({
        tenant: tenantId, attachment_id: attachmentId, ticket_id: ticketId, document_id: privateDocument,
        created_by: mspUserId, comment_id: commentId, state: 'attached', expires_at: new Date(Date.now() + 60_000),
      });

      const foreignTenantId = await createTenant(db, 'Foreign Document Route Tenant');
      const foreignUserId = await createUser(db, foreignTenantId, { username: `foreign-${uuidv4().slice(0, 8)}` });
      const foreignDocumentId = await createDocument(db, foreignTenantId, foreignUserId, 'Foreign Tenant Route Doc', true);
      createdIds.foreignDocuments.push({ tenantId: foreignTenantId, documentId: foreignDocumentId, userId: foreignUserId });

      const clientUser = createMockUser('client', { user_id: clientAUserId, tenant: tenantId, contact_id: contactAId });
      setMockUser(clientUser, ['document:read']);
      setupCommonMocks({ tenantId, userId: clientAUserId, user: clientUser, permissionCheck: () => true });
      const callFile = (documentId: string) => getClientPortalFile(
        new NextRequest(`http://localhost/api/client-portal/documents/${documentId}/file`),
        { params: Promise.resolve({ documentId }) }
      );
      const callExport = (documentId: string) => getClientPortalExport(
        new NextRequest(`http://localhost/api/client-portal/documents/${documentId}/export?format=md`),
        { params: Promise.resolve({ documentId }) }
      );

      for (const documentId of [anotherClientDocument, hiddenDocument, privateDocument, foreignDocumentId]) {
        expect((await callFile(documentId)).status).toBe(404);
        expect((await callExport(documentId)).status).toBe(404);
      }
      expect(portalRouteMocks.downloadFile).not.toHaveBeenCalled();
    });

    it('serves a renamed upload, exports owner_client_id-only block content, and does not file PDF exports', async () => {
      const clientId = await createClient(db, tenantId, 'Route Owner Client');
      createdIds.clientIds.push(clientId);
      const contactId = await createContact(db, tenantId, clientId, 'route-owner@test.com');
      createdIds.contactIds.push(contactId);
      const clientUserId = await createClientUser(db, tenantId, contactId);
      createdIds.userIds.push(clientUserId);
      const { contractId, clientContractId } = await createOwnedContract(db, tenantId, clientId, 'Route Owned Contract');
      createdIds.contractIds.push(contractId);
      createdIds.clientContractIds.push(clientContractId);

      const fileDocumentId = await createDocument(db, tenantId, mspUserId, 'Portal renamed report', true);
      const blockDocumentId = await createDocument(db, tenantId, mspUserId, 'Meeting Notes', true);
      createdIds.documentIds.push(fileDocumentId, blockDocumentId);
      await createDocumentAssociation(db, tenantId, fileDocumentId, clientId, 'client');
      await createDocumentAssociation(db, tenantId, blockDocumentId, contractId, 'contract');
      const blockData = [{ type: 'paragraph', content: [{ type: 'text', text: 'Owner contract meeting notes' }] }];
      await tenantTable(db, tenantId, 'document_block_content').insert({ tenant: tenantId, document_id: blockDocumentId, block_data: JSON.stringify(blockData) });

      const providerId = uuidv4();
      const configurationId = uuidv4();
      const fileId = uuidv4();
      createdIds.storageProviderIds.push(providerId);
      createdIds.storageBucketIds.push(configurationId);
      createdIds.fileIds.push(fileId);
      await tenantTable(db, tenantId, 'storage_providers').insert({
        tenant: tenantId, provider_id: providerId, provider_type: 'local', provider_name: 'Portal route test', config: {},
      });
      await tenantTable(db, tenantId, 'storage_configurations').insert({
        tenant: tenantId, configuration_id: configurationId, provider_id: providerId, name: 'Portal test', path: '/', is_default: true,
      });
      await tenantTable(db, tenantId, 'external_files').insert({
        tenant: tenantId, file_id: fileId, file_name: 'stored-id', original_name: 'quarterly-report.xlsx',
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', file_size: 4,
        storage_path: 'test/quarterly-report.xlsx', uploaded_by_id: mspUserId,
      });
      await tenantTable(db, tenantId, 'documents').where({ document_id: fileDocumentId }).update({
        file_id: fileId, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      portalRouteMocks.downloadFile.mockResolvedValue({ buffer: Buffer.from('xlsx'), metadata: { original_name: 'quarterly-report.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 4 } });
      const clientUser = createMockUser('client', { user_id: clientUserId, tenant: tenantId, contact_id: contactId });
      setMockUser(clientUser, ['document:read']);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const contentResult = await getClientDocumentContent(blockDocumentId);
      expect(contentResult.content).toMatchObject({ kind: 'block', blockData });
      const fileResponse = await getClientPortalFile(
        new NextRequest(`http://localhost/api/client-portal/documents/${fileDocumentId}/file`),
        { params: Promise.resolve({ documentId: fileDocumentId }) }
      );
      expect(fileResponse.headers.get('Content-Disposition')).toContain('filename="quarterly-report.xlsx"');
      expect(Buffer.from(await fileResponse.arrayBuffer()).toString()).toBe('xlsx');

      const markdownResponse = await getClientPortalExport(
        new NextRequest(`http://localhost/api/client-portal/documents/${blockDocumentId}/export?format=md`),
        { params: Promise.resolve({ documentId: blockDocumentId }) }
      );
      expect(markdownResponse.status).toBe(200);
      expect(await markdownResponse.text()).toContain('Owner contract meeting notes');

      const { PDFGenerationService } = await import('@alga-psa/billing/services');
      const renderBuffer = vi.spyOn(PDFGenerationService.prototype as any, 'generatePDFBuffer').mockResolvedValue(Buffer.from('%PDF-integration'));
      const documentsBefore = await tenantTable(db, tenantId, 'documents').count('* as count').first();
      const externalFilesBefore = await tenantTable(db, tenantId, 'external_files').count('* as count').first();
      const pdfResponse = await getClientPortalExport(
        new NextRequest(`http://localhost/api/client-portal/documents/${blockDocumentId}/export?format=pdf`),
        { params: Promise.resolve({ documentId: blockDocumentId }) }
      );
      expect(pdfResponse.status).toBe(200);
      expect(Buffer.from(await pdfResponse.arrayBuffer()).toString()).toBe('%PDF-integration');
      expect(Number((await tenantTable(db, tenantId, 'documents').count('* as count').first())?.count)).toBe(Number(documentsBefore?.count));
      expect(Number((await tenantTable(db, tenantId, 'external_files').count('* as count').first())?.count)).toBe(Number(externalFilesBefore?.count));
      renderBuffer.mockRestore();
    });
  });
});
