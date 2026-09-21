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

  it('localizes data-driven cadence band names and the Optional section for a grouped quote', async () => {
    const cadenceTemplateAst: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      bindings: {
        values: {
          optionalTotal: { id: 'optionalTotal', kind: 'value', path: 'optional_total' },
        },
        collections: {
          groupsByCadence: { id: 'groupsByCadence', kind: 'collection', path: 'groups_by_cadence' },
          groupsByCadenceWithOptionals: {
            id: 'groupsByCadenceWithOptionals',
            kind: 'collection',
            path: 'groups_by_cadence_with_optionals',
          },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'cadence-bands',
            type: 'stack',
            direction: 'column',
            repeat: { sourceBinding: { bindingId: 'groupsByCadence' }, itemBinding: 'group' },
            children: [
              { id: 'cadence-band-name', type: 'text', content: { type: 'path', path: 'name' } },
              {
                id: 'cadence-band-items',
                type: 'dynamic-table',
                repeat: { sourceBinding: { bindingId: 'group.items' }, itemBinding: 'item' },
                columns: [
                  { id: 'description', header: { i18nKey: 'labels.description', defaultValue: 'Description' }, value: { type: 'path', path: 'description' } },
                  { id: 'amount', header: { i18nKey: 'labels.amount', defaultValue: 'Amount' }, value: { type: 'path', path: 'total_price' }, format: 'currency' },
                ],
              },
              { id: 'cadence-band-total', type: 'text', content: { type: 'path', path: 'total|currency' } },
            ],
          },
          {
            id: 'cadence-optional-bands',
            type: 'stack',
            direction: 'column',
            repeat: { sourceBinding: { bindingId: 'groupsByCadenceWithOptionals' }, itemBinding: 'group' },
            children: [
              { id: 'cadence-optional-label', type: 'text', content: { type: 'i18n', i18nKey: 'labels.optionalSection', defaultValue: 'Optional (if selected)' } },
              { id: 'cadence-optional-name', type: 'text', content: { type: 'path', path: 'name' } },
              {
                id: 'cadence-optional-items',
                type: 'dynamic-table',
                repeat: { sourceBinding: { bindingId: 'group.optional_items' }, itemBinding: 'item' },
                columns: [
                  { id: 'description', header: { i18nKey: 'labels.description', defaultValue: 'Description' }, value: { type: 'path', path: 'description' } },
                  { id: 'amount', header: { i18nKey: 'labels.amount', defaultValue: 'Amount' }, value: { type: 'path', path: 'total_price' }, format: 'currency' },
                ],
              },
              { id: 'cadence-optional-subtotal', type: 'text', content: { type: 'path', path: 'optional_subtotal|currency' } },
            ],
          },
          {
            id: 'totals',
            type: 'totals',
            sourceBinding: { bindingId: 'groupsByCadence' },
            rows: [
              {
                id: 'optional-total',
                label: { i18nKey: 'labels.optionalTotal', defaultValue: 'Optional if selected' },
                value: { type: 'binding', bindingId: 'optionalTotal' },
                format: 'currency',
              },
            ],
          },
        ],
      },
    } as TemplateAst;

    const cadenceViewModel = {
      quote_number: 'QT-1',
      currencyCode: 'USD',
      groups_by_cadence: [
        {
          cadence_key: 'monthly',
          name: 'Monthly',
          is_recurring: true,
          items: [{ quote_item_id: 'm', description: 'Managed Support', quantity: 1, unit_price: 10000, total_price: 10000 }],
          subtotal: 10000,
          tax: 0,
          total: 10000,
          optional_items: [],
          optional_subtotal: 0,
          optional_tax: 0,
          optional_total: 0,
        },
        {
          cadence_key: 'annually',
          name: 'Annually',
          is_recurring: true,
          items: [{ quote_item_id: 'a', description: 'Annual Firewall', quantity: 1, unit_price: 15900, total_price: 15900 }],
          subtotal: 15900,
          tax: 0,
          total: 15900,
          optional_items: [],
          optional_subtotal: 0,
          optional_tax: 0,
          optional_total: 0,
        },
      ],
      groups_by_cadence_with_optionals: [
        {
          cadence_key: 'monthly',
          name: 'Monthly',
          is_recurring: true,
          items: [],
          subtotal: 0,
          tax: 0,
          total: 0,
          optional_items: [{ quote_item_id: 'o', description: 'Optional Backup', quantity: 1, unit_price: 4000, total_price: 4000 }],
          optional_subtotal: 4000,
          optional_tax: 0,
          optional_total: 4000,
        },
      ],
      optional_subtotal: 4000,
      optional_tax: 0,
      optional_total: 4000,
    };
    mapDbQuoteToViewModelMock.mockResolvedValue(cadenceViewModel);

    const service = buildService('de', 'GB');
    const preview = await service.renderQuotePreview({ quoteId: 'quote-3', templateAst: cadenceTemplateAst });

    // Data-driven band names are localized from the documents namespace.
    expect(preview.html).toContain('Monatlich');
    expect(preview.html).toContain('Jährlich');
    expect(preview.html).toContain('Optional (falls ausgewählt)');
    // Totals reconcile: annual band total and the optional subtotal.
    expect(preview.html).toContain('159,00');
    expect(preview.html).toContain('40,00');
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
});
