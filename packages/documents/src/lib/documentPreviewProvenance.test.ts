import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as Array<{ file_id: string; metadata: unknown }> }));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    table: vi.fn(() => {
      const builder: any = {
        where: vi.fn(() => builder),
        whereIn: vi.fn((_column: string, ids: string[]) => ({
          select: vi.fn(async () => state.rows.filter(({ file_id }) => ids.includes(file_id))),
        })),
      };
      return builder;
    }),
  })),
}));

import { validateDocumentPreviewProvenance, withoutClientThumbnailReference } from './documentPreviewProvenance';

describe('document preview provenance', () => {
  it('rejects a thumbnail from another source document or with the wrong derivative role', async () => {
    state.rows = [{
      file_id: 'thumb-1',
      metadata: { context: 'document_thumbnail', source_document_id: 'other-doc' },
    }];

    await expect(validateDocumentPreviewProvenance({} as any, 'tenant-1', 'doc-1', {
      thumbnail_file_id: 'thumb-1',
    })).rejects.toThrow('not a derivative of document doc-1');
  });

  it('accepts tenant-scoped thumbnail and preview derivatives for the source document', async () => {
    state.rows = [
      { file_id: 'thumb-1', metadata: { context: 'document_thumbnail', source_document_id: 'doc-1' } },
      { file_id: 'preview-1', metadata: { context: 'document_preview', source_document_id: 'doc-1' } },
    ];

    await expect(validateDocumentPreviewProvenance({} as any, 'tenant-1', 'doc-1', {
      thumbnail_file_id: 'thumb-1',
      preview_file_id: 'preview-1',
    })).resolves.toBeUndefined();
  });

  it('drops a client supplied thumbnail reference while retaining editable document fields', () => {
    expect(withoutClientThumbnailReference({
      document_name: 'Updated name',
      thumbnail_file_id: 'attacker-file',
    })).toEqual({ document_name: 'Updated name' });
  });
});
