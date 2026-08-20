import { beforeEach, describe, expect, it, vi } from 'vitest';

const { insertMock, updateMock, associationCreateMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  associationCreateMock: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  runWithTenant: async (_tenant: string, fn: () => unknown) => fn(),
  tenantDb: () => {
    throw new Error('no database in this test');
  },
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => unknown) =>
    fn({ raw: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('@alga-psa/documents/models', () => ({
  Document: { insert: insertMock, update: updateMock },
  DocumentAssociation: { create: associationCreateMock },
}));

vi.mock('./browserPoolService', () => ({
  browserPoolService: { getBrowser: vi.fn(), releaseBrowser: vi.fn() },
}));

import { PDFGenerationService } from './pdfGenerationService';

const target = {
  sourceType: 'quote' as const,
  entityId: 'quote-1',
  clientId: null,
  folderPath: '/Quotes/Generated',
  isClientVisible: true,
  documentName: 'Quote_Q-1.pdf',
  fileBaseName: 'Q-1',
  mode: 'append' as const,
};

const fileRecord = {
  file_id: 'file-1',
  storage_path: 'tenant-1/pdfs/Q-1.pdf',
  file_size: 42,
} as any;

describe('filed documents record the locale that was rendered', () => {
  beforeEach(() => {
    insertMock.mockReset();
    updateMock.mockReset();
    associationCreateMock.mockReset();
  });

  it('writes rendered_locale from the render, not a second resolution', async () => {
    const service = new PDFGenerationService('tenant-1');
    const resolveRenderedLocale = vi.fn();
    (service as any).resolveRenderedLocale = resolveRenderedLocale;

    await (service as any).fileGeneratedDocument(
      {},
      target,
      fileRecord,
      { buffer: Buffer.from('pdf'), templateId: 'tmpl-1', templateVersion: 3, renderedLocale: 'de' },
      'user-1',
      { regenerate: false }
    );

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0]?.[1]).toMatchObject({
      rendered_locale: 'de',
      source_template_id: 'tmpl-1',
      source_template_version: 3,
    });
    // Re-resolving here could disagree with what the client actually received.
    expect(resolveRenderedLocale).not.toHaveBeenCalled();
  });
});
