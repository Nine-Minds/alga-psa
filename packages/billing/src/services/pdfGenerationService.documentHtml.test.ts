import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const { maliciousName } = vi.hoisted(() => ({
  maliciousName: '</title><script>alert(1)</script><title>tail',
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  runWithTenant: async (_tenant: string, callback: () => unknown) => callback(),
  tenantDb: () => ({
    table: (tableName: string) => {
      const query: any = {
        where: () => query,
        select: () => query,
        first: async () => {
          if (tableName === 'documents') {
            return {
              document_id: 'doc-1',
              document_name: maliciousName,
              mime_type: 'text/plain',
              tenant: 'tenant-1',
            };
          }
          if (tableName === 'document_block_content') return null;
          if (tableName === 'document_content') return { content: 'Safe document body' };
          throw new Error(`Unexpected table ${tableName}`);
        },
      };
      return query;
    },
  }),
  withTransaction: async (_knex: unknown, callback: (trx: unknown) => unknown) => callback({}),
}));

vi.mock('./browserPoolService', () => ({
  browserPoolService: { getBrowser: vi.fn(), releaseBrowser: vi.fn() },
}));

import { PDFGenerationService } from './pdfGenerationService';

describe('PDFGenerationService document HTML metadata', () => {
  it('keeps a malicious document name as text in both the title and visible heading', async () => {
    const service = new PDFGenerationService('tenant-1');
    const html = await (service as any).getDocumentHtml('doc-1');
    const document = new JSDOM(html).window.document;

    expect(document.title).toBe(maliciousName);
    const heading = document.querySelector('h1.document-title');
    expect(heading?.textContent).toBe(maliciousName);
    expect(heading?.children).toHaveLength(0);
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });
});
