import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getFolderTree,
  getFolders,
  getDocumentsByFolder,
  moveDocumentsToFolder,
  getFolderStats,
  createFolder,
  deleteFolder
} from '../../lib/actions/document-actions/documentActions';
import { IUser } from '@/interfaces/auth.interfaces';

// Mock dependencies
vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn()
}));

vi.mock('../../lib/auth/rbac', () => ({
  hasPermission: vi.fn()
}));

vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn()
}));

vi.mock('../../lib/utils/documentPermissionUtils', () => ({
  getEntityTypesForUser: vi.fn()
}));

import { getCurrentUser } from '@alga-psa/users/actions';
import { hasPermission } from '../../lib/auth/rbac';
import { createTenantKnex } from '../../lib/db';
import { getEntityTypesForUser } from '../../lib/utils/documentPermissionUtils';

type MockKnex = ReturnType<typeof createMockKnex>;

const CHAINABLE_METHODS = [
  'select',
  'where',
  'whereNull',
  'whereNotNull',
  'andWhere',
  'orWhere',
  'orWhereExists',
  'whereNotExists',
  'whereIn',
  'whereRaw',
  'groupBy',
  'orderBy',
  'orderByRaw',
  'limit',
  'offset',
  'sum'
] as const;

function createQueryBuilder(returnTarget?: any) {
  const builder: any = {};

  for (const method of CHAINABLE_METHODS) {
    builder[method] = vi.fn().mockReturnValue(returnTarget ?? builder);
  }

  builder.count = vi.fn().mockReturnValue(returnTarget ?? builder);
  builder.leftJoin = vi.fn().mockReturnValue(returnTarget ?? builder);
  builder.on = vi.fn().mockReturnValue(returnTarget ?? builder);
  builder.andOn = vi.fn().mockReturnValue(returnTarget ?? builder);
  builder.first = vi.fn();
  builder.clone = vi.fn().mockReturnValue(returnTarget ?? builder);
  builder.insert = vi.fn().mockResolvedValue([1]);
  builder.update = vi.fn().mockResolvedValue(1);
  builder.delete = vi.fn().mockResolvedValue(1);
  builder.raw = vi.fn((sql: string) => sql);

  return builder;
}

function createMockKnex(): MockKnex {
  const knexFn: any = vi.fn(() => knexFn);
  Object.assign(knexFn, createQueryBuilder(knexFn));
  knexFn.clone = vi.fn().mockReturnValue(createQueryBuilder(knexFn));
  knexFn.raw = vi.fn((sql: string) => sql);
  return knexFn;
}

function createSubQueryBuilder() {
  return createQueryBuilder();
}

describe('Document Folder Operations', () => {
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

  let mockKnex: MockKnex;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(getEntityTypesForUser).mockResolvedValue(['tenant', 'ticket', 'contract']);

    // Setup mock knex with chaining - knex must be a function that returns itself
    mockKnex = createMockKnex();

    vi.mocked(createTenantKnex).mockResolvedValue({
      knex: mockKnex,
      tenant: 'tenant-123'
    });
  });

  describe('getFolderTree', () => {
    it('should throw error if user is not authenticated', async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(null);

      await expect(getFolderTree()).rejects.toThrow('User not authenticated');
    });

    it('should throw error if user lacks document read permission', async () => {
      vi.mocked(hasPermission).mockResolvedValue(false);

      await expect(getFolderTree()).rejects.toThrow('Permission denied');
    });

    it('should build folder tree from explicit and implicit folders', async () => {
      // Mock explicit folders
      const explicitFolders = [
        { folder_path: '/Legal' },
        { folder_path: '/Legal/Contracts' }
      ];

      // Mock implicit folders (from documents)
      const implicitFolders = [
        { folder_path: '/Legal/Contracts/2025' },
        { folder_path: '/HR' }
      ];

      mockKnex.mockImplementation((tableName: string) => {
        const queryBuilder = createQueryBuilder();

        if (tableName === 'document_folders') {
          queryBuilder.orderBy.mockResolvedValue(explicitFolders);
        } else if (tableName === 'documents') {
          queryBuilder.groupBy.mockResolvedValue(implicitFolders);
        } else if (tableName === 'documents as d') {
          queryBuilder.where = vi.fn(function(this: any, ...args: any[]) {
            if (typeof args[0] === 'function') {
              const nestedBuilder = createSubQueryBuilder();
              args[0].call(nestedBuilder);
              return queryBuilder;
            }
            return queryBuilder;
          });
          queryBuilder.groupBy.mockReturnValue({
            select: vi.fn().mockReturnValue({
              count: vi.fn().mockResolvedValue([])
            })
          });
        }

        return queryBuilder;
      });

      const tree = await getFolderTree();

      expect(tree).toBeDefined();
      expect(Array.isArray(tree)).toBe(true);
    });

    it('should merge and deduplicate explicit and implicit folder paths', async () => {
      const folders = [
        { folder_path: '/Legal' },
        { folder_path: '/Legal' }, // Duplicate
        { folder_path: '/HR' }
      ];

      mockKnex.mockImplementation((tableName: string) => {
        const queryBuilder = createQueryBuilder();

        if (tableName === 'documents') {
          queryBuilder.groupBy.mockResolvedValue([]);
        } else if (tableName === 'documents as d') {
          queryBuilder.where = vi.fn(function(this: any, ...args: any[]) {
            if (typeof args[0] === 'function') {
              const nestedBuilder = createSubQueryBuilder();
              args[0].call(nestedBuilder);
              return queryBuilder;
            }
            return queryBuilder;
          });
          queryBuilder.groupBy.mockReturnValue({
            select: vi.fn().mockReturnValue({
              count: vi.fn().mockResolvedValue([])
            })
          });
        } else {
          queryBuilder.orderBy.mockResolvedValue(folders);
        }

        return queryBuilder;
      });

      const tree = await getFolderTree();

      expect(tree).toBeDefined();
    });
  });

  describe('getFolders', () => {
    it('should return sorted list of all folder paths', async () => {
      const explicitFolders = [
        { folder_path: '/Legal/Contracts' },
        { folder_path: '/Legal' }
      ];

      const implicitFolders = [
        { folder_path: '/HR' }
      ];

      mockKnex.mockImplementation((tableName: string) => {
        const queryBuilder = createQueryBuilder();

        if (tableName === 'document_folders') {
          queryBuilder.orderBy.mockResolvedValue(explicitFolders);
        } else {
          queryBuilder.groupBy.mockResolvedValue(implicitFolders);
        }

        return queryBuilder;
      });

      const folders = await getFolders();

      expect(Array.isArray(folders)).toBe(true);
      expect(folders.length).toBeGreaterThan(0);
    });

    it('should require document read permission', async () => {
      vi.mocked(hasPermission).mockResolvedValue(false);

      await expect(getFolders()).rejects.toThrow('Permission denied');
    });
  });

  describe('getDocumentsByFolder', () => {
    it('should filter documents by folder path', async () => {
      const mockDocuments = [
        {
          document_id: 'doc-1',
          tenant: 'tenant-123',
          document_name: 'Contract.pdf',
          folder_path: '/Legal/Contracts'
        }
      ];

      // Setup mock for the main query
      mockKnex.mockImplementation(() => mockKnex);

      // Mock count query
      const clonedQuery = createQueryBuilder();
      clonedQuery.count = vi.fn().mockResolvedValue([{ count: '1' }]);
      mockKnex.clone = vi.fn().mockReturnValue(clonedQuery);

      // Mock document query with joins
      mockKnex.leftJoin = vi.fn().mockReturnValue({
        ...mockKnex,
        select: vi.fn().mockReturnValue({
          ...mockKnex,
          orderByRaw: vi.fn().mockReturnValue({
            ...mockKnex,
            limit: vi.fn().mockReturnValue({
              ...mockKnex,
              offset: vi.fn().mockResolvedValue(mockDocuments)
            })
          })
        })
      });

      const result = await getDocumentsByFolder('/Legal/Contracts', false, 1, 15);

      expect(result).toBeDefined();
      expect(result.documents).toBeDefined();
      expect(result.total).toBeDefined();
    });

    it('should include subfolders when includeSubfolders is true', async () => {
      let orWhereCalled = false;
      const queryBuilder = createQueryBuilder();

      queryBuilder.where = vi.fn(function(this: any, ...args: any[]) {
        if (typeof args[0] === 'function') {
          const nestedBuilder = createSubQueryBuilder();
          nestedBuilder.orWhere = vi.fn(() => {
            orWhereCalled = true;
            return nestedBuilder;
          });
          args[0].call(nestedBuilder);
          return queryBuilder;
        }
        return queryBuilder;
      });

      const clonedQuery = {
        ...queryBuilder,
        count: vi.fn().mockResolvedValue([{ count: '2' }])
      };
      queryBuilder.clone = vi.fn().mockReturnValue(clonedQuery);

      queryBuilder.leftJoin = vi.fn().mockReturnValue({
        ...queryBuilder,
        select: vi.fn().mockReturnValue({
          ...queryBuilder,
          orderByRaw: vi.fn().mockReturnValue({
            ...queryBuilder,
            limit: vi.fn().mockReturnValue({
              ...queryBuilder,
              offset: vi.fn().mockResolvedValue([])
            })
          })
        })
      });

      mockKnex.mockImplementation(() => queryBuilder);

      const result = await getDocumentsByFolder('/Legal', true, 1, 15);

      expect(result).toBeDefined();
      // Verify the query was built with LIKE clause for subfolders
      expect(orWhereCalled).toBe(true);
    });

    it('should filter documents at database level based on user permissions', async () => {
      vi.mocked(getEntityTypesForUser).mockResolvedValue(['tenant', 'ticket']);

      let whereNotExistsCalled = false;
      let orWhereExistsCalled = false;

      const queryBuilder = createQueryBuilder();
      queryBuilder.where = vi.fn(function(this: any, ...args: any[]) {
        if (typeof args[0] === 'function') {
          const nestedBuilder = {
            whereNotExists: vi.fn(() => {
              whereNotExistsCalled = true;
              return nestedBuilder;
            }),
            orWhereExists: vi.fn(() => {
              orWhereExistsCalled = true;
              return nestedBuilder;
            })
          };
          args[0].call(nestedBuilder);
          return queryBuilder;
        }
        return queryBuilder;
      });

      const clonedQuery = createQueryBuilder();
      clonedQuery.count = vi.fn().mockResolvedValue([{ count: '0' }]);
      queryBuilder.clone = vi.fn().mockReturnValue(clonedQuery);

      queryBuilder.leftJoin = vi.fn().mockReturnValue({
        ...queryBuilder,
        select: vi.fn().mockReturnValue({
          ...queryBuilder,
          orderByRaw: vi.fn().mockReturnValue({
            ...queryBuilder,
            limit: vi.fn().mockReturnValue({
              ...queryBuilder,
              offset: vi.fn().mockResolvedValue([])
            })
          })
        })
      });

      mockKnex.mockImplementation(() => queryBuilder);

      await getDocumentsByFolder('/Legal', false, 1, 15);

      // Verify permission filtering was applied
      expect(whereNotExistsCalled).toBe(true);
      expect(orWhereExistsCalled).toBe(true);
    });

    it('should handle null folder path (root folder)', async () => {
      mockKnex.mockImplementation(() => mockKnex);

      const clonedQuery = createQueryBuilder();
      clonedQuery.count = vi.fn().mockResolvedValue([{ count: '0' }]);
      mockKnex.clone = vi.fn().mockReturnValue(clonedQuery);

      mockKnex.leftJoin = vi.fn().mockReturnValue({
        ...mockKnex,
        select: vi.fn().mockReturnValue({
          ...mockKnex,
          orderByRaw: vi.fn().mockReturnValue({
            ...mockKnex,
            limit: vi.fn().mockReturnValue({
              ...mockKnex,
              offset: vi.fn().mockResolvedValue([])
            })
          })
        })
      });

      await getDocumentsByFolder(null, false, 1, 15);

      // Should query for documents with null folder_path
      // This is verified by the mock being called
      expect(mockKnex.where).toHaveBeenCalled();
    });

    it('should support sorting by document_name', async () => {
      const queryBuilder = createQueryBuilder();

      const clonedQuery = createQueryBuilder();
      clonedQuery.count = vi.fn().mockResolvedValue([{ count: '0' }]);
      queryBuilder.clone = vi.fn().mockReturnValue(clonedQuery);

      const orderByRawMock = vi.fn().mockReturnValue({
        ...queryBuilder,
        limit: vi.fn().mockReturnValue({
          ...queryBuilder,
          offset: vi.fn().mockResolvedValue([])
        })
      });

      queryBuilder.leftJoin.mockReturnValue({
        ...queryBuilder,
        select: vi.fn().mockReturnValue({
          ...queryBuilder,
          orderByRaw: orderByRawMock
        })
      });

      mockKnex.mockImplementation(() => queryBuilder);

      await getDocumentsByFolder('/Legal', false, 1, 15, {
        sortBy: 'document_name',
        sortOrder: 'asc'
      });

      // Verify natural sorting was applied
      expect(orderByRawMock).toHaveBeenCalled();
    });

    it('should support pagination', async () => {
      const page = 2;
      const limit = 10;
      const expectedOffset = (page - 1) * limit;

      mockKnex.mockImplementation(() => mockKnex);

      const clonedQuery = createQueryBuilder();
      clonedQuery.count = vi.fn().mockResolvedValue([{ count: '25' }]);
      mockKnex.clone = vi.fn().mockReturnValue(clonedQuery);

      let limitCalled = false;
      let offsetCalled = false;

      mockKnex.leftJoin = vi.fn().mockReturnValue({
        ...mockKnex,
        select: vi.fn().mockReturnValue({
          ...mockKnex,
          orderByRaw: vi.fn().mockReturnValue({
            ...mockKnex,
            limit: vi.fn((l) => {
              limitCalled = true;
              expect(l).toBe(limit);
              return {
                ...mockKnex,
                offset: vi.fn((o) => {
                  offsetCalled = true;
                  expect(o).toBe(expectedOffset);
                  return Promise.resolve([]);
                })
              };
            })
          })
        })
      });

      await getDocumentsByFolder('/Legal', false, page, limit);

      expect(limitCalled).toBe(true);
      expect(offsetCalled).toBe(true);
    });
  });

  describe('moveDocumentsToFolder', () => {
    it('should update folder_path for specified documents', async () => {
      const documentIds = ['doc-1', 'doc-2', 'doc-3'];
      const newFolderPath = '/Legal/Contracts';

      await moveDocumentsToFolder(documentIds, newFolderPath);

      expect(mockKnex.whereIn).toHaveBeenCalledWith('document_id', documentIds);
      expect(mockKnex.update).toHaveBeenCalledWith(
        expect.objectContaining({
          folder_path: newFolderPath
        })
      );
    });

    it('should support moving to root (null folder_path)', async () => {
      const documentIds = ['doc-1'];

      await moveDocumentsToFolder(documentIds, null);

      expect(mockKnex.update).toHaveBeenCalledWith(
        expect.objectContaining({
          folder_path: null
        })
      );
    });

    it('should require document update permission', async () => {
      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        return resource === 'document' && action === 'update' ? false : true;
      });

      await expect(moveDocumentsToFolder(['doc-1'], '/Legal')).rejects.toThrow('Permission denied');
    });

    it('should update updated_at timestamp', async () => {
      await moveDocumentsToFolder(['doc-1'], '/Legal');

      expect(mockKnex.update).toHaveBeenCalledWith(
        expect.objectContaining({
          updated_at: expect.any(Date)
        })
      );
    });
  });

  describe('getFolderStats', () => {
    it('should return document count and total size for folder', async () => {
      const mockStats = {
        count: '5',
        size: '1024000'
      };

      mockKnex.first.mockResolvedValue(mockStats);

      const stats = await getFolderStats('/Legal/Contracts');

      expect(stats).toEqual({
        path: '/Legal/Contracts',
        documentCount: 5,
        totalSize: 1024000
      });
    });

    it('should include subfolders in statistics', async () => {
      const mockStats = {
        count: '10',
        size: '2048000'
      };

      let orWhereCalled = false;
      const queryBuilder = createQueryBuilder();
      queryBuilder.where = vi.fn(function(this: any, ...args: any[]) {
        if (typeof args[0] === 'function') {
          const nestedBuilder = createSubQueryBuilder();
          nestedBuilder.orWhere = vi.fn(() => {
            orWhereCalled = true;
            return nestedBuilder;
          });
          args[0].call(nestedBuilder);
          return queryBuilder;
        }
        return queryBuilder;
      });
      queryBuilder.first = vi.fn().mockResolvedValue(mockStats);

      mockKnex.mockImplementation(() => queryBuilder);

      await getFolderStats('/Legal');

      // Verify query includes subfolder pattern
      expect(orWhereCalled).toBe(true);
    });

    it('should handle empty folders', async () => {
      mockKnex.first.mockResolvedValue({ count: null, size: null });

      const stats = await getFolderStats('/Empty');

      expect(stats.documentCount).toBe(0);
      expect(stats.totalSize).toBe(0);
    });
  });

  describe('createFolder', () => {
    it('should create a new folder', async () => {
      const folderPath = '/Legal/Contracts';

      // Mock: folder doesn't exist
      mockKnex.first.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      await createFolder(folderPath);

      expect(mockKnex.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant: 'tenant-123',
          folder_path: folderPath,
          folder_name: 'Contracts',
          created_by: 'user-123'
        })
      );
    });

    it('should extract folder name from path', async () => {
      const folderPath = '/Legal/Contracts/2025';

      mockKnex.first.mockResolvedValue(null);

      await createFolder(folderPath);

      expect(mockKnex.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          folder_name: '2025'
        })
      );
    });

    it('should link to parent folder if exists', async () => {
      const folderPath = '/Legal/Contracts/2025';
      const mockParentFolder = {
        folder_id: 'parent-folder-id',
        folder_path: '/Legal/Contracts'
      };

      // First call: find parent folder, Second call: check if folder exists
      mockKnex.first
        .mockResolvedValueOnce(mockParentFolder)
        .mockResolvedValueOnce(null);

      await createFolder(folderPath);

      expect(mockKnex.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          parent_folder_id: 'parent-folder-id'
        })
      );
    });

    it('should not error if folder already exists', async () => {
      const existingFolder = {
        folder_id: 'existing-id',
        folder_path: '/Legal'
      };

      mockKnex.first.mockResolvedValue(existingFolder);

      await expect(createFolder('/Legal')).resolves.not.toThrow();
      expect(mockKnex.insert).not.toHaveBeenCalled();
    });

    it('should reject invalid folder paths', async () => {
      await expect(createFolder('InvalidPath')).rejects.toThrow('Folder path must start with /');
      await expect(createFolder('/')).rejects.toThrow('Invalid folder path');
    });

    it('should require document create permission', async () => {
      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        return resource === 'document' && action === 'create' ? false : true;
      });

      await expect(createFolder('/Legal')).rejects.toThrow('Permission denied');
    });
  });

  describe('deleteFolder', () => {
    it('should delete an empty folder', async () => {
      // Mock: no documents, no subfolders
      mockKnex.first
        .mockResolvedValueOnce({ count: '0' })  // Document count
        .mockResolvedValueOnce({ count: '0' }); // Subfolder count

      await deleteFolder('/Legal/Old');

      expect(mockKnex.delete).toHaveBeenCalled();
    });

    it('should reject deletion if folder contains documents', async () => {
      mockKnex.first.mockResolvedValueOnce({ count: '5' });

      await expect(deleteFolder('/Legal')).rejects.toThrow('Cannot delete folder: contains documents');
      expect(mockKnex.delete).not.toHaveBeenCalled();
    });

    it('should reject deletion if folder contains subfolders', async () => {
      mockKnex.first
        .mockResolvedValueOnce({ count: '0' })  // No documents
        .mockResolvedValueOnce({ count: '2' }); // Has subfolders

      await expect(deleteFolder('/Legal')).rejects.toThrow('Cannot delete folder: contains subfolders');
      expect(mockKnex.delete).not.toHaveBeenCalled();
    });

    it('should require document delete permission', async () => {
      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        return resource === 'document' && action === 'delete' ? false : true;
      });

      await expect(deleteFolder('/Legal')).rejects.toThrow('Permission denied');
    });

    it('should filter by tenant when checking for documents and subfolders', async () => {
      mockKnex.first
        .mockResolvedValueOnce({ count: '0' })
        .mockResolvedValueOnce({ count: '0' });

      await deleteFolder('/Legal/Old');

      // Verify tenant was included in queries
      expect(mockKnex.where).toHaveBeenCalledWith('tenant', 'tenant-123');
    });
  });
});
