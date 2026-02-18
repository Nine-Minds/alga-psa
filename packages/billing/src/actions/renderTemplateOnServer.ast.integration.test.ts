import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';

const getAllTemplatesMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
}));

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {
    getAllTemplates: (...args: unknown[]) => getAllTemplatesMock(...args),
    saveTemplate: vi.fn(),
  },
}));

import { renderTemplateOnServer } from './invoiceTemplates';

const invoiceData = {
  invoiceNumber: 'INV-AST-001',
  issueDate: '2026-02-01',
  dueDate: '2026-02-15',
  currencyCode: 'USD',
  poNumber: null,
  customer: { name: 'Acme Co.', address: '123 Main' },
  tenantClient: null,
  items: [{ id: 'item-1', description: 'Consulting', quantity: 1, unitPrice: 100, total: 100 }],
  subtotal: 100,
  tax: 10,
  total: 110,
};

const templateAst = {
  kind: 'invoice-template-ast',
  version: INVOICE_TEMPLATE_AST_VERSION,
  bindings: {
    values: {
      invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' },
      total: { id: 'total', kind: 'value', path: 'total' },
    },
    collections: {},
  },
  layout: {
    id: 'doc',
    type: 'document',
    children: [
      {
        id: 'field-invoice',
        type: 'field',
        binding: { bindingId: 'invoiceNumber' },
      },
      {
        id: 'field-total',
        type: 'field',
        binding: { bindingId: 'total' },
      },
    ],
  },
};

describe('renderTemplateOnServer AST integration', () => {
  beforeEach(() => {
    getAllTemplatesMock.mockReset();
  });

  it('renders from inline templateAst override without template lookup by id', async () => {
    const result = await (renderTemplateOnServer as any)(
      { id: 'test-user' },
      { tenant: 'test-tenant' },
      null,
      invoiceData,
      { templateAst }
    );

    expect(result.html).toContain('INV-AST-001');
    expect(result.html).toContain('110');
    expect(typeof result.css).toBe('string');
    expect(getAllTemplatesMock).not.toHaveBeenCalled();
  });

  it('renders template HTML/CSS from canonical AST payload', async () => {
    getAllTemplatesMock.mockResolvedValueOnce([
      {
        template_id: 'tpl-1',
        templateAst,
      },
    ]);

    const result = await (renderTemplateOnServer as any)(
      { id: 'test-user' },
      { tenant: 'test-tenant' },
      'tpl-1',
      invoiceData
    );

    expect(result.html).toContain('INV-AST-001');
    expect(result.html).toContain('110');
    expect(typeof result.css).toBe('string');
    expect(getAllTemplatesMock).toHaveBeenCalled();
  });

  it('throws when selected template lacks canonical AST payload', async () => {
    getAllTemplatesMock.mockResolvedValueOnce([
      {
        template_id: 'tpl-legacy',
        templateAst: null,
      },
    ]);

    await expect(
      (renderTemplateOnServer as any)(
        { id: 'test-user' },
        { tenant: 'test-tenant' },
        'tpl-legacy',
        invoiceData
      )
    ).rejects.toThrow('does not have a canonical templateAst payload');
  });
});
