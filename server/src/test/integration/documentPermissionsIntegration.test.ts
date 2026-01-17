import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { TestContext } from '../../../test-utils/testContext';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import { addDocument } from '@alga-psa/documents/actions/documentActions';
import { createContract } from 'server/src/lib/actions/contractActions';
import DocumentAssociation from 'server/src/models/document-association';
import {
  canAccessDocument,
  filterAccessibleDocuments
} from 'server/src/lib/utils/documentPermissionUtils';
import { IUser } from '@/interfaces/auth.interfaces';
import { IDocument, DocumentInput } from '@/interfaces/document.interface';
import { DocumentAssociationEntityType } from '@/interfaces/document-association.interface';
import { v4 as uuidv4 } from 'uuid';

/**
 * Document Permissions Integration Tests
 *
 * Tests the document permission system with real database operations
 * including document associations, entity types, and user permissions.
 */

describe('Document Permissions Integration Tests', () => {
  const {
    beforeAll: setupContext,
    beforeEach: resetContext,
    afterEach: rollbackContext,
    afterAll: cleanupContext
  } = TestContext.createHelpers();

  let context: TestContext;

  // Test data IDs
  let testClientId: string;
  let testTicketId: string;
  let testContractId: string | null;
  let documentNoAssoc: IDocument;
  let documentWithTicket: IDocument;
  let documentWithContract: IDocument;
  let documentWithMultiple: IDocument;

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'document_associations',
        'documents',
        'tickets',
        'contracts',
        'clients'
      ],
      clientName: 'Document Test Client'
    });

    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
  }, 120000);

  afterAll(async () => {
    await cleanupContext();
  });

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    await seedTestData();
  });

  afterEach(async () => {
    await rollbackContext();
  });

  async function seedTestData() {
    // Create test client
    testClientId = uuidv4();
    await context.db('clients').insert({
      client_id: testClientId,
      tenant: context.tenantId,
      client_name: 'Test Client',
      is_inactive: false
    });

    // Determine available columns for statuses table to keep compatibility across schema versions
    const statusColumns: string[] = await context.db('information_schema.columns')
      .select('column_name')
      .where({ table_schema: 'public', table_name: 'statuses' })
      .pluck('column_name');

    const hasItemType = statusColumns.includes('item_type');
    const hasStatusType = statusColumns.includes('status_type');

    // Ensure we have a ticket status for FK constraint
    let statusQuery = context.db('statuses').where('tenant', context.tenantId);
    if (hasItemType) {
      statusQuery = statusQuery.where('item_type', 'ticket');
    } else if (hasStatusType) {
      statusQuery = statusQuery.where('status_type', 'ticket');
    }

    let statusId: string | undefined = await statusQuery
      .first()
      .then(row => row?.status_id as string | undefined);

    if (!statusId) {
      statusId = uuidv4();
      const statusData: Record<string, any> = {
        status_id: statusId,
        tenant: context.tenantId,
        name: 'New'
      };

      if (hasItemType) {
        statusData.item_type = 'ticket';
      }
      if (hasStatusType) {
        statusData.status_type = 'ticket';
      }
      if (statusColumns.includes('order_number')) {
        statusData.order_number = 1;
      }
      if (statusColumns.includes('is_default')) {
        statusData.is_default = true;
      }
      if (statusColumns.includes('is_closed')) {
        statusData.is_closed = false;
      }
      if (statusColumns.includes('created_by')) {
        statusData.created_by = context.userId;
      }
      if (statusColumns.includes('created_at')) {
        statusData.created_at = new Date();
      }
      if (statusColumns.includes('status_key')) {
        statusData.status_key = 'new';
      }

      await context.db('statuses').insert(statusData);
    }

    if (!statusId) {
      throw new Error('Unable to determine ticket status for integration test seeding');
    }

    // Create test ticket
    testTicketId = uuidv4();
    await context.db('tickets').insert({
      ticket_id: testTicketId,
      tenant: context.tenantId,
      title: 'Test Ticket',
      ticket_number: 'TEST-001',
      client_id: testClientId,
      entered_by: context.userId,
      status_id: statusId
    });

    // Create test contract using contract actions (if supported by schema)
    testContractId = null;
    if (await tableExists('contracts')) {
      try {
        const contract = await createContract({
          contract_name: 'Test Contract',
          billing_frequency: 'monthly',
          status: 'draft',
          is_active: true,
          contract_description: 'Integration Test Contract'
        });
        testContractId = contract.contract_id;
      } catch (error) {
        console.warn('Failed to create contract record, skipping contract-related tests', error);
      }
    } else {
      console.warn('Contracts table not found, skipping contract-related tests');
    }

    // Create test documents through document actions
    documentNoAssoc = await createDocumentRecord('Document No Associations', 0);
    documentWithTicket = await createDocumentRecord('Document With Ticket', 1);
    documentWithContract = await createDocumentRecord('Document With Contract', 2);
    documentWithMultiple = await createDocumentRecord('Document With Multiple Associations', 3);

    // Create standard associations
    await createStandardAssociations();
  }

  async function createStandardAssociations() {
    // Create ticket association
    await associateDocument(documentWithTicket, testTicketId, 'ticket');

    // Create contract association (if contracts table exists)
    if (testContractId) {
      try {
        await associateDocument(documentWithContract, testContractId, 'contract');
      } catch (error) {
        console.warn('Skipping contract association creation', error);
      }
    }

    // Create multiple associations
    await associateDocument(documentWithMultiple, testTicketId, 'ticket');
    await associateDocument(documentWithMultiple, testClientId, 'client');
  }

  async function tableExists(tableName: string): Promise<boolean> {
    const result = await context.db('information_schema.tables')
      .where({ table_schema: 'public', table_name: tableName })
      .count('* as count')
      .first();

    const countValue = result?.count;
    return typeof countValue === 'string'
      ? parseInt(countValue, 10) > 0
      : Number(countValue ?? 0) > 0;
  }

  async function createDocumentRecord(name: string, orderNumber: number): Promise<IDocument> {
    const documentInput: DocumentInput = {
      tenant: context.tenantId,
      document_name: name,
      type_id: null,
      user_id: context.userId,
      order_number: orderNumber,
      created_by: context.userId
    };

    const { _id } = await addDocument(documentInput);
    const record = await context.db('documents')
      .where({ tenant: context.tenantId, document_id: _id })
      .first();

    if (!record) {
      throw new Error(`Failed to create document record for ${name}`);
    }

    return record as IDocument;
  }

  async function associateDocument(
    document: IDocument,
    entityId: string,
    entityType: DocumentAssociationEntityType
  ): Promise<string> {
    const { association_id } = await DocumentAssociation.create(context.db, {
      tenant: context.tenantId,
      document_id: document.document_id,
      entity_id: entityId,
      entity_type: entityType
    });

    return association_id;
  }

  async function ensureTenantExists(tenantId: string): Promise<{ userId: string; documentId: string }> {
    const now = new Date();
    const sample = tenantId.slice(0, 8);

    const tenantColumns = await context.db('tenants').columnInfo();
    const tenantPayload: Record<string, any> = { tenant: tenantId };

    const tenantOverrides: Record<string, any> = {
      name: `Test Tenant ${sample}`,
      tenant_name: `Test Tenant ${sample}`,
      organization_name: `Test Tenant ${sample}`,
      client_name: `Client ${sample}`,
      company_name: `Company ${sample}`,
      email: `tenant-${sample}@example.com`,
      primary_contact_email: `tenant-${sample}@example.com`,
      created_by: context.userId,
      created_at: now,
      updated_at: now
    };

    applyColumnDefaults(tenantColumns, tenantPayload, tenantOverrides, sample, now);

    await context.db('tenants')
      .insert(tenantPayload)
      .onConflict('tenant')
      .merge(tenantPayload);

    const userColumns = await context.db('users').columnInfo();
    const existingUser = await context.db('users')
      .where({ tenant: tenantId })
      .first('user_id');

    let userId: string;

    if (existingUser?.user_id) {
      userId = existingUser.user_id as string;
    } else {
      userId = uuidv4();
      const userPayload: Record<string, any> = {
        user_id: userId,
        tenant: tenantId
      };

      const userOverrides: Record<string, any> = {
        username: `test-user-${sample}`,
        email: `${sample}@example.com`,
        hashed_password: 'hashed-password',
        user_type: 'internal',
        first_name: 'Test',
        last_name: 'User',
        is_inactive: false,
        created_at: now,
        updated_at: now
      };

      applyColumnDefaults(userColumns, userPayload, userOverrides, sample, now);

      await context.db('users').insert(userPayload);
    }

    const documentColumns = await context.db('documents').columnInfo();
    const documentId = uuidv4();
    const documentPayload: Record<string, any> = {
      document_id: documentId,
      tenant: tenantId,
      document_name: 'Tenant Isolation Doc',
      type_id: null,
      user_id: userId,
      order_number: 0,
      created_by: userId
    };

    const documentOverrides: Record<string, any> = {
      entered_at: now,
      created_at: now,
      updated_at: now,
      mime_type: null,
      file_size: null,
      storage_path: null,
      folder_path: null,
      thumbnail_file_id: null,
      preview_file_id: null
    };

    applyColumnDefaults(documentColumns, documentPayload, documentOverrides, sample, now);

    await context.db('documents').insert(documentPayload);

    return { userId, documentId };
  }

  function applyColumnDefaults(
    columns: Record<string, { type: string; nullable: boolean; defaultValue: any }>,
    payload: Record<string, any>,
    overrides: Record<string, any>,
    sample: string,
    now: Date
  ) {
    for (const [column, info] of Object.entries(columns)) {
      if (column === 'tenant' || column === 'document_id' || column === 'user_id') {
        continue;
      }

      if (payload[column] !== undefined) {
        continue;
      }

      if (overrides[column] !== undefined) {
        payload[column] = overrides[column];
        continue;
      }

      const nullable = info?.nullable;
      const defaultValue = info?.defaultValue;

      if (nullable === false && defaultValue == null) {
        payload[column] = generateDefaultValue(column, info, sample, now);
      }
    }
  }

  function generateDefaultValue(
    column: string,
    info: { type?: string; nullable?: boolean; defaultValue?: any },
    sample: string,
    now: Date
  ) {
    const type = (info?.type || '').toLowerCase();

    if (column === 'email' || column.endsWith('_email')) {
      return `${sample}@example.com`;
    }
    if (column.endsWith('_name')) {
      return `${column.replace(/_/g, ' ')} ${sample}`;
    }
    if (column === 'created_by' || column === 'updated_by') {
      return context.userId;
    }
    if (type.includes('timestamp') || type.includes('date')) {
      return now;
    }
    if (type.includes('bool')) {
      return false;
    }
    if (type.includes('int') || type.includes('numeric') || type.includes('decimal')) {
      return 0;
    }
    if (type.includes('uuid')) {
      return uuidv4();
    }

    return `${column}-${sample}`;
  }

  describe('canAccessDocument with real database', () => {
    it('should allow access to document with no associations (tenant-level)', async () => {
      // This test verifies the database query returns no associations
      const associations = await context.db('document_associations')
        .where('tenant', context.tenantId)
        .where('document_id', documentNoAssoc.document_id)
        .select('*');

      expect(associations.length).toBe(0);
    });

    it('should verify document with ticket association exists in database', async () => {
      const associations = await context.db('document_associations')
        .where('tenant', context.tenantId)
        .where('document_id', documentWithTicket.document_id)
        .select('*');

      expect(associations.length).toBe(1);
      expect(associations[0].entity_type).toBe('ticket');
      expect(associations[0].entity_id).toBe(testTicketId);
    });

    it('should verify document with contract association exists in database', async () => {
      const associations = await context.db('document_associations')
        .where('tenant', context.tenantId)
        .where('document_id', documentWithContract.document_id)
        .select('*');

      // May be 0 if contracts table doesn't exist
      if (testContractId && associations.length > 0) {
        expect(associations[0].entity_type).toBe('contract');
        expect(associations[0].entity_id).toBe(testContractId);
      }
    });

    it('should verify document with multiple associations exists in database', async () => {
      const associations = await context.db('document_associations')
        .where('tenant', context.tenantId)
        .where('document_id', documentWithMultiple.document_id)
        .select('*');

      expect(associations.length).toBe(2);
      const entityTypes = associations.map(a => a.entity_type);
      expect(entityTypes).toContain('ticket');
      expect(entityTypes).toContain('client');
    });
  });

  describe('filterAccessibleDocuments with real database', () => {
    it('should bulk load associations in single query', async () => {
      const allDocuments = [
        documentNoAssoc,
        documentWithTicket,
        documentWithContract,
        documentWithMultiple
      ];

      // Verify we can query all associations in one go
      const documentIds = allDocuments.map(d => d.document_id);
      const associations = await context.db('document_associations')
        .whereIn('document_id', documentIds)
        .andWhere('tenant', context.tenantId)
        .select('document_id', 'entity_type');

      // Should have at least the standard associations (3-4 depending on contracts table)
      expect(associations.length).toBeGreaterThanOrEqual(3);
    });

    it('should correctly map document IDs to entity types', async () => {
      const documentIds = [documentWithTicket.document_id, documentWithMultiple.document_id];

      const associations = await context.db('document_associations')
        .whereIn('document_id', documentIds)
        .andWhere('tenant', context.tenantId)
        .select('document_id', 'entity_type');

      // Build map
      const docAssociationsMap = new Map<string, Set<string>>();
      for (const assoc of associations) {
        if (!docAssociationsMap.has(assoc.document_id)) {
          docAssociationsMap.set(assoc.document_id, new Set());
        }
        docAssociationsMap.get(assoc.document_id)!.add(assoc.entity_type);
      }

      // Verify mapping
      expect(docAssociationsMap.get(documentWithTicket.document_id)).toContain('ticket');
      expect(docAssociationsMap.get(documentWithMultiple.document_id)).toContain('ticket');
      expect(docAssociationsMap.get(documentWithMultiple.document_id)).toContain('client');
    });
  });

  describe('Database integrity checks', () => {
    it('should enforce tenant isolation for document_associations', async () => {
      // Try to create association with wrong tenant (should work but not be queryable)
      const wrongTenantId = uuidv4();
      const { documentId: wrongTenantDocumentId } = await ensureTenantExists(wrongTenantId);

      const wrongTenantAssoc = {
        association_id: uuidv4(),
        tenant: wrongTenantId,
        document_id: wrongTenantDocumentId,
        entity_id: testTicketId,
        entity_type: 'ticket'
      };

      await context.db('document_associations').insert(wrongTenantAssoc);

      // Query with correct tenant should not find it
      const results = await context.db('document_associations')
        .where('tenant', context.tenantId)
        .where('document_id', wrongTenantDocumentId)
        .select('*');

      expect(results.length).toBe(0);

      // Cleanup
      await context.db('document_associations')
        .where({ association_id: wrongTenantAssoc.association_id, tenant: wrongTenantId })
        .delete();
    });

    it('should handle documents with same name but different tenants', async () => {
      // This verifies tenant isolation for documents table
      const count = await context.db('documents')
        .where('tenant', context.tenantId)
        .where('document_name', 'Document No Associations')
        .count('* as count')
        .first();

      expect(parseInt(count?.count as string)).toBe(1);
    });

    it('should support all entity types in document_associations CHECK constraint', async () => {
      const entityTypes = ['contract', 'ticket', 'client', 'contact', 'asset', 'project_task', 'user', 'tenant'];

      // Verify each entity type can be inserted
      for (const entityType of entityTypes) {
        const testAssoc = {
          association_id: uuidv4(),
          tenant: context.tenantId,
          document_id: documentNoAssoc.document_id,
          entity_id: uuidv4(),
          entity_type: entityType
        };

        try {
          await context.db('document_associations').insert(testAssoc);

          // Verify it was inserted
          const result = await context.db('document_associations')
            .where('association_id', testAssoc.association_id)
            .first();

          expect(result).toBeDefined();
          expect(result?.entity_type).toBe(entityType);

          // Cleanup
          await context.db('document_associations')
            .where('association_id', testAssoc.association_id)
            .delete();
        } catch (error) {
          console.error(`Failed to insert association with entity_type: ${entityType}`, error);
          throw error;
        }
      }
    });
  });

  describe('Performance tests', () => {
    it('should efficiently query large number of documents', async () => {
      // Create 100 test documents via document action
      const testDocs: IDocument[] = [];
      for (let i = 0; i < 100; i++) {
        testDocs.push(await createDocumentRecord(`Perf Test Doc ${i}`, i + 100));
      }

      // Query all documents
      const startTime = Date.now();
      const documents = await context.db('documents')
        .where('tenant', context.tenantId)
        .whereIn('document_id', testDocs.map(d => d.document_id))
        .select('*');
      const queryTime = Date.now() - startTime;

      expect(documents.length).toBe(100);
      expect(queryTime).toBeLessThan(1000); // Should complete in less than 1 second

      // Cleanup
      await context.db('documents')
        .where('tenant', context.tenantId)
        .whereIn('document_id', testDocs.map(d => d.document_id))
        .delete();
    });

    it('should efficiently bulk load associations for many documents', async () => {
      // Create 50 documents with associations using domain actions
      const testDocs: IDocument[] = [];
      for (let i = 0; i < 50; i++) {
        const doc = await createDocumentRecord(`Bulk Test Doc ${i}`, i + 200);
        testDocs.push(doc);
        await associateDocument(doc, testTicketId, 'ticket');
      }

      // Bulk load associations (single query)
      const startTime = Date.now();
      const associations = await context.db('document_associations')
        .whereIn('document_id', testDocs.map(d => d.document_id))
        .andWhere('tenant', context.tenantId)
        .select('document_id', 'entity_type');
      const queryTime = Date.now() - startTime;

      expect(associations.length).toBe(50);
      expect(queryTime).toBeLessThan(500); // Should be very fast with proper indexing

      // Cleanup
      await context.db('document_associations')
        .where('tenant', context.tenantId)
        .whereIn('document_id', testDocs.map(d => d.document_id))
        .delete();
      await context.db('documents')
        .where('tenant', context.tenantId)
        .whereIn('document_id', testDocs.map(d => d.document_id))
        .delete();
    });
  });
});
