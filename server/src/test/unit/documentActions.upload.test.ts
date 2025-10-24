import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { Knex } from 'knex';
import type { IDocument } from '@/interfaces/document.interface';

vi.mock('server/src/lib/storage/StorageService', () => {
  return {
    StorageService: {
      validateFileUpload: vi.fn(),
      uploadFile: vi.fn(),
    },
  };
});

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(),
}));

vi.mock('@shared/db', () => ({
  withTransaction: vi.fn(),
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(),
}));

vi.mock('server/src/models/document-association', () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(),
}));

vi.mock('server/src/lib/utils/documentPreviewGenerator', () => ({
  generateDocumentPreviews: vi.fn(),
}));

import { StorageService } from 'server/src/lib/storage/StorageService';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import DocumentAssociation from 'server/src/models/document-association';
import { v4 as uuidv4 } from 'uuid';
import { generateDocumentPreviews } from 'server/src/lib/utils/documentPreviewGenerator';
import * as documentActions from '@/lib/actions/document-actions/documentActions';

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
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1' });
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
    expect(insertedDocument.document_id).toBe('doc-123');
    expect(insertedDocument.file_id).toBe('file-123');
    expect(insertedDocument.mime_type).toBe('image/png');

    expect(documentAssociationCreateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        document_id: 'doc-123',
        entity_id: 'ticket-42',
        entity_type: 'ticket',
      }),
    );

    expect(generateDocumentPreviewsMock).toHaveBeenCalledWith(
      expect.objectContaining({ document_id: 'doc-123' }),
      expect.any(Buffer),
    );

    await flushMicrotasks();

    expect(knexStub.whereArgs).toEqual([{ document_id: 'doc-123', tenant: 'tenant-123' }]);
    expect(knexStub.updateArgs).toEqual([
      expect.objectContaining({
        thumbnail_file_id: 'thumb-123',
        preview_file_id: 'preview-456',
        preview_generated_at: new Date('2024-01-01T00:00:00.000Z'),
      }),
    ]);
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

  const knexFn = vi.fn((table: string) => {
    if (table === 'documents') return documentsBuilder;
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
  };
}

async function flushMicrotasks() {
  await new Promise(resolve => setImmediate(resolve));
}
