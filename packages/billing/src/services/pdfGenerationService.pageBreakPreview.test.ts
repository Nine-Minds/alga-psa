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

vi.mock('../lib/adapters/quoteAdapters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/adapters/quoteAdapters')>()),
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

/** A quote laid out as the customer asked for it: cover sheet, then pricing. */
const templateAst: TemplateAst = {
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  bindings: {
    values: {
      issueDate: { id: 'issueDate', kind: 'value', path: 'issueDate' },
    },
    collections: {},
  },
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'cover',
        type: 'section',
        children: [
          {
            id: 'issue-date',
            type: 'field',
            label: { i18nKey: 'labels.issueDate', defaultValue: 'Issue Date' },
            binding: { bindingId: 'issueDate' },
            format: 'date',
          },
        ],
      },
      {
        id: 'pricing-page',
        type: 'section',
        style: { inline: { breakBefore: 'page' } },
        children: [
          { id: 'pricing-heading', type: 'text', content: { type: 'literal', value: 'Pricing' } },
        ],
      },
    ],
  },
} as TemplateAst;

const viewModel = {
  issueDate: '2026-03-04',
  currencyCode: 'USD',
  items: [],
};

const buildService = () => {
  const service = new PDFGenerationService('tenant-1');
  (service as any).resolveRecipientClientId = vi.fn().mockResolvedValue('client-1');
  (service as any).resolveRenderedLocale = vi.fn().mockResolvedValue('en');
  resolveClientCountryMock.mockResolvedValue({ code: 'US', name: 'US' });
  return service;
};

describe('the quote screen preview marks the pages a break opens', () => {
  beforeEach(() => {
    mapDbQuoteToViewModelMock.mockReset();
    mapDbQuoteToViewModelMock.mockResolvedValue(viewModel);
    resolveClientCountryMock.mockReset();
    resolveTenantDefaultCountryMock.mockReset();
    resolveTenantDefaultCountryMock.mockResolvedValue(null);
  });

  it('draws the page boundary in the quote preview a salesperson reads', async () => {
    // Reported from Billing -> Quotes: the preview flows as one sheet, so the
    // break a template author put before the pricing page left no trace there.
    const preview = await buildService().renderQuotePreview({ quoteId: 'quote-1', templateAst });

    expect(preview.html).toContain('ast-page-break-preview');
    expect(preview.html).toContain('Page break');
    // The boundary opens the page the author asked for, so it is drawn before
    // the section carrying the break.
    expect(preview.html.indexOf('ast-page-break-preview')).toBeLessThan(
      preview.html.indexOf('id="pricing-page"'),
    );
    // Drawn as a gutter between two sheets, not a hairline rule in the flow.
    expect(preview.css).toMatch(/\.ast-page-break-preview \{[^}]*background:/);
    // Screen chrome only: paper shows the break by turning.
    expect(preview.css).toMatch(/@media print \{[\s\S]*\.ast-page-break-preview \{ display: none; \}/);
  });
});
