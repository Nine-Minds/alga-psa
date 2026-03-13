import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { Knex } from 'knex';
import type { IDocument } from '@alga-psa/types';

vi.mock('@alga-psa/storage/StorageService', () => {
  return {
    StorageService: {
      validateFileUpload: vi.fn(),
      uploadFile: vi.fn(),
    },
  };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  runWithTenant: vi.fn((_tenant: string, callback: () => unknown) => callback()),
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
    },
  };
});

vi.mock('@alga-psa/documents/models/documentAssociation', () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(),
}));

vi.mock('@alga-psa/documents/lib/documentPreviewGenerator', () => ({
  generateDocumentPreviews: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

import { StorageService } from '@alga-psa/storage/StorageService';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { getCurrentUser, hasPermission } from '@alga-psa/auth';
import DocumentAssociation from '@alga-psa/documents/models/documentAssociation';
import { v4 as uuidv4 } from 'uuid';
import { generateDocumentPreviews } from '@alga-psa/documents/lib/documentPreviewGenerator';
import * as documentActions from '@alga-psa/documents/actions/documentActions';

const cast = vi.mocked;
const getDocumentTypeIdSpy = vi.spyOn(documentActions, 'getDocumentTypeId');

describe('uploadDocument', () => {
  const validateFileUploadMock = cast(StorageService.validateFileUpload);
  const uploadFileMock = cast(StorageService.uploadFile);
  const createTenantKnexMock = cast(createTenantKnex);
  const withTransactionMock = cast(withTransaction);
  const getCurrentUserMock = cast(getCurrentUser);
  const hasPermissionMock = cast(hasPermission);
  const documentAssociationCreateMock = cast(DocumentAssociation.create);
  const uuidMock = cast(uuidv4);
  const generateDocumentPreviewsMock = cast(generateDocumentPreviews);

  let knexStub: ReturnType<typeof createKnexStub>;

  beforeEach(() => {
    knexStub = createKnexStub();

    uuidMock.mockReturnValue('doc-123');
    createTenantKnexMock.mockResolvedValue({ tenant: 'tenant-123', knex: knexStub.fn });
    withTransactionMock.mockImplementation(async (_knex: Knex, callback) => callback(knexStub.trx));
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-123' });
    hasPermissionMock.mockResolvedValue(true);
    documentAssociationCreateMock.mockResolvedValue({ association_id: 'assoc-1' } as any);
    validateFileUploadMock.mockResolvedValue(undefined);
    uploadFileMock.mockResolvedValue({
      file_id: 'file-123',
      storage_path: '/docs/file-123',
    } as any);
    generateDocumentPreviewsMock.mockResolvedValue({
      thumbnail_file_id: 'thumb-123',
      preview_file_id: 'preview-456',
      preview_generated_at: new Date('2024-01-01T00:00:00.000Z'),
    });
    getDocumentTypeIdSpy.mockResolvedValue({
      typeId: 'type-xyz',
      isShared: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    getDocumentTypeIdSpy.mockReset();
  });

  it('persists document metadata, associations, and schedules preview generation', async () => {
    const formData = new FormData();
    const file = new File([Buffer.from('hello world')], 'example.png', { type: 'image/png' });
    formData.set('file', file);

    const result = await documentActions.uploadDocument(formData, {
      userId: 'user-1',
      ticketId: 'ticket-42',
    });

    expect(result.success).toBe(true);

    expect(validateFileUploadMock).toHaveBeenCalledWith('tenant-123', 'image/png', file.size);
    expect(uploadFileMock).toHaveBeenCalledWith(
      'tenant-123',
      expect.any(Buffer),
      'example.png',
      expect.objectContaining({
        mime_type: 'image/png',
        uploaded_by_id: 'user-1',
      }),
    );

    expect(knexStub.inserts).toHaveLength(1);
    const insertedDocument = knexStub.inserts[0] as IDocument;
    expect(insertedDocument.document_id).toEqual(expect.any(String));
    expect(insertedDocument.file_id).toBe('file-123');
    expect(insertedDocument.mime_type).toBe('image/png');

    expect(documentAssociationCreateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        document_id: insertedDocument.document_id,
        entity_id: 'ticket-42',
        entity_type: 'ticket',
      }),
    );

    expect(generateDocumentPreviewsMock).toHaveBeenCalledWith(
      expect.objectContaining({ document_id: insertedDocument.document_id }),
      expect.any(Buffer),
    );

    await flushMicrotasks();

    expect(knexStub.whereArgs).toEqual([{ document_id: insertedDocument.document_id, tenant: 'tenant-123' }]);
    expect(knexStub.updateArgs).toEqual([
      expect.objectContaining({
        thumbnail_file_id: 'thumb-123',
        preview_file_id: 'preview-456',
        preview_generated_at: new Date('2024-01-01T00:00:00.000Z'),
      }),
    ]);
  });

  it('prefers the ticket attachments system folder when it exists', async () => {
    knexStub.folderRows.push(
      {
        tenant: 'tenant-123',
        entity_id: 'ticket-42',
        entity_type: 'ticket',
        folder_path: '/Tickets',
      },
      {
        tenant: 'tenant-123',
        entity_id: 'ticket-42',
        entity_type: 'ticket',
        folder_path: '/Tickets/Attachments',
      },
    );

    const formData = new FormData();
    const file = new File([Buffer.from('hello world')], 'example.png', { type: 'image/png' });
    formData.set('file', file);

    const result = await documentActions.uploadDocument(formData, {
      userId: 'user-1',
      ticketId: 'ticket-42',
    });

    expect(result.success).toBe(true);
    expect((knexStub.inserts[0] as IDocument).folder_path).toBe('/Tickets/Attachments');
  });

  it('initializes ticket default folders and stores uploads in attachments when folders were not created yet', async () => {
    knexStub.defaultFolderRows.push(
      {
        tenant: 'tenant-123',
        entity_type: 'ticket',
        folder_name: 'Tickets',
        folder_path: '/Tickets',
        is_client_visible: false,
        sort_order: 0,
      },
      {
        tenant: 'tenant-123',
        entity_type: 'ticket',
        folder_name: 'Attachments',
        folder_path: '/Tickets/Attachments',
        is_client_visible: false,
        sort_order: 1,
      },
    );

    const formData = new FormData();
    const file = new File([Buffer.from('hello world')], 'example.png', { type: 'image/png' });
    formData.set('file', file);

    const result = await documentActions.uploadDocument(formData, {
      userId: 'user-1',
      ticketId: 'ticket-42',
    });

    expect(result.success).toBe(true);
    expect(knexStub.folderRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_id: 'ticket-42',
          entity_type: 'ticket',
          folder_path: '/Tickets',
        }),
        expect.objectContaining({
          entity_id: 'ticket-42',
          entity_type: 'ticket',
          folder_path: '/Tickets/Attachments',
        }),
      ]),
    );
    expect((knexStub.inserts[0] as IDocument).folder_path).toBe('/Tickets/Attachments');
  });

  it('returns error result when validation fails before upload', async () => {
    validateFileUploadMock.mockRejectedValue(new Error('invalid file'));

    const formData = new FormData();
    const file = new File([Buffer.from('bad')], 'malware.exe', { type: 'application/octet-stream' });
    formData.set('file', file);

    const result = await documentActions.uploadDocument(formData, {
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    expect(result).toHaveProperty('error', 'invalid file');
    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(generateDocumentPreviewsMock).not.toHaveBeenCalled();
  });
});

function createKnexStub() {
  const inserts: any[] = [];
  const updateArgs: any[] = [];
  const whereArgs: any[] = [];
  const folderRows: any[] = [];
  const defaultFolderRows: any[] = [];

  const documentsBuilder = {
    insert: vi.fn(async (record: any) => {
      inserts.push(record);
    }),
    where: vi.fn((conditions: any) => {
      whereArgs.push(conditions);
      return {
        update: vi.fn(async (payload: any) => {
          updateArgs.push(payload);
        }),
      };
    }),
  };

  const documentTypesBuilder = {
    where: vi.fn((_conditions: any) => ({
      first: vi.fn(async () => ({ type_id: 'type-xyz' })),
    })),
  };

  const sharedDocumentTypesBuilder = {
    where: vi.fn((_conditions: any) => ({
      first: vi.fn(async () => null),
    })),
  };

  const defaultBuilder = {
    insert: vi.fn(),
    where: vi.fn(() => ({
      first: vi.fn(async () => null),
      update: vi.fn(async () => undefined),
    })),
  };

  const createDocumentFoldersBuilder = () => {
    const filters: Array<{ column: string; value: any }> = [];
    let orderByColumn: string | null = null;
    let orderByDirection: 'asc' | 'desc' = 'asc';

    const applyFilters = () => {
      const filteredRows = folderRows.filter((row) =>
        filters.every(({ column, value }) => row[column] === value),
      );

      if (!orderByColumn) {
        return filteredRows;
      }

      return [...filteredRows].sort((left, right) => {
        const leftValue = left[orderByColumn];
        const rightValue = right[orderByColumn];
        if (leftValue === rightValue) {
          return 0;
        }

        const comparison = leftValue < rightValue ? -1 : 1;
        return orderByDirection === 'asc' ? comparison : comparison * -1;
      });
    };

    const builder: any = {
      insert: vi.fn(async (records: any | any[]) => {
        const rows = Array.isArray(records) ? records : [records];
        folderRows.push(...rows);
      }),
      where: vi.fn((column: any, value?: any) => {
        if (typeof column === 'object' && column !== null) {
          for (const [key, entryValue] of Object.entries(column)) {
            filters.push({ column: key, value: entryValue });
          }
        } else {
          filters.push({ column, value });
        }
        return builder;
      }),
      andWhere: vi.fn((column: string, value: any) => {
        filters.push({ column, value });
        return builder;
      }),
      orderBy: vi.fn((column: string, direction: 'asc' | 'desc' = 'asc') => {
        orderByColumn = column;
        orderByDirection = direction;
        return builder;
      }),
      select: vi.fn(() => builder),
      first: vi.fn(async () => applyFilters()[0] ?? null),
      then: (resolve: (value: any[]) => unknown) => Promise.resolve(resolve(applyFilters())),
    };

    return builder;
  };

  const createDefaultDocumentFoldersBuilder = () => {
    const filters: Array<{ column: string; value: any }> = [];
    const orderByColumns: Array<{ column: string; direction: 'asc' | 'desc' }> = [];

    const applyFilters = () => {
      const filteredRows = defaultFolderRows.filter((row) =>
        filters.every(({ column, value }) => row[column] === value),
      );

      return [...filteredRows].sort((left, right) => {
        for (const { column, direction } of orderByColumns) {
          const leftValue = left[column];
          const rightValue = right[column];
          if (leftValue === rightValue) {
            continue;
          }

          const comparison = leftValue < rightValue ? -1 : 1;
          return direction === 'asc' ? comparison : comparison * -1;
        }

        return 0;
      });
    };

    const builder: any = {
      where: vi.fn((column: any, value?: any) => {
        if (typeof column === 'object' && column !== null) {
          for (const [key, entryValue] of Object.entries(column)) {
            filters.push({ column: key, value: entryValue });
          }
        } else {
          filters.push({ column, value });
        }
        return builder;
      }),
      andWhere: vi.fn((column: string, value: any) => {
        filters.push({ column, value });
        return builder;
      }),
      orderBy: vi.fn((column: string, direction: 'asc' | 'desc' = 'asc') => {
        orderByColumns.push({ column, direction });
        return builder;
      }),
      select: vi.fn(() => builder),
      first: vi.fn(async () => applyFilters()[0] ?? null),
      insert: vi.fn(async (records: any | any[]) => {
        const rows = Array.isArray(records) ? records : [records];
        defaultFolderRows.push(...rows);
      }),
      then: (resolve: (value: any[]) => unknown) => Promise.resolve(resolve(applyFilters())),
    };

    return builder;
  };

  const knexFn = vi.fn((table: string) => {
    if (table === 'documents') return documentsBuilder;
    if (table === 'document_folders') return createDocumentFoldersBuilder();
    if (table === 'document_default_folders') return createDefaultDocumentFoldersBuilder();
    if (table === 'document_types') return documentTypesBuilder;
    if (table === 'shared_document_types') return sharedDocumentTypesBuilder;
    return defaultBuilder;
  });
  knexFn.fn = { now: () => new Date() };

  const trx = ((table: string) => knexFn(table)) as unknown as Knex.Transaction;

  return {
    fn: knexFn as unknown as Knex,
    trx,
    inserts,
    updateArgs,
    whereArgs,
    folderRows,
    defaultFolderRows,
  };
}

async function flushMicrotasks() {
  await new Promise(resolve => setImmediate(resolve));
}
