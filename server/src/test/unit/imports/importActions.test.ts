import { describe, it, beforeEach, expect, vi } from 'vitest';

const mockManager = {
  getAvailableSources: vi.fn(),
  saveFieldMappingTemplate: vi.fn(),
  getFieldMappingTemplate: vi.fn(),
  getImportHistory: vi.fn(),
  getSourceById: vi.fn(),
  initiateImport: vi.fn(),
  preparePreview: vi.fn(),
};

const mockRegistry = {
  register: vi.fn(),
  registerMany: vi.fn(),
  unregister: vi.fn(),
  get: vi.fn(),
  list: vi.fn().mockReturnValue([]),
  has: vi.fn().mockReturnValue(true),
  clear: vi.fn(),
};

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(),
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn().mockResolvedValue({ tenant: 'tenant-1', knex: {} }),
}));

vi.mock('@/lib/imports/ImportRegistry', () => ({
  ImportRegistry: {
    getInstance: () => mockRegistry,
  },
}));

vi.mock('@/lib/imports/ImportManager', () => ({
  ImportManager: vi.fn(() => mockManager),
}));

vi.mock('@/lib/imports/assetFieldDefinitions', () => ({
  getAssetFieldDefinitions: vi.fn().mockReturnValue([
    { field: 'name', label: 'Asset Name', required: true },
  ]),
}));

vi.mock('@/lib/imports/CsvImporter', () => ({
  CsvImporter: vi.fn(() => ({ sourceType: 'csv_upload', parse: vi.fn() })),
}));

const { getCurrentUser } = await import('server/src/lib/actions/user-actions/userActions');
const { hasPermission } = await import('server/src/lib/auth/rbac');
const { getAssetFieldDefinitions } = await import('@/lib/imports/assetFieldDefinitions');
const { CsvImporter } = await import('@/lib/imports/CsvImporter');

const actions = await import('@/lib/actions/import-actions/importActions');

describe('import actions', () => {
beforeEach(() => {
  mockManager.getAvailableSources.mockReset();
  mockManager.saveFieldMappingTemplate.mockReset();
  mockManager.getFieldMappingTemplate.mockReset();
  mockManager.getImportHistory.mockReset();
  mockManager.getSourceById.mockReset();
  mockManager.initiateImport.mockReset();
  mockManager.preparePreview.mockReset();
  mockRegistry.get.mockReset();
  mockRegistry.register.mockClear();
  mockRegistry.has.mockReset();
  mockRegistry.has.mockReturnValue(true);

  (getCurrentUser as any).mockReset();
  (getCurrentUser as any).mockResolvedValue({ user_id: 'user-1' });
  (hasPermission as any).mockReset();
  (hasPermission as any).mockResolvedValue(true);

  mockRegistry.get.mockReturnValue({
    sourceType: 'csv_upload',
    parse: vi.fn().mockResolvedValue([
      { rowNumber: 2, raw: { Name: 'Device' }, normalized: { Name: 'Device' } },
    ]),
  });
  mockManager.getSourceById.mockResolvedValue({ id: 'source-1', sourceType: 'csv_upload' });
  mockManager.initiateImport.mockResolvedValue({ import_job_id: 'job-1' });
  mockManager.preparePreview.mockResolvedValue({
    preview: { rows: [], summary: { totalRows: 1, validRows: 1, duplicateRows: 0, errorRows: 0 } },
    summary: { totalRows: 1, validRows: 1, duplicateRows: 0, errorRows: 0 },
    errorSummary: null,
    metrics: { totalRows: 1, processedRows: 0, created: 0, updated: 0, duplicates: 0, errors: 0 },
  });
  });

  it('returns import sources when user has read permission', async () => {
    mockManager.getAvailableSources.mockResolvedValue([
      {
        toRecord: () => ({ import_source_id: 'source-1', name: 'CSV Upload' }),
      },
    ]);

    const result = await actions.getImportSources();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('CSV Upload');
    expect(mockManager.getAvailableSources).toHaveBeenCalled();
  });

  it('saves mapping templates with manage permission', async () => {
    mockManager.saveFieldMappingTemplate.mockResolvedValue({ Name: { target: 'name' } });

    const result = await actions.saveImportFieldMapping('source-1', { Name: { target: 'name' } });

    expect(result?.Name?.target).toBe('name');
    expect(mockManager.saveFieldMappingTemplate).toHaveBeenCalledWith('tenant-1', 'source-1', {
      Name: { target: 'name' },
    });
  });

  it('creates preview by parsing file and initiating job', async () => {
    const formData = new FormData();
    formData.append('importSourceId', 'source-1');
    formData.append('fieldMapping', JSON.stringify([{ sourceField: 'Name', targetField: 'name' }]));
    formData.append('persistTemplate', 'true');
    formData.append('file', new File(['Name\nDevice'], 'assets.csv', { type: 'text/csv' }));

    const result = await actions.createImportPreview(formData);

    expect(result.importJobId).toBe('job-1');
    expect(mockManager.initiateImport).toHaveBeenCalled();
    expect(mockManager.preparePreview).toHaveBeenCalled();
    expect(mockManager.saveFieldMappingTemplate).toHaveBeenCalledWith(
      'tenant-1',
      'source-1',
      expect.objectContaining({
        Name: expect.objectContaining({ target: 'name' }),
      })
    );
  });

  it('throws when permission denied', async () => {
    (hasPermission as any).mockResolvedValue(false);

    await expect(actions.getImportSources()).rejects.toThrow('Permission denied');
  });
});
