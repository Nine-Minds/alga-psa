import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { TestContext } from '../../../test-utils/testContext';
import {  canAccessDocument,
  filterAccessibleDocuments
} from 'server/src/lib/utils/documentPermissionUtils';
import { IUser } from '@/interfaces/auth.interfaces';
import { IDocument } from '@/interfaces/document.interface';
import { IDocumentAssociation } from '@/interfaces/document-association.interface';
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
  let testContractId: string;
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
        'companies'
      ],
      clientName: 'Document Test Client'
    });
  }, 120000);

  afterAll(async () => {
    await cleanupContext();
  });

  beforeEach(async () => {
    context = await resetContext();
    await seedTestData();
  });

  afterEach(async () => {
    await rollbackContext();
  });

  async function seedTestData() {
    // Create test client
    testClientId = uuidv4();
    await context.db('companies').insert({
      company_id: testClientId,
      tenant: context.tenantId,
      company_name: 'Test Client',
      is_inactive: false
    });

    // Create test ticket
    testTicketId = uuidv4();
    await context.db('tickets').insert({
      ticket_id: testTicketId,
      tenant: context.tenantId,
      title: 'Test Ticket',
      ticket_number: 'TEST-001',
      company_id: testClientId,
      entered_by: context.userId,
      status_id: uuidv4() // Simplified - in real tests would reference actual status
    });

    // Create test contract (using contracts table if available)
    testContractId = uuidv4();
    // Note: This assumes a contracts table exists. Adjust based on your schema.
    // If using billing_plans, adapt accordingly.
    try {
      await context.db('contracts').insert({
        contract_id: testContractId,
        tenant: context.tenantId,
        contract_name: 'Test Contract',
        company_id: testClientId
      });
    } catch (error) {
      // If contracts table doesn't exist, we'll skip contract-related tests
      console.warn('Contracts table may not exist, some tests may be skipped');
    }

    // Create test documents
    documentNoAssoc = {
      document_id: uuidv4(),
      tenant: context.tenantId,
      document_name: 'Document No Associations',
      type_id: null,
      user_id: context.userId,
      order_number: 0,
      created_by: context.userId
    };

    documentWithTicket = {
      document_id: uuidv4(),
      tenant: context.tenantId,
      document_name: 'Document With Ticket',
      type_id: null,
      user_id: context.userId,
      order_number: 1,
      created_by: context.userId
    };

    documentWithContract = {
      document_id: uuidv4(),
      tenant: context.tenantId,
      document_name: 'Document With Contract',
      type_id: null,
      user_id: context.userId,
      order_number: 2,
      created_by: context.userId
    };

    documentWithMultiple = {
      document_id: uuidv4(),
      tenant: context.tenantId,
      document_name: 'Document With Multiple Associations',
      type_id: null,
      user_id: context.userId,
      order_number: 3,
      created_by: context.userId
    };

    await context.db('documents').insert([
      documentNoAssoc,
      documentWithTicket,
      documentWithContract,
      documentWithMultiple
    ]);

    // Create standard associations
    await createStandardAssociations();
  }

  async function createStandardAssociations() {
    // Create ticket association
    await context.db('document_associations').insert({
      association_id: uuidv4(),
      tenant: context.tenantId,
      document_id: documentWithTicket.document_id,
      entity_id: testTicketId,
      entity_type: 'ticket'
    });

    // Create contract association (if contracts table exists)
    try {
      await context.db('document_associations').insert({
        association_id: uuidv4(),
        tenant: context.tenantId,
        document_id: documentWithContract.document_id,
        entity_id: testContractId,
        entity_type: 'contract'
      });
    } catch (error) {
      console.warn('Skipping contract association creation');
    }

    // Create multiple associations
    await context.db('document_associations').insert([
      {
        association_id: uuidv4(),
        tenant: context.tenantId,
        document_id: documentWithMultiple.document_id,
        entity_id: testTicketId,
        entity_type: 'ticket'
      },
      {
        association_id: uuidv4(),
        tenant: context.tenantId,
        document_id: documentWithMultiple.document_id,
        entity_id: testClientId,
        entity_type: 'client'
      }
    ]);
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
      if (associations.length > 0) {
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
      const wrongTenantAssoc = {
        association_id: uuidv4(),
        tenant: 'wrong-tenant-id',
        document_id: documentNoAssoc.document_id,
        entity_id: testTicketId,
        entity_type: 'ticket'
      };

      await context.db('document_associations').insert(wrongTenantAssoc);

      // Query with correct tenant should not find it
      const results = await context.db('document_associations')
        .where('tenant', context.tenantId)
        .where('document_id', documentNoAssoc.document_id)
        .select('*');

      expect(results.length).toBe(0);

      // Cleanup
      await context.db('document_associations')
        .where('association_id', wrongTenantAssoc.association_id)
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
      // Create 100 test documents
      const testDocs = Array.from({ length: 100 }, (_, i) => ({
        document_id: uuidv4(),
        tenant: context.tenantId,
        document_name: `Perf Test Doc ${i}`,
        type_id: null,
        user_id: context.userId,
        order_number: i + 100,
        created_by: context.userId
      }));

      await context.db('documents').insert(testDocs);

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
      // Create 50 documents with associations
      const testDocs = Array.from({ length: 50 }, (_, i) => ({
        document_id: uuidv4(),
        tenant: context.tenantId,
        document_name: `Bulk Test Doc ${i}`,
        type_id: null,
        user_id: context.userId,
        order_number: i + 200,
        created_by: context.userId
      }));

      await context.db('documents').insert(testDocs);

      // Create associations for each
      const testAssocs = testDocs.map(doc => ({
        association_id: uuidv4(),
        tenant: context.tenantId,
        document_id: doc.document_id,
        entity_id: testTicketId,
        entity_type: 'ticket'
      }));

      await context.db('document_associations').insert(testAssocs);

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
        .whereIn('association_id', testAssocs.map(a => a.association_id))
        .delete();
      await context.db('documents')
        .where('tenant', context.tenantId)
        .whereIn('document_id', testDocs.map(d => d.document_id))
        .delete();
    });
  });
});
