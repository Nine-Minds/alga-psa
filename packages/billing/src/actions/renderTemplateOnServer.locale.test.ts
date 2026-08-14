import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';

const resolveRenderLocaleMock = vi.fn();

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
// under test is the same one the PDF path uses, so only the lookup is stubbed.
vi.mock('../services/pdfGenerationService', () => ({
  createPDFGenerationService: () => ({
    resolveRenderLocale: (...args: unknown[]) => resolveRenderLocaleMock(...args),
  }),
}));

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
  });

  it('previews a real invoice in its recipient locale', async () => {
    resolveRenderLocaleMock.mockResolvedValue('de');

    const result = await render({ templateAst: standardAst, invoiceId: 'inv-1' });

    expect(resolveRenderLocaleMock).toHaveBeenCalledWith({ invoiceId: 'inv-1' });
    expect(result.html).toContain('Rechnungsdatum');
    expect(result.html).toContain('Zwischensumme');
    // The on-screen preview must not diverge from the PDF: one locale formats
    // dates and currency as well as labels.
    expect(result.html).toContain('4.3.2026');
    expect(result.html).toContain('1.234,56');
  });

  it('leaves sample-data previews in the authored labels', async () => {
    const result = await render({ templateAst: standardAst });

    expect(resolveRenderLocaleMock).not.toHaveBeenCalled();
    expect(result.html).toContain('Issue Date');
    expect(result.html).toContain('Subtotal');
    expect(result.html).toContain('3/4/2026');
  });

  it('falls back to English rather than failing when no recipient locale resolves', async () => {
    resolveRenderLocaleMock.mockResolvedValue('en');

    const result = await render({ templateAst: standardAst, invoiceId: 'inv-2' });

    expect(result.html).toContain('Issue Date');
    expect(result.html).toContain('Subtotal');
  });
});
