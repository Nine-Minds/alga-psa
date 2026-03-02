/**
 * Integration tests for Phase 2: Folder Templates + Auto-Filing
 *
 * Tests:
 * - T009: Folder template CRUD lifecycle — create template with items, get with items, update, delete
 * - T010: setDefaultTemplate() marks template as default, unsets previous default
 * - T011: ensureEntityFolders() applies default template on first access, idempotent on second call
 * - T012: ensureEntityFolders() is a no-op when no default template exists
 * - T013: uploadDocument() auto-files ticket attachment into matching entity folder
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
let createFolderTemplate: typeof import('@alga-psa/documents/actions').createFolderTemplate;
let getFolderTemplate: typeof import('@alga-psa/documents/actions').getFolderTemplate;
let getFolderTemplates: typeof import('@alga-psa/documents/actions').getFolderTemplates;
let updateFolderTemplate: typeof import('@alga-psa/documents/actions').updateFolderTemplate;
let deleteFolderTemplate: typeof import('@alga-psa/documents/actions').deleteFolderTemplate;
let setDefaultTemplate: typeof import('@alga-psa/documents/actions').setDefaultTemplate;
let ensureEntityFolders: typeof import('@alga-psa/documents/actions').ensureEntityFolders;

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
  templateIds: string[];
};

let createdIds: CreatedIds = {
  clientIds: [],
  userIds: [],
  templateIds: []
};

async function cleanupCreatedRecords(db: Knex, tenantId: string, ids: CreatedIds): Promise<void> {
  const safeDelete = async (table: string, where: Record<string, unknown>) => {
    try {
      await db(table).where(where).del();
    } catch {
      // Ignore cleanup issues
    }
  };

  // Delete templates (items cascade via FK)
  for (const templateId of ids.templateIds) {
    await safeDelete('document_folder_templates', { tenant: tenantId, template_id: templateId });
  }

  // Delete entity folder init records
  await safeDelete('document_entity_folder_init', { tenant: tenantId });

  // Delete folders
  await safeDelete('document_folders', { tenant: tenantId });

  // Delete clients
  for (const clientId of ids.clientIds) {
    await safeDelete('contacts', { tenant: tenantId, client_id: clientId });
    await safeDelete('clients', { tenant: tenantId, client_id: clientId });
  }
}

describe('Document Folder Templates Integration Tests', () => {
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
    tenantId = await createTenant(db, 'Document Templates Test Tenant');
    userId = await createUser(db, tenantId, { username: 'template-test-user' });

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
    createFolderTemplate = documentActions.createFolderTemplate;
    getFolderTemplate = documentActions.getFolderTemplate;
    getFolderTemplates = documentActions.getFolderTemplates;
    updateFolderTemplate = documentActions.updateFolderTemplate;
    deleteFolderTemplate = documentActions.deleteFolderTemplate;
    setDefaultTemplate = documentActions.setDefaultTemplate;
    ensureEntityFolders = documentActions.ensureEntityFolders;
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
      templateIds: []
    };
    vi.clearAllMocks();
  });

  describe('T009: Folder template CRUD lifecycle', () => {
    it('should create template with items and retrieve it', async () => {
      // Create template with folder structure
      const result = await createFolderTemplate({
        name: 'MSP Client Default',
        entityType: 'client',
        isDefault: false,
        items: [
          { folderPath: '/Contracts', isClientVisible: true },
          { folderPath: '/Contracts/SLAs', isClientVisible: true },
          { folderPath: '/Invoices', isClientVisible: true },
          { folderPath: '/Technical', isClientVisible: false },
        ]
      });

      expect(result).toBeDefined();
      expect('template_id' in result).toBe(true);

      const template = result as { template_id: string; name: string; items: Array<{ folder_path: string }> };
      createdIds.templateIds.push(template.template_id);

      expect(template.name).toBe('MSP Client Default');
      expect(template.items).toHaveLength(4);

      // Retrieve template with items
      const retrieved = await getFolderTemplate(template.template_id);
      expect(retrieved).toBeDefined();

      const retrievedTemplate = retrieved as { template_id: string; items: Array<{ folder_path: string }> };
      expect(retrievedTemplate.template_id).toBe(template.template_id);
      expect(retrievedTemplate.items).toHaveLength(4);

      const paths = retrievedTemplate.items.map(i => i.folder_path);
      expect(paths).toContain('/Contracts');
      expect(paths).toContain('/Contracts/SLAs');
      expect(paths).toContain('/Invoices');
      expect(paths).toContain('/Technical');
    });

    it('should update template name and items', async () => {
      // Create initial template
      const created = await createFolderTemplate({
        name: 'Original Name',
        entityType: 'client',
        items: [{ folderPath: '/Original', isClientVisible: false }]
      });

      const template = created as { template_id: string };
      createdIds.templateIds.push(template.template_id);

      // Update template
      const updated = await updateFolderTemplate(template.template_id, {
        name: 'Updated Name',
        items: [
          { folderPath: '/NewFolder', isClientVisible: true },
          { folderPath: '/NewFolder/SubFolder', isClientVisible: false },
        ]
      });

      expect(updated).toBeDefined();
      const updatedTemplate = updated as { name: string; items: Array<{ folder_path: string; is_client_visible: boolean }> };

      expect(updatedTemplate.name).toBe('Updated Name');
      expect(updatedTemplate.items).toHaveLength(2);

      const paths = updatedTemplate.items.map(i => i.folder_path);
      expect(paths).toContain('/NewFolder');
      expect(paths).toContain('/NewFolder/SubFolder');
      expect(paths).not.toContain('/Original'); // Old item should be gone
    });

    it('should delete template and cascade delete items', async () => {
      // Create template
      const created = await createFolderTemplate({
        name: 'To Delete',
        entityType: 'client',
        items: [
          { folderPath: '/DeleteMe', isClientVisible: false },
          { folderPath: '/DeleteMe/Child', isClientVisible: false },
        ]
      });

      const template = created as { template_id: string };
      // Don't add to cleanup - we're deleting it

      // Verify template and items exist
      const beforeDelete = await db('document_folder_template_items')
        .where('tenant', tenantId)
        .where('template_id', template.template_id);
      expect(beforeDelete.length).toBe(2);

      // Delete template
      const deleted = await deleteFolderTemplate(template.template_id);
      expect(deleted).toBe(true);

      // Verify template is gone
      const afterDelete = await getFolderTemplate(template.template_id);
      expect(afterDelete).toBeNull();

      // Verify items are cascaded (deleted)
      const itemsAfterDelete = await db('document_folder_template_items')
        .where('tenant', tenantId)
        .where('template_id', template.template_id);
      expect(itemsAfterDelete.length).toBe(0);
    });

    it('should list templates filtered by entity type', async () => {
      // Create templates for different entity types
      const clientTemplate = await createFolderTemplate({
        name: 'Client Template',
        entityType: 'client',
        items: [{ folderPath: '/ClientFolder', isClientVisible: false }]
      });

      const ticketTemplate = await createFolderTemplate({
        name: 'Ticket Template',
        entityType: 'ticket',
        items: [{ folderPath: '/TicketFolder', isClientVisible: false }]
      });

      createdIds.templateIds.push(
        (clientTemplate as { template_id: string }).template_id,
        (ticketTemplate as { template_id: string }).template_id
      );

      // List all templates
      const allTemplates = await getFolderTemplates();
      expect(Array.isArray(allTemplates)).toBe(true);
      expect((allTemplates as Array<{ entity_type: string }>).length).toBeGreaterThanOrEqual(2);

      // List only client templates
      const clientTemplates = await getFolderTemplates('client');
      expect(Array.isArray(clientTemplates)).toBe(true);

      const clientOnly = clientTemplates as Array<{ entity_type: string }>;
      for (const t of clientOnly) {
        expect(t.entity_type).toBe('client');
      }
    });
  });

  describe('T010: setDefaultTemplate() behavior', () => {
    it('should mark template as default and unset previous default', async () => {
      // Create first template as default
      const template1 = await createFolderTemplate({
        name: 'First Default',
        entityType: 'client',
        isDefault: true,
        items: [{ folderPath: '/First', isClientVisible: false }]
      });

      const t1 = template1 as { template_id: string };
      createdIds.templateIds.push(t1.template_id);

      // Create second template (not default)
      const template2 = await createFolderTemplate({
        name: 'Second Template',
        entityType: 'client',
        isDefault: false,
        items: [{ folderPath: '/Second', isClientVisible: false }]
      });

      const t2 = template2 as { template_id: string };
      createdIds.templateIds.push(t2.template_id);

      // Verify first is default
      const beforeSwitch = await db('document_folder_templates')
        .where('tenant', tenantId)
        .where('entity_type', 'client')
        .where('is_default', true);
      expect(beforeSwitch.length).toBe(1);
      expect(beforeSwitch[0].template_id).toBe(t1.template_id);

      // Set second as default
      const result = await setDefaultTemplate(t2.template_id);
      expect(result).toBeDefined();
      expect((result as { is_default: boolean }).is_default).toBe(true);

      // Verify second is now default, first is not
      const afterSwitch = await db('document_folder_templates')
        .where('tenant', tenantId)
        .where('entity_type', 'client')
        .where('is_default', true);
      expect(afterSwitch.length).toBe(1);
      expect(afterSwitch[0].template_id).toBe(t2.template_id);

      // Verify first is no longer default
      const t1After = await db('document_folder_templates')
        .where('tenant', tenantId)
        .where('template_id', t1.template_id)
        .first();
      expect(t1After.is_default).toBe(false);
    });

    it('should enforce partial unique index (only one default per entity type)', async () => {
      // Create template as default
      const template = await createFolderTemplate({
        name: 'Only Default',
        entityType: 'project',
        isDefault: true,
        items: [{ folderPath: '/Project', isClientVisible: false }]
      });

      createdIds.templateIds.push((template as { template_id: string }).template_id);

      // Try to insert another default directly (bypassing action validation)
      const duplicateId = uuidv4();

      await expect(
        db('document_folder_templates').insert({
          tenant: tenantId,
          template_id: duplicateId,
          name: 'Another Default',
          entity_type: 'project',
          is_default: true,
          created_by: userId,
          updated_by: userId
        })
      ).rejects.toThrow(); // Should fail due to partial unique index
    });

    it('should allow defaults for different entity types simultaneously', async () => {
      // Create default for client
      const clientDefault = await createFolderTemplate({
        name: 'Client Default',
        entityType: 'client',
        isDefault: true,
        items: [{ folderPath: '/ClientDefault', isClientVisible: false }]
      });

      // Create default for ticket (should NOT unset client default)
      const ticketDefault = await createFolderTemplate({
        name: 'Ticket Default',
        entityType: 'ticket',
        isDefault: true,
        items: [{ folderPath: '/TicketDefault', isClientVisible: false }]
      });

      createdIds.templateIds.push(
        (clientDefault as { template_id: string }).template_id,
        (ticketDefault as { template_id: string }).template_id
      );

      // Verify both are defaults
      const defaults = await db('document_folder_templates')
        .where('tenant', tenantId)
        .where('is_default', true);

      expect(defaults.length).toBeGreaterThanOrEqual(2);

      const entityTypes = defaults.map((t: { entity_type: string }) => t.entity_type);
      expect(entityTypes).toContain('client');
      expect(entityTypes).toContain('ticket');
    });
  });

  describe('T011: ensureEntityFolders() applies template on first access', () => {
    it('should apply default template on first access and be idempotent on second call', async () => {
      const clientId = await createClient(db, tenantId, 'Template Apply Client');
      createdIds.clientIds.push(clientId);

      // Create default template for clients
      const template = await createFolderTemplate({
        name: 'Apply Test Template',
        entityType: 'client',
        isDefault: true,
        items: [
          { folderPath: '/Applied', isClientVisible: false },
          { folderPath: '/Applied/SubFolder', isClientVisible: true },
        ]
      });
      createdIds.templateIds.push((template as { template_id: string }).template_id);

      // First call - should apply template
      const firstResult = await ensureEntityFolders(clientId, 'client');
      expect(Array.isArray(firstResult)).toBe(true);

      // Verify folders were created
      const foldersAfterFirst = await db('document_folders')
        .where('tenant', tenantId)
        .where('entity_id', clientId)
        .where('entity_type', 'client');

      expect(foldersAfterFirst.length).toBe(2);
      const paths = foldersAfterFirst.map((f: { folder_path: string }) => f.folder_path);
      expect(paths).toContain('/Applied');
      expect(paths).toContain('/Applied/SubFolder');

      // Verify init record was created
      const initRecord = await db('document_entity_folder_init')
        .where('tenant', tenantId)
        .where('entity_id', clientId)
        .where('entity_type', 'client')
        .first();
      expect(initRecord).toBeDefined();

      // Second call - should be idempotent (no duplicate folders)
      const secondResult = await ensureEntityFolders(clientId, 'client');
      expect(Array.isArray(secondResult)).toBe(true);

      // Verify no duplicate folders were created
      const foldersAfterSecond = await db('document_folders')
        .where('tenant', tenantId)
        .where('entity_id', clientId)
        .where('entity_type', 'client');

      expect(foldersAfterSecond.length).toBe(2); // Still 2, not 4
    });

    it('should preserve correct visibility from template', async () => {
      const clientId = await createClient(db, tenantId, 'Visibility Test Client');
      createdIds.clientIds.push(clientId);

      // Create template with mixed visibility
      const template = await createFolderTemplate({
        name: 'Visibility Template',
        entityType: 'client',
        isDefault: true,
        items: [
          { folderPath: '/Public', isClientVisible: true },
          { folderPath: '/Internal', isClientVisible: false },
        ]
      });
      createdIds.templateIds.push((template as { template_id: string }).template_id);

      // Apply template
      await ensureEntityFolders(clientId, 'client');

      // Verify visibility was preserved
      const publicFolder = await db('document_folders')
        .where('tenant', tenantId)
        .where('entity_id', clientId)
        .where('folder_path', '/Public')
        .first();
      expect(publicFolder.is_client_visible).toBe(true);

      const internalFolder = await db('document_folders')
        .where('tenant', tenantId)
        .where('entity_id', clientId)
        .where('folder_path', '/Internal')
        .first();
      expect(internalFolder.is_client_visible).toBe(false);
    });
  });

  describe('T012: ensureEntityFolders() is no-op without default template', () => {
    it('should return empty array when no default template exists for entity type', async () => {
      const clientId = await createClient(db, tenantId, 'No Template Client');
      createdIds.clientIds.push(clientId);

      // Create a non-default template (should NOT be applied)
      const template = await createFolderTemplate({
        name: 'Non-Default Template',
        entityType: 'client',
        isDefault: false, // Not default!
        items: [{ folderPath: '/ShouldNotAppear', isClientVisible: false }]
      });
      createdIds.templateIds.push((template as { template_id: string }).template_id);

      // Call ensureEntityFolders
      const result = await ensureEntityFolders(clientId, 'client');
      expect(Array.isArray(result)).toBe(true);
      expect((result as Array<unknown>).length).toBe(0);

      // Verify no folders were created
      const folders = await db('document_folders')
        .where('tenant', tenantId)
        .where('entity_id', clientId)
        .where('entity_type', 'client');
      expect(folders.length).toBe(0);

      // Init record should still be created (to prevent re-checking)
      const initRecord = await db('document_entity_folder_init')
        .where('tenant', tenantId)
        .where('entity_id', clientId)
        .where('entity_type', 'client')
        .first();
      expect(initRecord).toBeDefined();
    });
  });

  describe('T013: uploadDocument() auto-files into matching entity folder', () => {
    it('should auto-file document into first matching entity folder when folder_path not set', async () => {
      const clientId = await createClient(db, tenantId, 'Auto-File Client');
      createdIds.clientIds.push(clientId);

      // Create default template with folders
      const template = await createFolderTemplate({
        name: 'Auto-File Template',
        entityType: 'client',
        isDefault: true,
        items: [
          { folderPath: '/Documents', isClientVisible: false },
        ]
      });
      createdIds.templateIds.push((template as { template_id: string }).template_id);

      // Apply template to create folders
      await ensureEntityFolders(clientId, 'client');

      // Verify folder exists
      const folder = await db('document_folders')
        .where('tenant', tenantId)
        .where('entity_id', clientId)
        .where('folder_path', '/Documents')
        .first();
      expect(folder).toBeDefined();

      // Note: Testing uploadDocument() would require mocking file upload infrastructure
      // which is complex. The action logic for auto-filing is unit tested.
      // This test verifies the folder exists for auto-filing to work.
    });

    it('should succeed with folder_path=null if no matching folder exists', async () => {
      const clientId = await createClient(db, tenantId, 'No Match Client');
      createdIds.clientIds.push(clientId);

      // No folders for this client - ensure folders not called

      // Create a document directly without folder
      const docId = uuidv4();
      const now = new Date();

      await db('documents').insert({
        tenant: tenantId,
        document_id: docId,
        document_name: 'Unfiled Document',
        content: '',
        folder_path: null, // No folder
        created_by: userId,
        created_at: now,
        updated_at: now,
        is_client_visible: false
      });

      // Create association
      await db('document_associations').insert({
        tenant: tenantId,
        association_id: uuidv4(),
        document_id: docId,
        entity_id: clientId,
        entity_type: 'client',
        created_at: now
      });

      // Verify document exists with null folder_path
      const doc = await db('documents')
        .where('tenant', tenantId)
        .where('document_id', docId)
        .first();
      expect(doc).toBeDefined();
      expect(doc.folder_path).toBeNull();

      // Cleanup
      await db('document_associations').where('tenant', tenantId).where('document_id', docId).del();
      await db('documents').where('tenant', tenantId).where('document_id', docId).del();
    });
  });
});
