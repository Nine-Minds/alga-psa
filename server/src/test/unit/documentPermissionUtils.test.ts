import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  canAccessDocument,
  filterAccessibleDocuments,
  canAssociateWithEntity,
  getEntityTypesForUser
} from '../../lib/utils/documentPermissionUtils';
import { IUser } from '../../interfaces/auth.interfaces';
import { IDocument } from '../../interfaces/document.interface';
import { IDocumentAssociation } from '../../interfaces/document-association.interface';

// Mock dependencies
vi.mock('../../lib/auth/rbac', () => ({
  hasPermission: vi.fn()
}));

vi.mock('../../lib/models/document-association', () => ({
  default: {
    getByDocumentId: vi.fn()
  }
}));

vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn()
}));

import { hasPermission } from '@/lib/auth/rbac';
import DocumentAssociation from '@/lib/models/document-association';
import { createTenantKnex } from '@/lib/db';

describe('documentPermissionUtils', () => {
  const mockUser: IUser = {
    user_id: 'user-123',
    tenant: 'tenant-123',
    username: 'testuser',
    email: 'test@example.com',
    user_type: 'internal' as const,
    hashed_password: '',
    first_name: 'Test',
    last_name: 'User',
    is_inactive: false
  };

  const mockDocument: IDocument = {
    document_id: 'doc-123',
    tenant: 'tenant-123',
    document_name: 'Test Document',
    type_id: null,
    user_id: 'user-123',
    order_number: 0,
    created_by: 'user-123'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('canAccessDocument', () => {
    it('should deny access if user lacks document read permission', async () => {
      vi.mocked(hasPermission).mockResolvedValue(false);

      const result = await canAccessDocument(mockUser, mockDocument);

      expect(result).toBe(false);
      expect(hasPermission).toHaveBeenCalledWith(mockUser, 'document', 'read');
    });

    it('should allow access to document with no associations (tenant-level)', async () => {
      vi.mocked(hasPermission).mockResolvedValue(true);
      vi.mocked(DocumentAssociation.getByDocumentId).mockResolvedValue([]);

      const result = await canAccessDocument(mockUser, mockDocument);

      expect(result).toBe(true);
      expect(DocumentAssociation.getByDocumentId).toHaveBeenCalledWith('doc-123');
    });

    it('should allow access if user has permission for associated entity (contract)', async () => {
      const mockAssociation: IDocumentAssociation = {
        association_id: 'assoc-123',
        tenant: 'tenant-123',
        document_id: 'doc-123',
        entity_id: 'contract-123',
        entity_type: 'contract'
      };

      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        if (resource === 'document' && action === 'read') return true;
        if (resource === 'billing' && action === 'read') return true;
        return false;
      });

      vi.mocked(DocumentAssociation.getByDocumentId).mockResolvedValue([mockAssociation]);

      const result = await canAccessDocument(mockUser, mockDocument);

      expect(result).toBe(true);
      expect(hasPermission).toHaveBeenCalledWith(mockUser, 'billing', 'read');
    });

    it('should allow access if user has permission for associated entity (ticket)', async () => {
      const mockAssociation: IDocumentAssociation = {
        association_id: 'assoc-123',
        tenant: 'tenant-123',
        document_id: 'doc-123',
        entity_id: 'ticket-123',
        entity_type: 'ticket'
      };

      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        if (resource === 'document' && action === 'read') return true;
        if (resource === 'ticket' && action === 'read') return true;
        return false;
      });

      vi.mocked(DocumentAssociation.getByDocumentId).mockResolvedValue([mockAssociation]);

      const result = await canAccessDocument(mockUser, mockDocument);

      expect(result).toBe(true);
      expect(hasPermission).toHaveBeenCalledWith(mockUser, 'ticket', 'read');
    });

    it('should deny access if user lacks permission for associated entity', async () => {
      const mockAssociation: IDocumentAssociation = {
        association_id: 'assoc-123',
        tenant: 'tenant-123',
        document_id: 'doc-123',
        entity_id: 'contract-123',
        entity_type: 'contract'
      };

      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        if (resource === 'document' && action === 'read') return true;
        if (resource === 'billing' && action === 'read') return false;
        return false;
      });

      vi.mocked(DocumentAssociation.getByDocumentId).mockResolvedValue([mockAssociation]);

      const result = await canAccessDocument(mockUser, mockDocument);

      expect(result).toBe(false);
    });

    it('should allow access for tenant entity type (special case)', async () => {
      const mockAssociation: IDocumentAssociation = {
        association_id: 'assoc-123',
        tenant: 'tenant-123',
        document_id: 'doc-123',
        entity_id: 'tenant-123',
        entity_type: 'tenant'
      };

      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        if (resource === 'document' && action === 'read') return true;
        return false;
      });

      vi.mocked(DocumentAssociation.getByDocumentId).mockResolvedValue([mockAssociation]);

      const result = await canAccessDocument(mockUser, mockDocument);

      expect(result).toBe(true);
    });

    it('should allow access if user has permission for ANY of multiple associations', async () => {
      const mockAssociations: IDocumentAssociation[] = [
        {
          association_id: 'assoc-1',
          tenant: 'tenant-123',
          document_id: 'doc-123',
          entity_id: 'contract-123',
          entity_type: 'contract'
        },
        {
          association_id: 'assoc-2',
          tenant: 'tenant-123',
          document_id: 'doc-123',
          entity_id: 'ticket-123',
          entity_type: 'ticket'
        }
      ];

      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        if (resource === 'document' && action === 'read') return true;
        if (resource === 'billing' && action === 'read') return false; // No billing permission
        if (resource === 'ticket' && action === 'read') return true;   // Has ticket permission
        return false;
      });

      vi.mocked(DocumentAssociation.getByDocumentId).mockResolvedValue(mockAssociations);

      const result = await canAccessDocument(mockUser, mockDocument);

      expect(result).toBe(true);
    });

    it('should deny access if user lacks permission for ALL multiple associations', async () => {
      const mockAssociations: IDocumentAssociation[] = [
        {
          association_id: 'assoc-1',
          tenant: 'tenant-123',
          document_id: 'doc-123',
          entity_id: 'contract-123',
          entity_type: 'contract'
        },
        {
          association_id: 'assoc-2',
          tenant: 'tenant-123',
          document_id: 'doc-123',
          entity_id: 'ticket-123',
          entity_type: 'ticket'
        }
      ];

      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        if (resource === 'document' && action === 'read') return true;
        if (resource === 'billing' && action === 'read') return false;
        if (resource === 'ticket' && action === 'read') return false;
        return false;
      });

      vi.mocked(DocumentAssociation.getByDocumentId).mockResolvedValue(mockAssociations);

      const result = await canAccessDocument(mockUser, mockDocument);

      expect(result).toBe(false);
    });
  });

  describe('filterAccessibleDocuments', () => {
    it('should return empty array if no documents provided', async () => {
      const result = await filterAccessibleDocuments(mockUser, []);

      expect(result).toEqual([]);
    });

    it('should return empty array if user lacks document read permission', async () => {
      vi.mocked(hasPermission).mockResolvedValue(false);

      const result = await filterAccessibleDocuments(mockUser, [mockDocument]);

      expect(result).toEqual([]);
    });

    it('should filter documents based on user permissions (optimized - bulk load)', async () => {
      const mockDocuments: IDocument[] = [
        { ...mockDocument, document_id: 'doc-1' },
        { ...mockDocument, document_id: 'doc-2' },
        { ...mockDocument, document_id: 'doc-3' }
      ];

      const mockKnex: any = vi.fn();
      mockKnex.whereIn = vi.fn().mockReturnValue(mockKnex);
      mockKnex.andWhere = vi.fn().mockReturnValue(mockKnex);
      mockKnex.select = vi.fn().mockResolvedValue([
        { document_id: 'doc-1', entity_type: 'ticket' },
        { document_id: 'doc-2', entity_type: 'contract' },
        // doc-3 has no associations
      ]);
      mockKnex.mockImplementation(() => mockKnex);

      vi.mocked(createTenantKnex).mockResolvedValue({
        knex: mockKnex as any,
        tenant: 'tenant-123'
      });

      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        if (resource === 'document' && action === 'read') return true;
        if (resource === 'ticket' && action === 'read') return true;
        if (resource === 'billing' && action === 'read') return false;
        return false;
      });

      const result = await filterAccessibleDocuments(mockUser, mockDocuments);

      // User has ticket permission, so doc-1 is accessible
      // User lacks billing permission, so doc-2 is NOT accessible
      // doc-3 has no associations, so it's accessible (tenant-level)
      expect(result.length).toBe(2);
      expect(result.find(d => d.document_id === 'doc-1')).toBeDefined();
      expect(result.find(d => d.document_id === 'doc-3')).toBeDefined();
      expect(result.find(d => d.document_id === 'doc-2')).toBeUndefined();
    });

    it('should use single query for bulk loading associations (performance test)', async () => {
      const mockDocuments: IDocument[] = Array.from({ length: 100 }, (_, i) => ({
        ...mockDocument,
        document_id: `doc-${i}`
      }));

      const mockKnex: any = vi.fn();
      mockKnex.whereIn = vi.fn().mockReturnValue(mockKnex);
      mockKnex.andWhere = vi.fn().mockReturnValue(mockKnex);
      mockKnex.select = vi.fn().mockResolvedValue([]);
      mockKnex.mockImplementation(() => mockKnex);

      vi.mocked(createTenantKnex).mockResolvedValue({
        knex: mockKnex as any,
        tenant: 'tenant-123'
      });

      vi.mocked(hasPermission).mockResolvedValue(true);

      await filterAccessibleDocuments(mockUser, mockDocuments);

      // Verify single query was made (not N queries)
      expect(mockKnex.whereIn).toHaveBeenCalledTimes(1);
      expect(mockKnex.select).toHaveBeenCalledTimes(1);
    });
  });

  describe('canAssociateWithEntity', () => {
    it('should deny if user lacks document update permission', async () => {
      vi.mocked(hasPermission).mockResolvedValue(false);

      const result = await canAssociateWithEntity(mockUser, 'ticket');

      expect(result).toBe(false);
      expect(hasPermission).toHaveBeenCalledWith(mockUser, 'document', 'update');
    });

    it('should deny if entity type is not recognized', async () => {
      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        if (resource === 'document' && action === 'update') return true;
        return false;
      });

      const result = await canAssociateWithEntity(mockUser, 'invalid_entity_type');

      expect(result).toBe(false);
    });

    it('should allow if user has both document and entity permissions', async () => {
      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        if (resource === 'document' && action === 'update') return true;
        if (resource === 'ticket' && action === 'read') return true;
        return false;
      });

      const result = await canAssociateWithEntity(mockUser, 'ticket');

      expect(result).toBe(true);
      expect(hasPermission).toHaveBeenCalledWith(mockUser, 'document', 'update');
      expect(hasPermission).toHaveBeenCalledWith(mockUser, 'ticket', 'read');
    });

    it('should deny if user lacks entity permission', async () => {
      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        if (resource === 'document' && action === 'update') return true;
        if (resource === 'billing' && action === 'read') return false;
        return false;
      });

      const result = await canAssociateWithEntity(mockUser, 'contract');

      expect(result).toBe(false);
    });
  });

  describe('getEntityTypesForUser', () => {
    it('should always include tenant type', async () => {
      vi.mocked(hasPermission).mockResolvedValue(false);

      const result = await getEntityTypesForUser(mockUser);

      expect(result).toContain('tenant');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return all entity types user has permission for', async () => {
      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        if (resource === 'ticket' && action === 'read') return true;
        if (resource === 'billing' && action === 'read') return true;
        if (resource === 'client' && action === 'read') return false;
        return false;
      });

      const result = await getEntityTypesForUser(mockUser);

      expect(result).toContain('tenant');
      expect(result).toContain('ticket');
      expect(result).toContain('contract');
      expect(result).not.toContain('client');
    });

    it('should return only tenant if user has no other permissions', async () => {
      vi.mocked(hasPermission).mockResolvedValue(false);

      const result = await getEntityTypesForUser(mockUser);

      expect(result).toEqual(['tenant']);
    });
  });
});
