import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<{ file_id: string; tenant: string; is_deleted: boolean; metadata: unknown }>,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn((_knex: unknown, tenant: string) => ({
    table: vi.fn(() => {
      const filters: Record<string, unknown> = {};
      let fileIds: string[] = [];
      const builder: any = {
        where: vi.fn((criteria: Record<string, unknown>) => {
          Object.assign(filters, criteria);
          return builder;
        }),
        whereIn: vi.fn((_column: string, ids: string[]) => {
          fileIds = ids;
          return builder;
        }),
        select: vi.fn(async () => state.rows.filter((row) =>
          row.tenant === tenant
          && Object.entries(filters).every(([key, value]) => (row as any)[key] === value)
          && fileIds.includes(row.file_id))),
      };
      return builder;
    }),
  })),
}));

import { validateDocumentPreviewProvenance } from './documentPreviewProvenance';

describe('document preview provenance', () => {
  it.each([
    ['wrong source document', { context: 'document_thumbnail', source_document_id: 'other-doc' }, 'tenant-1', false],
    ['wrong derivative role', { context: 'document_preview', source_document_id: 'doc-1' }, 'tenant-1', false],
    ['deleted derivative', { context: 'document_thumbnail', source_document_id: 'doc-1' }, 'tenant-1', true],
    ['cross-tenant derivative', { context: 'document_thumbnail', source_document_id: 'doc-1' }, 'tenant-2', false],
  ])('rejects %s', async (_caseName, metadata, rowTenant, isDeleted) => {
    state.rows = [{ file_id: 'thumb-1', tenant: rowTenant, is_deleted: isDeleted, metadata }];

    await expect(validateDocumentPreviewProvenance({} as any, 'tenant-1', 'doc-1', {
      thumbnail_file_id: 'thumb-1',
    })).rejects.toThrow('not a derivative of document doc-1');
  });

  it('rejects a derivative file that is missing from external_files', async () => {
    state.rows = [];

    await expect(validateDocumentPreviewProvenance({} as any, 'tenant-1', 'doc-1', {
      thumbnail_file_id: 'missing-thumb',
    })).rejects.toThrow('not a derivative of document doc-1');
  });

  it('accepts tenant-scoped thumbnail and preview derivatives for the source document', async () => {
    state.rows = [
      { file_id: 'thumb-1', tenant: 'tenant-1', is_deleted: false, metadata: { context: 'document_thumbnail', source_document_id: 'doc-1' } },
      { file_id: 'preview-1', tenant: 'tenant-1', is_deleted: false, metadata: { context: 'document_preview', source_document_id: 'doc-1' } },
    ];

    await expect(validateDocumentPreviewProvenance({} as any, 'tenant-1', 'doc-1', {
      thumbnail_file_id: 'thumb-1',
      preview_file_id: 'preview-1',
    })).resolves.toBeUndefined();
  });

});
