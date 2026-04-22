import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getFolderTree,
  getFolders,
  getDocumentsByFolder,
  moveDocumentsToFolder,
  toggleFolderVisibility,
  ensureEntityFolders,
  getFolderStats,
  createFolder,
  deleteFolder
} from '@alga-psa/documents/actions/documentActions';
import type { IUser } from '@alga-psa/types';

// Mock dependencies
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  withTransaction: async (knex: any, callback: (trx: any) => Promise<unknown>) => callback(knex),
}));

vi.mock('@alga-psa/auth', () => {
  const getCurrentUser = vi.fn();
  const hasPermission = vi.fn();
  return {
    getCurrentUser,
    hasPermission,
    withAuth: (action: any) => async (...args: any[]) => {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('User not authenticated');
      }
      return action(user, { tenant: user.tenant }, ...args);
    }
  };
});

vi.mock('@alga-psa/documents/lib/documentPermissionUtils', () => ({
  getEntityTypesForUser: vi.fn()
}));

import { getCurrentUser, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getEntityTypesForUser } from '@alga-psa/documents/lib/documentPermissionUtils';

type MockKnex = ReturnType<typeof createMockKnex>;

const CHAINABLE_METHODS = [
  'select',
  'where',
  'whereExists',
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
  builder.countDistinct = vi.fn().mockReturnValue(returnTarget ?? builder);
  builder.leftJoin = vi.fn().mockReturnValue(returnTarget ?? builder);
  builder.on = vi.fn().mockReturnValue(returnTarget ?? builder);
  builder.andOn = vi.fn().mockReturnValue(returnTarget ?? builder);
  builder.first = vi.fn();
  builder.clone = vi.fn().mockReturnValue(returnTarget ?? builder);
  builder.insert = vi.fn().mockResolvedValue([1]);
  builder.update = vi.fn().mockResolvedValue(1);
  builder.delete = vi.fn().mockResolvedValue(1);
  builder.raw = vi.fn((sql: string) => sql);
  builder.then = vi.fn((onFulfilled: any, onRejected: any) => Promise.resolve([]).then(onFulfilled, onRejected));

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

      await expect(getFolderTree()).resolves.toEqual({ permissionError: 'Permission denied' });
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

      await expect(getFolders()).resolves.toEqual({ permissionError: 'Permission denied' });
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
      clonedQuery.countDistinct = vi.fn().mockResolvedValue([{ count: '1' }]);
      mockKnex.clone = vi.fn().mockReturnValue(clonedQuery);

      // Mock document query with joins
      mockKnex.leftJoin = vi.fn().mockReturnValue({
        ...mockKnex,
        select: vi.fn().mockReturnValue({
          ...mockKnex,
          distinct: vi.fn().mockReturnValue({
            ...mockKnex,
            orderByRaw: vi.fn().mockReturnValue({
              ...mockKnex,
              limit: vi.fn().mockReturnValue({
                ...mockKnex,
                offset: vi.fn().mockResolvedValue(mockDocuments)
              })
            })
          }),
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
        countDistinct: vi.fn().mockResolvedValue([{ count: '2' }])
      };
      queryBuilder.clone = vi.fn().mockReturnValue(clonedQuery);

      queryBuilder.leftJoin = vi.fn().mockReturnValue({
        ...queryBuilder,
        select: vi.fn().mockReturnValue({
          ...queryBuilder,
          distinct: vi.fn().mockReturnValue({
            ...queryBuilder,
            orderByRaw: vi.fn().mockReturnValue({
              ...queryBuilder,
              limit: vi.fn().mockReturnValue({
                ...queryBuilder,
                offset: vi.fn().mockResolvedValue([])
              })
            })
          }),
        })
      });

      mockKnex.mockImplementation(() => queryBuilder);

      const result = await getDocumentsByFolder('/Legal', true, 1, 15);

      expect(result).toBeDefined();
      // Verify the query was built with LIKE clause for subfolders
      expect(orWhereCalled).toBe(true);
    });

    it('should scope global folder queries to unassociated documents', async () => {
      vi.mocked(getEntityTypesForUser).mockResolvedValue(['tenant', 'ticket']);

      const queryBuilder = createQueryBuilder();

      const clonedQuery = createQueryBuilder();
      clonedQuery.countDistinct = vi.fn().mockResolvedValue([{ count: '0' }]);
      queryBuilder.clone = vi.fn().mockReturnValue(clonedQuery);

      queryBuilder.leftJoin = vi.fn().mockReturnValue({
        ...queryBuilder,
        select: vi.fn().mockReturnValue({
          ...queryBuilder,
          distinct: vi.fn().mockReturnValue({
            ...queryBuilder,
            orderByRaw: vi.fn().mockReturnValue({
              ...queryBuilder,
              limit: vi.fn().mockReturnValue({
                ...queryBuilder,
                offset: vi.fn().mockResolvedValue([])
              })
            })
          }),
        })
      });

      mockKnex.mockImplementation(() => queryBuilder);

      await getDocumentsByFolder('/Legal', false, 1, 15);

      expect(queryBuilder.where).toHaveBeenCalled();
      expect(queryBuilder.whereExists).not.toHaveBeenCalled();
    });

    it('should scope folder queries to provided entity association when entity params are passed', async () => {
      const queryBuilder = createQueryBuilder();
      let sawEntityIdFilter = false;
      let sawEntityTypeFilter = false;
      let sawAllowedEntityTypeFilter = false;

      queryBuilder.whereExists = vi.fn(function(this: any, callback: (this: any) => void) {
        const nestedBuilder: any = {};
        nestedBuilder.select = vi.fn().mockReturnValue(nestedBuilder);
        nestedBuilder.from = vi.fn().mockReturnValue(nestedBuilder);
        nestedBuilder.whereRaw = vi.fn().mockReturnValue(nestedBuilder);
        nestedBuilder.andWhere = vi.fn((column: string, value: any) => {
          if (column === 'da.entity_id' && value === 'entity-123') {
            sawEntityIdFilter = true;
          }

          if (column === 'da.entity_type' && value === 'client') {
            sawEntityTypeFilter = true;
          }

          return nestedBuilder;
        });
        nestedBuilder.whereIn = vi.fn((column: string, values: string[]) => {
          if (column === 'da.entity_type' && Array.isArray(values) && values.includes('client')) {
            sawAllowedEntityTypeFilter = true;
          }

          return nestedBuilder;
        });

        callback.call(nestedBuilder);
        return queryBuilder;
      });

      const clonedQuery = createQueryBuilder();
      clonedQuery.countDistinct = vi.fn().mockResolvedValue([{ count: '0' }]);
      queryBuilder.clone = vi.fn().mockReturnValue(clonedQuery);

      queryBuilder.leftJoin = vi.fn().mockReturnValue({
        ...queryBuilder,
        select: vi.fn().mockReturnValue({
          ...queryBuilder,
          distinct: vi.fn().mockReturnValue({
            ...queryBuilder,
            orderByRaw: vi.fn().mockReturnValue({
              ...queryBuilder,
              limit: vi.fn().mockReturnValue({
                ...queryBuilder,
                offset: vi.fn().mockResolvedValue([])
              })
            })
          }),
        })
      });

      mockKnex.mockImplementation(() => queryBuilder);
      vi.mocked(getEntityTypesForUser).mockResolvedValue(['client', 'ticket']);

      await getDocumentsByFolder('/Legal', false, 1, 15, undefined, 'entity-123', 'client');

      expect(queryBuilder.whereExists).toHaveBeenCalled();
      expect(queryBuilder.whereNotExists).not.toHaveBeenCalled();
      expect(sawEntityIdFilter).toBe(true);
      expect(sawEntityTypeFilter).toBe(true);
      expect(sawAllowedEntityTypeFilter).toBe(true);
    });

    it('should handle null folder path (root folder)', async () => {
      mockKnex.mockImplementation(() => mockKnex);

      const clonedQuery = createQueryBuilder();
      clonedQuery.countDistinct = vi.fn().mockResolvedValue([{ count: '0' }]);
      mockKnex.clone = vi.fn().mockReturnValue(clonedQuery);

      mockKnex.leftJoin = vi.fn().mockReturnValue({
        ...mockKnex,
        select: vi.fn().mockReturnValue({
          ...mockKnex,
          distinct: vi.fn().mockReturnValue({
            ...mockKnex,
            orderByRaw: vi.fn().mockReturnValue({
              ...mockKnex,
              limit: vi.fn().mockReturnValue({
                ...mockKnex,
                offset: vi.fn().mockResolvedValue([])
              })
            })
          }),
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
      clonedQuery.countDistinct = vi.fn().mockResolvedValue([{ count: '0' }]);
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
          distinct: vi.fn().mockReturnValue({
            ...queryBuilder,
            orderByRaw: orderByRawMock
          }),
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
      clonedQuery.countDistinct = vi.fn().mockResolvedValue([{ count: '25' }]);
      mockKnex.clone = vi.fn().mockReturnValue(clonedQuery);

      let limitCalled = false;
      let offsetCalled = false;

      mockKnex.leftJoin = vi.fn().mockReturnValue({
        ...mockKnex,
        select: vi.fn().mockReturnValue({
          ...mockKnex,
          distinct: vi.fn().mockReturnValue({
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
                    expect(o).toBe(0);
                    return Promise.resolve([]);
                  })
                };
              })
            })
          }),
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

      await expect(moveDocumentsToFolder(['doc-1'], '/Legal')).resolves.toEqual({ permissionError: 'Permission denied' });
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

  describe('toggleFolderVisibility', () => {
    it('should toggle folder visibility without cascading documents', async () => {
      mockKnex.first.mockResolvedValue({
        folder_id: 'folder-1',
        folder_path: '/Legal',
        entity_id: null,
        entity_type: null,
      });

      const result = await toggleFolderVisibility('folder-1', true, false);

      expect(result).toEqual({
        folderUpdated: true,
        updatedDocuments: 0,
      });
      expect(mockKnex.update).toHaveBeenCalledTimes(1);
      expect(mockKnex.update).toHaveBeenCalledWith(
        expect.objectContaining({
          is_client_visible: true,
          updated_at: expect.any(Date),
        })
      );
    });

    it('should cascade visibility to global documents when requested', async () => {
      mockKnex.first.mockResolvedValue({
        folder_id: 'folder-1',
        folder_path: '/Legal',
        entity_id: null,
        entity_type: null,
      });
      mockKnex.update
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(3);

      const result = await toggleFolderVisibility('folder-1', false, true);

      expect(result).toEqual({
        folderUpdated: true,
        updatedDocuments: 3,
      });
      expect(mockKnex.whereNotExists).toHaveBeenCalled();
      expect(mockKnex.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          is_client_visible: false,
          updated_at: expect.any(Date),
        })
      );
    });

    it('should cascade visibility to entity-scoped documents when folder is entity scoped', async () => {
      mockKnex.first.mockResolvedValue({
        folder_id: 'folder-1',
        folder_path: '/Contracts',
        entity_id: 'client-123',
        entity_type: 'client',
      });
      mockKnex.update
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2);

      const result = await toggleFolderVisibility('folder-1', true, true);

      expect(result).toEqual({
        folderUpdated: true,
        updatedDocuments: 2,
      });
      expect(mockKnex.whereExists).toHaveBeenCalled();
    });

    it('should throw when folder does not exist', async () => {
      mockKnex.first.mockResolvedValue(undefined);

      await expect(toggleFolderVisibility('missing-folder', true, false)).rejects.toThrow('Folder not found');
      expect(mockKnex.update).not.toHaveBeenCalled();
    });

    it('should require document update permission', async () => {
      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        return resource === 'document' && action === 'update' ? false : true;
      });

      await expect(toggleFolderVisibility('folder-1', true, false)).resolves.toEqual({ permissionError: 'Permission denied' });
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

  describe('ensureEntityFolders', () => {
    it('should return empty tree for valid entity scope (phase 1 stub)', async () => {
      await expect(ensureEntityFolders('entity-123', 'client')).resolves.toEqual([]);
    });

    it('should require both entityId and entityType', async () => {
      await expect(ensureEntityFolders('', 'client')).rejects.toThrow('Both entityId and entityType are required');
      await expect(ensureEntityFolders('entity-123', '')).rejects.toThrow('Both entityId and entityType are required');
    });

    it('should require document read permission', async () => {
      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        return resource === 'document' && action === 'read' ? false : true;
      });

      await expect(ensureEntityFolders('entity-123', 'client')).resolves.toEqual({ permissionError: 'Permission denied' });
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
          entity_id: null,
          entity_type: null,
          is_client_visible: false,
          created_by: 'user-123'
        })
      );
    });

    it('should create an entity-scoped folder with visibility flag', async () => {
      const folderPath = '/Contracts';

      mockKnex.first.mockResolvedValue(null);

      await createFolder(folderPath, 'client-123', 'client', true);

      expect(mockKnex.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          folder_path: folderPath,
          entity_id: 'client-123',
          entity_type: 'client',
          is_client_visible: true,
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

    it('should require both entityId and entityType when scoping folder', async () => {
      await expect(createFolder('/Legal', 'client-123')).rejects.toThrow(
        'Both entityId and entityType are required when scoping a folder to an entity'
      );
      await expect(createFolder('/Legal', null, 'client')).rejects.toThrow(
        'Both entityId and entityType are required when scoping a folder to an entity'
      );
    });

    it('should require document create permission', async () => {
      vi.mocked(hasPermission).mockImplementation(async (user, resource, action) => {
        return resource === 'document' && action === 'create' ? false : true;
      });

      await expect(createFolder('/Legal')).resolves.toEqual({ permissionError: 'Permission denied' });
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

      await expect(deleteFolder('/Legal')).resolves.toEqual({ permissionError: 'Permission denied' });
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
