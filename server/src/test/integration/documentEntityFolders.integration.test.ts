/**
 * Integration tests for Phase 1: Entity-Scoped Folders + Visibility
 *
 * Tests:
 * - T001: Entity-scoped folder CRUD — create folders for two different clients with same path
 * - T002: Unique constraint rejects duplicate folder_path for same entity_id + entity_type
 * - T003: getFolderTree(entityId, entityType) returns only that entity's folders
 * - T004: toggleDocumentVisibility() bulk-toggles is_client_visible
 * - T005: toggleFolderVisibility() with cascade propagates visibility to documents
 * - T006: Existing global folders continue working after migration
 */
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createClient, createUser } from '../../../test-utils/testDataFactory';
import { setupCommonMocks, createMockUser, setMockUser } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let userId: string;

// Action imports - will be populated after mocks
let createFolder: typeof import('@alga-psa/documents/actions').createFolder;
let getFolderTree: typeof import('@alga-psa/documents/actions').getFolderTree;
let toggleDocumentVisibility: typeof import('@alga-psa/documents/actions').toggleDocumentVisibility;
let toggleFolderVisibility: typeof import('@alga-psa/documents/actions').toggleFolderVisibility;
let deleteFolder: typeof import('@alga-psa/documents/actions').deleteFolder;

// Mock the database module to return test database
vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

// Track created resources for cleanup
type CreatedIds = {
  clientIds: string[];
  userIds: string[];
  documentIds: string[];
  folderIds: string[];
};

let createdIds: CreatedIds = {
  clientIds: [],
  userIds: [],
  documentIds: [],
  folderIds: []
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

  // Delete folders
  await safeDelete('document_folders', { tenant: tenantId });

  // Delete clients and users
  for (const clientId of ids.clientIds) {
    await safeDelete('contacts', { tenant: tenantId, client_id: clientId });
    await safeDelete('clients', { tenant: tenantId, client_id: clientId });
  }

  for (const userId of ids.userIds) {
    if (userId !== tenantId) {
      await safeDelete('users', { tenant: tenantId, user_id: userId });
    }
  }
}

describe('Document Entity-Scoped Folders Integration Tests', () => {
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

    // Create database connection
    db = await createTestDbConnection();

    // Create tenant and user
    tenantId = await createTenant(db, 'Document Entity Folders Test Tenant');
    userId = await createUser(db, tenantId, { username: 'test-user' });

    // Setup mocks
    const mockUser = createMockUser('internal', {
      user_id: userId,
      tenant: tenantId
    });
    setMockUser(mockUser, ['document:read', 'document:create', 'document:update', 'document:delete']);
    setupCommonMocks({
      tenantId,
      userId,
      user: mockUser,
      permissionCheck: () => true
    });

    // Import actions after mocks are set up
    const documentActions = await import('@alga-psa/documents/actions');
    createFolder = documentActions.createFolder;
    getFolderTree = documentActions.getFolderTree;
    toggleDocumentVisibility = documentActions.toggleDocumentVisibility;
    toggleFolderVisibility = documentActions.toggleFolderVisibility;
    deleteFolder = documentActions.deleteFolder;
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
      documentIds: [],
      folderIds: []
    };
    vi.clearAllMocks();
  });

  describe('T001: Entity-scoped folder CRUD', () => {
    it('should create folders for two different clients with the same path', async () => {
      // Create two clients
      const clientAId = await createClient(db, tenantId, 'Client A');
      const clientBId = await createClient(db, tenantId, 'Client B');
      createdIds.clientIds.push(clientAId, clientBId);

      // Create same folder path for both clients
      const folderPath = '/Contracts';

      // Create folder for Client A
      await createFolder(folderPath, clientAId, 'client', false);

      // Create folder for Client B with same path - should NOT throw
      await createFolder(folderPath, clientBId, 'client', false);

      // Verify both folders exist
      const folders = await db('document_folders')
        .where('tenant', tenantId)
        .where('folder_path', folderPath)
        .whereNotNull('entity_id');

      expect(folders).toHaveLength(2);

      const entityIds = folders.map((f: { entity_id: string }) => f.entity_id);
      expect(entityIds).toContain(clientAId);
      expect(entityIds).toContain(clientBId);
    });

    it('should isolate entity folders from each other', async () => {
      const clientAId = await createClient(db, tenantId, 'Isolated Client A');
      const clientBId = await createClient(db, tenantId, 'Isolated Client B');
      createdIds.clientIds.push(clientAId, clientBId);

      // Create different folder structures for each client
      await createFolder('/Legal', clientAId, 'client', false);
      await createFolder('/Legal/Contracts', clientAId, 'client', true);

      await createFolder('/Technical', clientBId, 'client', false);
      await createFolder('/Technical/Documentation', clientBId, 'client', false);

      // Verify each client only sees their own folders
      const clientAFolders = await db('document_folders')
        .where('tenant', tenantId)
        .where('entity_id', clientAId)
        .where('entity_type', 'client');

      const clientBFolders = await db('document_folders')
        .where('tenant', tenantId)
        .where('entity_id', clientBId)
        .where('entity_type', 'client');

      expect(clientAFolders).toHaveLength(2);
      expect(clientBFolders).toHaveLength(2);

      const clientAPaths = clientAFolders.map((f: { folder_path: string }) => f.folder_path);
      expect(clientAPaths).toContain('/Legal');
      expect(clientAPaths).toContain('/Legal/Contracts');
      expect(clientAPaths).not.toContain('/Technical');

      const clientBPaths = clientBFolders.map((f: { folder_path: string }) => f.folder_path);
      expect(clientBPaths).toContain('/Technical');
      expect(clientBPaths).toContain('/Technical/Documentation');
      expect(clientBPaths).not.toContain('/Legal');
    });
  });

  describe('T002: Unique constraint enforcement', () => {
    it('should reject duplicate folder_path for same entity_id and entity_type', async () => {
      const clientId = await createClient(db, tenantId, 'Unique Constraint Client');
      createdIds.clientIds.push(clientId);

      // Create first folder
      await createFolder('/Documents', clientId, 'client', false);

      // Try to create duplicate folder directly in DB (bypassing action check)
      const duplicateFolderId = uuidv4();

      await expect(
        db('document_folders').insert({
          tenant: tenantId,
          folder_id: duplicateFolderId,
          folder_path: '/Documents',
          folder_name: 'Documents',
          entity_id: clientId,
          entity_type: 'client',
          is_client_visible: false
        })
      ).rejects.toThrow(); // Should throw due to unique constraint
    });

    it('should allow same path for different entity types', async () => {
      const clientId = await createClient(db, tenantId, 'Client for Type Test');
      createdIds.clientIds.push(clientId);

      // Create folders for client entity type
      await createFolder('/SharedName', clientId, 'client', false);

      // Create folder for ticket entity type (same path, different entity type)
      // Using direct DB insert since we don't have a real ticket
      const ticketId = uuidv4();
      const folderId = uuidv4();

      await db('document_folders').insert({
        tenant: tenantId,
        folder_id: folderId,
        folder_path: '/SharedName',
        folder_name: 'SharedName',
        entity_id: ticketId,
        entity_type: 'ticket',
        is_client_visible: false
      });

      // Verify both exist
      const folders = await db('document_folders')
        .where('tenant', tenantId)
        .where('folder_path', '/SharedName')
        .whereNotNull('entity_id');

      expect(folders).toHaveLength(2);
    });
  });

  describe('T003: getFolderTree entity scope filtering', () => {
    it('should return only entity-specific folders when entityId/entityType provided', async () => {
      const clientAId = await createClient(db, tenantId, 'Tree Client A');
      const clientBId = await createClient(db, tenantId, 'Tree Client B');
      createdIds.clientIds.push(clientAId, clientBId);

      // Create folders for Client A
      await createFolder('/ClientA', clientAId, 'client', false);
      await createFolder('/ClientA/SubFolder', clientAId, 'client', false);

      // Create folders for Client B
      await createFolder('/ClientB', clientBId, 'client', false);

      // Create global folder
      await createFolder('/Global', null, null, false);

      // Get tree for Client A only
      const treeA = await getFolderTree(clientAId, 'client');

      expect(Array.isArray(treeA)).toBe(true);
      const folderNames = (treeA as Array<{ name: string }>).map(f => f.name);
      expect(folderNames).toContain('ClientA');
      expect(folderNames).not.toContain('ClientB');
      expect(folderNames).not.toContain('Global');
    });

    it('should return only global folders when no entity params provided', async () => {
      const clientId = await createClient(db, tenantId, 'Global Test Client');
      createdIds.clientIds.push(clientId);

      // Create entity-scoped folder
      await createFolder('/ClientSpecific', clientId, 'client', false);

      // Create global folders
      await createFolder('/GlobalOnly', null, null, false);
      await createFolder('/GlobalOnly/SubGlobal', null, null, false);

      // Get global tree (no entity params)
      const globalTree = await getFolderTree(null, null);

      expect(Array.isArray(globalTree)).toBe(true);
      const folderNames = (globalTree as Array<{ name: string }>).map(f => f.name);
      expect(folderNames).toContain('GlobalOnly');
      expect(folderNames).not.toContain('ClientSpecific');
    });
  });

  describe('T004: toggleDocumentVisibility bulk toggle', () => {
    it('should bulk toggle is_client_visible for multiple documents', async () => {
      // Create test documents
      const doc1Id = uuidv4();
      const doc2Id = uuidv4();
      const doc3Id = uuidv4();
      const now = new Date();

      await db('documents').insert([
        {
          tenant: tenantId,
          document_id: doc1Id,
          document_name: 'Doc 1',
          content: '',
          created_by: userId,
          created_at: now,
          updated_at: now,
          is_client_visible: false
        },
        {
          tenant: tenantId,
          document_id: doc2Id,
          document_name: 'Doc 2',
          content: '',
          created_by: userId,
          created_at: now,
          updated_at: now,
          is_client_visible: false
        },
        {
          tenant: tenantId,
          document_id: doc3Id,
          document_name: 'Doc 3',
          content: '',
          created_by: userId,
          created_at: now,
          updated_at: now,
          is_client_visible: true // Already visible
        }
      ]);
      createdIds.documentIds.push(doc1Id, doc2Id, doc3Id);

      // Toggle visibility to true for first two
      const updatedCount = await toggleDocumentVisibility([doc1Id, doc2Id], true);

      expect(updatedCount).toBe(2);

      // Verify visibility changed
      const docs = await db('documents')
        .whereIn('document_id', [doc1Id, doc2Id, doc3Id])
        .where('tenant', tenantId);

      const visibilities = docs.reduce((acc: Record<string, boolean>, d: { document_id: string; is_client_visible: boolean }) => {
        acc[d.document_id] = d.is_client_visible;
        return acc;
      }, {});

      expect(visibilities[doc1Id]).toBe(true);
      expect(visibilities[doc2Id]).toBe(true);
      expect(visibilities[doc3Id]).toBe(true); // Unchanged
    });

    it('should toggle visibility back to false', async () => {
      const docId = uuidv4();
      const now = new Date();

      await db('documents').insert({
        tenant: tenantId,
        document_id: docId,
        document_name: 'Toggle Test Doc',
        content: '',
        created_by: userId,
        created_at: now,
        updated_at: now,
        is_client_visible: true
      });
      createdIds.documentIds.push(docId);

      // Toggle to false
      const updatedCount = await toggleDocumentVisibility([docId], false);
      expect(updatedCount).toBe(1);

      // Verify
      const doc = await db('documents')
        .where('document_id', docId)
        .where('tenant', tenantId)
        .first();

      expect(doc.is_client_visible).toBe(false);
    });

    it('should return 0 when empty array provided', async () => {
      const updatedCount = await toggleDocumentVisibility([], true);
      expect(updatedCount).toBe(0);
    });
  });

  describe('T005: toggleFolderVisibility with cascade', () => {
    it('should cascade visibility to contained documents when cascade=true', async () => {
      const clientId = await createClient(db, tenantId, 'Cascade Test Client');
      createdIds.clientIds.push(clientId);

      // Create folder
      await createFolder('/CascadeTest', clientId, 'client', false);

      const folder = await db('document_folders')
        .where('tenant', tenantId)
        .where('folder_path', '/CascadeTest')
        .where('entity_id', clientId)
        .first();

      // Create documents in the folder
      const doc1Id = uuidv4();
      const doc2Id = uuidv4();
      const now = new Date();

      await db('documents').insert([
        {
          tenant: tenantId,
          document_id: doc1Id,
          document_name: 'Cascade Doc 1',
          content: '',
          folder_path: '/CascadeTest',
          created_by: userId,
          created_at: now,
          updated_at: now,
          is_client_visible: false
        },
        {
          tenant: tenantId,
          document_id: doc2Id,
          document_name: 'Cascade Doc 2',
          content: '',
          folder_path: '/CascadeTest',
          created_by: userId,
          created_at: now,
          updated_at: now,
          is_client_visible: false
        }
      ]);
      createdIds.documentIds.push(doc1Id, doc2Id);

      // Create associations for entity-scoped filtering
      await db('document_associations').insert([
        {
          tenant: tenantId,
          association_id: uuidv4(),
          document_id: doc1Id,
          entity_id: clientId,
          entity_type: 'client',
          created_at: now
        },
        {
          tenant: tenantId,
          association_id: uuidv4(),
          document_id: doc2Id,
          entity_id: clientId,
          entity_type: 'client',
          created_at: now
        }
      ]);

      // Toggle folder visibility with cascade
      const result = await toggleFolderVisibility(folder.folder_id, true, true);

      expect(result).toBeDefined();
      expect((result as { folderUpdated: boolean }).folderUpdated).toBe(true);
      expect((result as { updatedDocuments: number }).updatedDocuments).toBe(2);

      // Verify documents visibility changed
      const docs = await db('documents')
        .whereIn('document_id', [doc1Id, doc2Id])
        .where('tenant', tenantId);

      for (const doc of docs) {
        expect(doc.is_client_visible).toBe(true);
      }
    });

    it('should NOT cascade to documents when cascade=false', async () => {
      const clientId = await createClient(db, tenantId, 'No Cascade Client');
      createdIds.clientIds.push(clientId);

      await createFolder('/NoCascade', clientId, 'client', false);

      const folder = await db('document_folders')
        .where('tenant', tenantId)
        .where('folder_path', '/NoCascade')
        .where('entity_id', clientId)
        .first();

      const docId = uuidv4();
      const now = new Date();

      await db('documents').insert({
        tenant: tenantId,
        document_id: docId,
        document_name: 'No Cascade Doc',
        content: '',
        folder_path: '/NoCascade',
        created_by: userId,
        created_at: now,
        updated_at: now,
        is_client_visible: false
      });
      createdIds.documentIds.push(docId);

      await db('document_associations').insert({
        tenant: tenantId,
        association_id: uuidv4(),
        document_id: docId,
        entity_id: clientId,
        entity_type: 'client',
        created_at: now
      });

      // Toggle folder visibility WITHOUT cascade
      const result = await toggleFolderVisibility(folder.folder_id, true, false);

      expect((result as { folderUpdated: boolean }).folderUpdated).toBe(true);
      expect((result as { updatedDocuments: number }).updatedDocuments).toBe(0);

      // Document should remain unchanged
      const doc = await db('documents')
        .where('document_id', docId)
        .where('tenant', tenantId)
        .first();

      expect(doc.is_client_visible).toBe(false);
    });

    it('should cascade to subfolder documents', async () => {
      const clientId = await createClient(db, tenantId, 'Subfolder Cascade Client');
      createdIds.clientIds.push(clientId);

      // Create folder hierarchy
      await createFolder('/Parent', clientId, 'client', false);
      await createFolder('/Parent/Child', clientId, 'client', false);

      const parentFolder = await db('document_folders')
        .where('tenant', tenantId)
        .where('folder_path', '/Parent')
        .where('entity_id', clientId)
        .first();

      // Create document in child folder
      const docId = uuidv4();
      const now = new Date();

      await db('documents').insert({
        tenant: tenantId,
        document_id: docId,
        document_name: 'Child Doc',
        content: '',
        folder_path: '/Parent/Child',
        created_by: userId,
        created_at: now,
        updated_at: now,
        is_client_visible: false
      });
      createdIds.documentIds.push(docId);

      await db('document_associations').insert({
        tenant: tenantId,
        association_id: uuidv4(),
        document_id: docId,
        entity_id: clientId,
        entity_type: 'client',
        created_at: now
      });

      // Toggle parent folder with cascade - should affect child folder documents
      const result = await toggleFolderVisibility(parentFolder.folder_id, true, true);

      expect((result as { updatedDocuments: number }).updatedDocuments).toBeGreaterThanOrEqual(1);

      const doc = await db('documents')
        .where('document_id', docId)
        .where('tenant', tenantId)
        .first();

      expect(doc.is_client_visible).toBe(true);
    });
  });

  describe('T006: Global folders regression', () => {
    it('should continue supporting CRUD for global folders (entity_id IS NULL)', async () => {
      // Create global folder
      await createFolder('/GlobalTest', null, null, false);

      // Verify folder exists
      const folder = await db('document_folders')
        .where('tenant', tenantId)
        .where('folder_path', '/GlobalTest')
        .whereNull('entity_id')
        .whereNull('entity_type')
        .first();

      expect(folder).toBeDefined();
      expect(folder.folder_name).toBe('GlobalTest');
      expect(folder.entity_id).toBeNull();
      expect(folder.entity_type).toBeNull();
    });

    it('should list documents in global folders correctly', async () => {
      await createFolder('/GlobalDocs', null, null, false);

      const docId = uuidv4();
      const now = new Date();

      await db('documents').insert({
        tenant: tenantId,
        document_id: docId,
        document_name: 'Global Document',
        content: '',
        folder_path: '/GlobalDocs',
        created_by: userId,
        created_at: now,
        updated_at: now,
        is_client_visible: false
      });
      createdIds.documentIds.push(docId);

      // Get global folder tree
      const tree = await getFolderTree(null, null);

      expect(Array.isArray(tree)).toBe(true);
      const folderNames = (tree as Array<{ name: string }>).map(f => f.name);
      expect(folderNames).toContain('GlobalDocs');
    });

    it('should allow global and entity folders with same path to coexist', async () => {
      const clientId = await createClient(db, tenantId, 'Coexist Client');
      createdIds.clientIds.push(clientId);

      // Create global folder
      await createFolder('/Shared', null, null, false);

      // Create entity-scoped folder with same path
      await createFolder('/Shared', clientId, 'client', false);

      // Verify both exist
      const globalFolder = await db('document_folders')
        .where('tenant', tenantId)
        .where('folder_path', '/Shared')
        .whereNull('entity_id')
        .first();

      const entityFolder = await db('document_folders')
        .where('tenant', tenantId)
        .where('folder_path', '/Shared')
        .where('entity_id', clientId)
        .first();

      expect(globalFolder).toBeDefined();
      expect(entityFolder).toBeDefined();
      expect(globalFolder.folder_id).not.toBe(entityFolder.folder_id);
    });

    it('should render global tree without entity-scoped folders leaking in', async () => {
      const clientId = await createClient(db, tenantId, 'No Leak Client');
      createdIds.clientIds.push(clientId);

      // Create entity folder
      await createFolder('/EntityOnly', clientId, 'client', false);

      // Create global folder
      await createFolder('/GlobalOnly2', null, null, false);

      // Get global tree
      const globalTree = await getFolderTree(null, null);

      const folderNames = (globalTree as Array<{ name: string }>).map(f => f.name);
      expect(folderNames).toContain('GlobalOnly2');
      expect(folderNames).not.toContain('EntityOnly');
    });
  });
});
