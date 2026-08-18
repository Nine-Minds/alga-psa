import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';

const { mapDbQuoteToViewModelMock } = vi.hoisted(() => ({
  mapDbQuoteToViewModelMock: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  runWithTenant: async (_tenant: string, fn: () => unknown) => fn(),
  tenantDb: () => {
    throw new Error('no database in this test');
  },
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => unknown) => fn({}),
}));

vi.mock('../lib/adapters/quoteAdapters', () => ({
  mapDbQuoteToViewModel: (...args: unknown[]) => mapDbQuoteToViewModelMock(...args),
}));

vi.mock('./browserPoolService', () => ({
  browserPoolService: { getBrowser: vi.fn(), releaseBrowser: vi.fn() },
}));

import { PDFGenerationService } from './pdfGenerationService';

const templateAst: TemplateAst = {
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  bindings: {
    values: {
      issueDate: { id: 'issueDate', kind: 'value', path: 'issueDate' },
      subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
    },
    collections: {
      lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
    },
  },
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'issue-date',
        type: 'field',
        label: { i18nKey: 'labels.issueDate', defaultValue: 'Issue Date' },
        binding: { bindingId: 'issueDate' },
        format: 'date',
      },
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          {
            id: 'subtotal',
            label: { i18nKey: 'labels.subtotal', defaultValue: 'Subtotal' },
            value: { type: 'binding', bindingId: 'subtotal' },
            format: 'currency',
          },
        ],
      },
    ],
  },
} as TemplateAst;

const viewModel = {
  issueDate: '2026-03-04',
  subtotal: 123456,
  currencyCode: 'USD',
  items: [{ id: 'a1', description: 'Managed backup', quantity: 1, unitPrice: 123456, total: 123456 }],
};

const buildService = (locale: string) => {
  const service = new PDFGenerationService('tenant-1');
  (service as any).resolveRecipientClientId = vi.fn().mockResolvedValue('client-1');
  (service as any).resolveRenderedLocale = vi.fn().mockResolvedValue(locale);
  return service;
};

describe('on-screen previews render in the recipient locale', () => {
  beforeEach(() => {
    mapDbQuoteToViewModelMock.mockReset();
    mapDbQuoteToViewModelMock.mockResolvedValue(viewModel);
  });

  it('renders a quote preview in the client language, labels and formatting alike', async () => {
    const service = buildService('de');

    const preview = await service.renderQuotePreview({ quoteId: 'quote-1', templateAst });

    expect(preview.html).toContain('Rechnungsdatum');
    expect(preview.html).toContain('Zwischensumme');
    expect(preview.html).toContain('4.3.2026');
    expect(preview.html).toContain('1.234,56');
  });

  it('keeps the preview English when the recipient resolves to English', async () => {
    const service = buildService('en');

    const preview = await service.renderQuotePreview({ quoteId: 'quote-2', templateAst });

    expect(preview.html).toContain('Issue Date');
    expect(preview.html).toContain('Subtotal');
    expect(preview.html).toContain('3/4/2026');
  });

  it('renders an invoice preview in the recipient locale too', async () => {
    const service = buildService('de');
    (service as any).getInvoiceForRendering = vi.fn().mockResolvedValue({ client_id: 'client-1' });
    (service as any).enrichWithTenantClient = vi.fn(async (_knex: unknown, data: unknown) => data);

    const previewModule = await import('../lib/adapters/invoiceAdapters');
    const spy = vi
      .spyOn(previewModule, 'mapDbInvoiceToWasmViewModel')
      .mockReturnValue(viewModel as any);

    try {
      const preview = await service.renderInvoicePreview({ invoiceId: 'inv-1', templateAst });

      expect(preview.html).toContain('Rechnungsdatum');
      expect(preview.html).toContain('Zwischensumme');
      expect(preview.html).toContain('4.3.2026');
    } finally {
      spy.mockRestore();
    }
  });
});
