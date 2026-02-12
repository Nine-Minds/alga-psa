import { describe, expect, it, vi } from 'vitest';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';
import * as workspaceAstModule from '../components/invoice-designer/ast/workspaceAst';

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

import { runAuthoritativeInvoiceTemplatePreview } from './invoiceTemplatePreview';
import { renderTemplateOnServer } from './invoiceTemplates';

const workspace = {
  nodes: [
    {
      id: 'doc',
      type: 'document',
      name: 'Document',
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      canRotate: false,
      allowResize: false,
      rotation: 0,
      metadata: {},
      parentId: null,
      childIds: [],
      allowedChildren: [],
    },
  ],
  constraints: [],
  snapToGrid: true,
  gridSize: 8,
  showGuides: true,
  showRulers: true,
  canvasScale: 1,
};

const invoiceData = {
  invoiceNumber: 'INV-PARITY-001',
  issueDate: '2026-02-01',
  dueDate: '2026-02-15',
  currencyCode: 'USD',
  poNumber: null,
  customer: { name: 'Acme Co.', address: '123 Main' },
  tenantClient: null,
  items: [
    { id: 'b', description: 'Support', quantity: 1, unitPrice: 100, total: 100, category: 'Services' },
    { id: 'a', description: 'Consulting', quantity: 2, unitPrice: 100, total: 200, category: 'Services' },
    { id: 'c', description: 'Discount', quantity: 1, unitPrice: -15, total: -15, category: 'Adjustments' },
    { id: 'd', description: 'Equipment', quantity: 1, unitPrice: 30, total: 30, category: 'Products' },
  ],
  subtotal: 315,
  tax: 31.5,
  total: 346.5,
};

const astFixture = {
  kind: 'invoice-template-ast',
  version: INVOICE_TEMPLATE_AST_VERSION,
  bindings: {
    values: {
      invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' },
    },
    collections: {
      lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
    },
  },
  transforms: {
    sourceBindingId: 'lineItems',
    outputBindingId: 'lineItems.shaped',
    operations: [
      {
        id: 'filter-positive',
        type: 'filter',
        predicate: { type: 'comparison', path: 'total', op: 'gt', value: 0 },
      },
      {
        id: 'sort-for-group-order',
        type: 'sort',
        keys: [
          { path: 'category', direction: 'asc' },
          { path: 'total', direction: 'desc' },
        ],
      },
      {
        id: 'group-category',
        type: 'group',
        key: 'category',
      },
      {
        id: 'aggregate-totals',
        type: 'aggregate',
        aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }],
      },
      {
        id: 'compose-totals',
        type: 'totals-compose',
        totals: [{ id: 'grandTotal', label: 'Grand Total', value: { type: 'aggregate-ref', aggregateId: 'sumTotal' } }],
      },
    ],
  },
  layout: {
    id: 'doc',
    type: 'document',
    children: [
      {
        id: 'invoice-number',
        type: 'field',
        binding: { bindingId: 'invoiceNumber' },
      },
      {
        id: 'group-table',
        type: 'dynamic-table',
        repeat: {
          sourceBinding: { bindingId: 'lineItems.shaped' },
          itemBinding: 'group',
        },
        columns: [
          { id: 'group', header: 'Group', value: { type: 'path', path: 'key' } },
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems.shaped' },
        rows: [
          {
            id: 'grandTotal',
            label: 'Grand Total',
            value: { type: 'literal', value: '' },
          },
        ],
      },
    ],
  },
};

describe('preview/pdf AST parity integration', () => {
  it('produces equivalent HTML/CSS semantics for shared AST + invoice payload', async () => {
    const astSpy = vi
      .spyOn(workspaceAstModule, 'exportWorkspaceToInvoiceTemplateAst')
      .mockReturnValueOnce(astFixture as any);

    getAllTemplatesMock.mockResolvedValueOnce([
      {
        template_id: 'tpl-parity',
        templateAst: astFixture,
      },
    ]);

    const previewResult = await (runAuthoritativeInvoiceTemplatePreview as any)(
      { id: 'test-user' },
      { tenant: 'test-tenant' },
      { workspace, invoiceData }
    );

    const pdfRenderResult = await (renderTemplateOnServer as any)(
      { id: 'test-user' },
      { tenant: 'test-tenant' },
      'tpl-parity',
      invoiceData
    );

    astSpy.mockRestore();

    expect(previewResult.success).toBe(true);
    expect(previewResult.render.html).toBe(pdfRenderResult.html);
    expect(previewResult.render.css).toBe(pdfRenderResult.css);
    expect(previewResult.render.html).toContain('INV-PARITY-001');
    expect(previewResult.render.html).toContain('Grand Total');
    expect(previewResult.render.html).toContain('330');

    const productsIndex = previewResult.render.html.indexOf('Products');
    const servicesIndex = previewResult.render.html.indexOf('Services');
    expect(productsIndex).toBeGreaterThan(-1);
    expect(servicesIndex).toBeGreaterThan(-1);
    expect(productsIndex).toBeLessThan(servicesIndex);
  });
});
