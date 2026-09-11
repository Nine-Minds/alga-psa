import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const hoisted = vi.hoisted(() => ({
  insert: vi.fn(),
  insertReturning: vi.fn(async () => [{ migration_job_id: 'job-1' }]),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: vi.fn(async () => null),
  })),
}));

// Wraps the real converter so the route still stages, while recording the
// namespace each conversion was given.
vi.mock('@alga-psa/migration-connectors/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/migration-connectors/csv')>();
  return { ...actual, convertSpreadsheets: vi.fn(actual.convertSpreadsheets) };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  runWithTenant: vi.fn(async (_tenant: string, fn: () => unknown) => fn()),
  tenantDb: vi.fn(() => ({
    table: vi.fn(() => ({ insert: hoisted.insert })),
  })),
}));

vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({
  StorageProviderFactory: {
    createProvider: vi.fn(async () => ({
      upload: vi.fn(
        async (
          stream: AsyncIterable<Uint8Array>,
          storagePath: string,
          options: { mime_type?: string }
        ) => {
          let size = 0;
          for await (const chunk of stream) {
            size += chunk.length;
          }
          return { path: storagePath, size, mime_type: options?.mime_type };
        }
      ),
    })),
  },
  generateStoragePath: vi.fn(() => 'tenant-1/files/package.amp'),
}));

vi.mock('@alga-psa/storage/models/storage', () => ({
  FileStoreModel: {
    create: vi.fn(async () => ({ file_id: 'file-1' })),
    findById: vi.fn(),
    softDelete: vi.fn(),
    updateMetadata: vi.fn(),
  },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn(async () => ({ tenant: 'tenant-1', user_id: 'user-1' })),
}));

vi.mock('@alga-psa/auth', () => ({ hasPermission: vi.fn(async () => true) }));

vi.mock('@/lib/migrations/MigrationStager', () => ({
  MigrationStager: class {
    static hasImportableRecords = vi.fn(() => true);
    async stage() {
      return { rejected: false, validation: { diagnostics: [], rowCounts: { contacts: 1 } } };
    }
  },
}));

import { clearCachedStorageConfig } from '@alga-psa/storage/config/storage';
import { FileStoreModel } from '@alga-psa/storage/models/storage';
import { convertSpreadsheets } from '@alga-psa/migration-connectors/csv';
import { MigrationStager } from '@/lib/migrations/MigrationStager';
import { spreadsheetImportNamespace } from '@/lib/migrations/spreadsheetNamespace';

const RESTRICTIVE_ALLOWLIST =
  'image/*,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,video/*';

function spreadsheetRequest(csv: string, entityType = 'contacts', fileName = 'contacts.csv'): Request {
  return new Request('http://localhost/api/migrations/spreadsheet', {
    method: 'POST',
    headers: {
      'x-amp-file-name': encodeURIComponent(fileName),
      'x-amp-entity-type': entityType,
      'x-amp-file-size': String(Buffer.byteLength(csv)),
    },
    body: csv,
  });
}

function uploadRequest(body: string, fileName = 'package.amp', contentType = 'text/csv'): Request {
  return new Request('http://localhost/api/migrations/upload', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-amp-file-name': encodeURIComponent(fileName),
      'x-amp-file-size': String(Buffer.byteLength(body)),
    },
    body,
  });
}

describe('migration upload routes', () => {
  beforeEach(() => {
    process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES = RESTRICTIVE_ALLOWLIST;
    process.env.STORAGE_DEFAULT_PROVIDER = 'local';
    delete process.env.STORAGE_LOCAL_MAX_FILE_SIZE;
    clearCachedStorageConfig();
    hoisted.insert.mockReset();
    hoisted.insert.mockReturnValue({ returning: hoisted.insertReturning });
    hoisted.insertReturning.mockReset();
    hoisted.insertReturning.mockResolvedValue([{ migration_job_id: 'job-1' }]);
    vi.mocked(FileStoreModel.create).mockClear();
    vi.mocked(convertSpreadsheets).mockClear();
    const stager = MigrationStager as unknown as { hasImportableRecords: ReturnType<typeof vi.fn> };
    stager.hasImportableRecords.mockReset();
    stager.hasImportableRecords.mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stages a contacts CSV under the restrictive hosted allowlist without a storage rejection', async () => {
    const { POST } = await import('@/app/api/migrations/spreadsheet/route');
    const response = await POST(
      spreadsheetRequest('Name,Email,Client\nJane Doe,jane@example.com,Acme Managed Networks\n')
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.state).toBe('needs_configuration');
    expect(JSON.stringify(body)).not.toContain('File type not allowed');
    expect(hoisted.insert).toHaveBeenCalledTimes(1);
  });

  it('namespaces a spreadsheet conversion by the uploaded file bytes, not the tenant alone', async () => {
    const { POST } = await import('@/app/api/migrations/spreadsheet/route');
    const csv = 'Name,Email\nJane Doe,jane@example.com\n';
    const response = await POST(spreadsheetRequest(csv));
    expect(response.status).toBe(201);

    const expected = spreadsheetImportNamespace(
      'tenant-1',
      createHash('sha256').update(csv).digest('hex')
    );
    expect(vi.mocked(convertSpreadsheets)).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: expected }),
      expect.anything()
    );

    const otherCsv = 'Name,Email\nJohn Roe,john@example.com\n';
    await POST(spreadsheetRequest(otherCsv));
    const otherNamespace = spreadsheetImportNamespace(
      'tenant-1',
      createHash('sha256').update(otherCsv).digest('hex')
    );
    expect(otherNamespace).not.toBe(expected);
    const namespaces = vi
      .mocked(convertSpreadsheets)
      .mock.calls.map((call) => (call[0] as { namespace: string }).namespace);
    expect(namespaces).toContain(expected);
    expect(namespaces).toContain(otherNamespace);
  });

  it('keeps a namespace stable for identical source bytes and distinct across tenants', () => {
    const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
    expect(spreadsheetImportNamespace('tenant-1', sha('a'))).toBe(
      spreadsheetImportNamespace('tenant-1', sha('a'))
    );
    expect(spreadsheetImportNamespace('tenant-1', sha('a'))).not.toBe(
      spreadsheetImportNamespace('tenant-1', sha('b'))
    );
    expect(spreadsheetImportNamespace('tenant-2', sha('a'))).not.toBe(
      spreadsheetImportNamespace('tenant-1', sha('a'))
    );
  });

  it('returns conversion diagnostics naming unmapped headers on a successful stage', async () => {
    const { POST } = await import('@/app/api/migrations/spreadsheet/route');
    const response = await POST(
      spreadsheetRequest('Name,Email,Favorite Color\nJane Doe,jane@example.com,Blue\n')
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    const unmapped = (body.conversionDiagnostics as Array<{ code: string; message: string }>).find(
      (diagnostic) => diagnostic.code === 'CSV_UNMAPPED_COLUMN'
    );
    expect(unmapped?.message).toContain('Favorite Color');
  });

  it('rejects a sheet with no recognized headers and creates no migration job rows', async () => {
    const { POST } = await import('@/app/api/migrations/spreadsheet/route');
    const response = await POST(spreadsheetRequest('Unrelated,Columns\na,b\n'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('AMP_SPREADSHEET_NO_RECOGNIZED_HEADERS');
    expect(hoisted.insert).not.toHaveBeenCalled();
  });

  it('stores the upload package with the fixed AMP MIME type, ignoring the request content-type', async () => {
    const { POST } = await import('@/app/api/migrations/upload/route');
    const response = await POST(uploadRequest('not-a-real-package', 'package.amp', 'text/csv'));
    expect(response.status).toBe(201);

    expect(vi.mocked(FileStoreModel.create)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mime_type: 'application/vnd.sqlite3' })
    );
  });

  it('maps an unexpected throw to the generic code without leaking the original message and logs it', async () => {
    const stager = MigrationStager as unknown as { hasImportableRecords: ReturnType<typeof vi.fn> };
    stager.hasImportableRecords.mockImplementation(() => {
      throw new Error('storage-exploded-9f3a');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { POST } = await import('@/app/api/migrations/spreadsheet/route');
    const response = await POST(spreadsheetRequest('Name,Email\nJane Doe,jane@example.com\n'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('AMP_SPREADSHEET_FAILED');
    expect(JSON.stringify(body)).not.toContain('storage-exploded-9f3a');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('maps a storage-layer rejection to the distinct storage code', async () => {
    process.env.STORAGE_LOCAL_MAX_FILE_SIZE = '10';
    clearCachedStorageConfig();

    const { POST } = await import('@/app/api/migrations/upload/route');
    const response = await POST(uploadRequest('not-a-real-package'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('AMP_STORAGE_REJECTED');
    expect(JSON.stringify(body)).not.toContain('File size exceeds limit');
  });
});
