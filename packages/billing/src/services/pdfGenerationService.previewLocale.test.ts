import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';

const { mapDbQuoteToViewModelMock, resolveClientCountryMock, resolveTenantDefaultCountryMock } =
  vi.hoisted(() => ({
    mapDbQuoteToViewModelMock: vi.fn(),
    resolveClientCountryMock: vi.fn(),
    resolveTenantDefaultCountryMock: vi.fn(),
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

vi.mock('@alga-psa/tenancy/lib/tenantDefaultCountry', () => ({
  resolveClientCountry: resolveClientCountryMock,
  resolveTenantDefaultCountry: resolveTenantDefaultCountryMock,
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

/**
 * Both axes are stubbed at their innermost lookup so the public resolvers the
 * preview actually calls still run: the language the document is written in,
 * and the country whose date shape it is dated in.
 */
const buildService = (locale: string, country: string | null) => {
  const service = new PDFGenerationService('tenant-1');
  (service as any).resolveRecipientClientId = vi.fn().mockResolvedValue('client-1');
  (service as any).resolveRenderedLocale = vi.fn().mockResolvedValue(locale);
  resolveClientCountryMock.mockResolvedValue(country ? { code: country, name: country } : null);
  return service;
};

describe('on-screen previews render in the recipient locale', () => {
  beforeEach(() => {
    mapDbQuoteToViewModelMock.mockReset();
    mapDbQuoteToViewModelMock.mockResolvedValue(viewModel);
    resolveClientCountryMock.mockReset();
    resolveTenantDefaultCountryMock.mockReset();
    resolveTenantDefaultCountryMock.mockResolvedValue(null);
  });

  it('renders a quote preview in the client language, labels and formatting alike', async () => {
    // German language, UK recipient: the language names the labels and groups
    // the currency, the country numbers the date. They disagree on purpose --
    // German dots here would mean the language had kept the date.
    const service = buildService('de', 'GB');

    const preview = await service.renderQuotePreview({ quoteId: 'quote-1', templateAst });

    expect(preview.html).toContain('Rechnungsdatum');
    expect(preview.html).toContain('Zwischensumme');
    expect(preview.html).toContain('04/03/2026');
    expect(preview.html).toContain('1.234,56');
  });

  it('keeps the preview English when the recipient resolves to English', async () => {
    const service = buildService('en', 'US');

    const preview = await service.renderQuotePreview({ quoteId: 'quote-2', templateAst });

    expect(preview.html).toContain('Issue Date');
    expect(preview.html).toContain('Subtotal');
    expect(preview.html).toContain('03/04/2026');
  });

  it('renders an invoice preview in the recipient locale too', async () => {
    const service = buildService('de', 'DE');
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
      expect(preview.html).toContain('04.03.2026');
    } finally {
      spy.mockRestore();
    }
  });

  it('renders a persisted partial-period description in the shared invoice HTML/PDF template path', async () => {
    const service = buildService('en', 'US');
    const description = 'SMOKE Prod Users — additional 3 users, Aug 16–31, 2026 — 3 × $100.00 × 16/31';
    (service as any).getInvoiceForRendering = vi.fn().mockResolvedValue({
      invoice_number: 'INV-PARTIAL', invoice_date: '2026-09-01', due_date: '2026-09-15', currency_code: 'USD',
      client: { name: 'Smoke Customer', address: '' },
      invoice_charges: [{
        item_id: 'partial-increase', description, quantity: 3, unit_price: 5161,
        net_amount: 15483, total_price: 15483,
        manual_line_metadata: { partialPeriod: { source_item_id: 'source-charge-1', covered_days: 16, full_period_days: 31 } },
      }],
      subtotal: 15483, tax: 0, total: 15483,
    });
    (service as any).enrichWithTenantClient = vi.fn(async (_knex: unknown, data: unknown) => data);

    const preview = await service.renderInvoicePreview({
      invoiceId: 'inv-partial',
      templateAst: {
        kind: 'invoice-template-ast', version: TEMPLATE_AST_VERSION,
        bindings: { collections: { lineItems: { id: 'lineItems', kind: 'collection', path: 'items' } } },
        layout: {
          id: 'root', type: 'document', children: [{
            id: 'line-items', type: 'dynamic-table',
            repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
            columns: [
              { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
              { id: 'total', header: 'Amount', value: { type: 'path', path: 'total' }, format: 'currency' },
            ],
          }],
        },
      } as TemplateAst,
    });

    expect(preview.html).toContain(description);
    expect(preview.html).toContain('154.83');
  });
});
