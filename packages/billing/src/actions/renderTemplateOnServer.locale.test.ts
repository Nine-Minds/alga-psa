import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';

const resolveRenderLocaleMock = vi.fn();
const resolveRenderCountryMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
  hasPermission: async () => true,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async () => true,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({}),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
}));

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {
    getAllTemplates: vi.fn(),
    saveTemplate: vi.fn(),
  },
}));

// The preview resolves the recipient through the PDF service's seam; the render
// under test is the same one the PDF path uses, so only the lookups are stubbed.
// There are two of them, and they answer different questions: the language the
// document is written in, and the country whose date shape it is dated in.
vi.mock('../services/pdfGenerationService', () => ({
  createPDFGenerationService: () => ({
    resolveRenderLocale: (...args: unknown[]) => resolveRenderLocaleMock(...args),
    resolveRenderCountry: (...args: unknown[]) => resolveRenderCountryMock(...args),
  }),
}));

import { countryDateFormat, SYSTEM_DATE_FORMAT } from '@alga-psa/core/i18n/countryDateFormat';
import { renderTemplateOnServer } from './invoiceTemplates';

const invoiceData = {
  invoiceNumber: 'INV-LOC-001',
  issueDate: '2026-03-04',
  dueDate: '2026-03-18',
  currencyCode: 'USD',
  customer: { name: 'Grüne Stadt GmbH', address: 'Hauptstr. 1' },
  tenantClient: null,
  items: [{ id: 'item-1', description: 'Managed backup', quantity: 1, unitPrice: 123456, total: 123456 }],
  subtotal: 123456,
  tax: 0,
  total: 123456,
};

/** A standard-style template: key-referenced labels plus locale-formatted values. */
const standardAst: TemplateAst = {
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

const render = (options: Record<string, unknown>) =>
  (renderTemplateOnServer as any)(
    { id: 'test-user', tenant: 'test-tenant' },
    { tenant: 'test-tenant' },
    null,
    invoiceData,
    options
  );

describe('renderTemplateOnServer recipient locale', () => {
  beforeEach(() => {
    resolveRenderLocaleMock.mockReset();
    resolveRenderCountryMock.mockReset();
    resolveRenderCountryMock.mockResolvedValue(SYSTEM_DATE_FORMAT);
  });

  it('previews a real invoice in its recipient locale', async () => {
    resolveRenderLocaleMock.mockResolvedValue('de');
    // A German-language invoice addressed to the UK: the language names the
    // labels, the country numbers the date. Pairing a language with a country
    // that disagrees is what makes this assertion prove which one won.
    resolveRenderCountryMock.mockResolvedValue(countryDateFormat('GB'));

    const result = await render({ templateAst: standardAst, invoiceId: 'inv-1' });

    expect(resolveRenderLocaleMock).toHaveBeenCalledWith({ invoiceId: 'inv-1' });
    expect(resolveRenderCountryMock).toHaveBeenCalledWith({ invoiceId: 'inv-1' });
    expect(result.html).toContain('Rechnungsdatum');
    expect(result.html).toContain('Zwischensumme');
    // The on-screen preview must not diverge from the PDF: the same seam
    // supplies both, and the date follows GB rather than the German dots.
    expect(result.html).toContain('04/03/2026');
    expect(result.html).toContain('1.234,56');
  });

  it('leaves sample-data previews in the authored labels', async () => {
    // No invoice to address, so there is no recipient language to ask for --
    // but the tenant default still dates the sample, which is what an unsent
    // document would be dated in.
    resolveRenderCountryMock.mockResolvedValue(countryDateFormat('GB'));

    const result = await render({ templateAst: standardAst });

    expect(resolveRenderLocaleMock).not.toHaveBeenCalled();
    expect(resolveRenderCountryMock).toHaveBeenCalledWith({});
    expect(result.html).toContain('Issue Date');
    expect(result.html).toContain('Subtotal');
    expect(result.html).toContain('04/03/2026');
  });

  it('falls back to English rather than failing when no recipient locale resolves', async () => {
    resolveRenderLocaleMock.mockResolvedValue('en');

    const result = await render({ templateAst: standardAst, invoiceId: 'inv-2' });

    expect(result.html).toContain('Issue Date');
    expect(result.html).toContain('Subtotal');
    // An unplaceable country leaves the fixed system default, not a shape
    // inferred from the English fallback.
    expect(result.html).toContain('03/04/2026');
  });
});
