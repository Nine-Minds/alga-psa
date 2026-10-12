import { describe, expect, it } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';

import { evaluateTemplateAst } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';
import { STANDARD_INVOICE_TEMPLATE_ASTS } from './standardTemplates';
import { applyInvoiceDiscountSummary, enrichWithGroupedItems } from '../adapters/invoiceAdapters';

// alga0002295: discount fields are opt-in; templates that do not reference them render the
// same numbers as before, and the opt-in layout adds up.

const baseItems = [
  { id: 'svc-1', description: 'Managed Service', quantity: 1, unitPrice: 10000, total: 10000, taxAmount: 1000 },
  { id: 'disc-1', description: 'Loyalty Discount', quantity: 1, unitPrice: -1500, total: -1500, taxAmount: -150 },
];

// Legacy shape: what every caller produced before this change (no isDiscount, no new fields).
const legacyModel = () => ({
  invoiceNumber: 'INV-1',
  issueDate: '2026-02-01',
  dueDate: '2026-02-15',
  currencyCode: 'EUR',
  customer: { name: 'Acme', address: '1 Main St' },
  tenantClient: { name: 'Northwind', address: '2 Side St', logoUrl: null },
  items: baseItems.map((item) => ({ ...item })),
  // Present on real models after location enrichment; the by-location template requires it.
  groupsByLocation: [] as unknown[],
  subtotal: 8500,
  tax: 850,
  total: 9350,
});

// Same invoice after this change: discount line flagged, new fields derived.
const currentModel = () => {
  const model = legacyModel();
  model.items[1] = { ...model.items[1], isDiscount: true } as (typeof model.items)[number];
  return enrichWithGroupedItems(model as never) as unknown as Record<string, unknown>;
};

const render = async (ast: TemplateAst, data: Record<string, unknown>) => {
  const evaluation = evaluateTemplateAst(ast, data);
  return renderEvaluatedTemplateAst(ast, evaluation, { locale: 'en-US' });
};

const optInAst = (): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: { templateName: 'Opt-in discount layout' },
  bindings: {
    values: {
      grossSubtotal: { id: 'grossSubtotal', kind: 'value', path: 'grossSubtotal' },
      discountTotal: { id: 'discountTotal', kind: 'value', path: 'discountTotal' },
      subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
      tax: { id: 'tax', kind: 'value', path: 'tax' },
      total: { id: 'total', kind: 'value', path: 'total' },
    },
    collections: { lineItems: { id: 'lineItems', kind: 'collection', path: 'items' } },
  },
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          { id: 'gross', label: 'Subtotal before discounts', value: { type: 'binding', bindingId: 'grossSubtotal' }, format: 'currency' },
          { id: 'discounts', label: 'Discounts', value: { type: 'binding', bindingId: 'discountTotal' }, format: 'currency', hideWhenZero: true },
          { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
          { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
          { id: 'total', label: 'Total', value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
        ],
      },
    ],
  },
});

describe('invoice discount in the render model', () => {
  it('derives a model whose opt-in rows add up', () => {
    const model = currentModel() as { subtotal: number; tax: number; total: number; discountTotal: number; grossSubtotal: number };
    expect(model.discountTotal).toBe(1500);
    expect(model.grossSubtotal).toBe(10000);
    expect(model.grossSubtotal - model.discountTotal).toBe(model.subtotal);
    expect(model.subtotal + model.tax).toBe(model.total);
  });

  it('renders the opt-in layout in EUR and adds up', async () => {
    const { html } = await render(optInAst(), currentModel());
    expect(html).toContain('€100.00');
    expect(html).toContain('Discounts');
    expect(html).toContain('€15.00');
    expect(html).toContain('€85.00');
    expect(html).toContain('€8.50');
    expect(html).toContain('€93.50');
    expect(html).not.toContain('$');
  });

  it('drops the hideWhenZero Discounts row when there is no discount', async () => {
    const model = { ...legacyModel(), items: [baseItems[0]], subtotal: 10000, tax: 1000, total: 11000 };
    applyInvoiceDiscountSummary(model as never);
    const { html } = await render(optInAst(), model as unknown as Record<string, unknown>);
    expect(html).not.toContain('Discounts');
    expect(html).toContain('€100.00');
    expect(html).toContain('€110.00');
  });

  it('renders a legacy payload with no flags as no discount (gross = subtotal)', async () => {
    const { html } = await render(optInAst(), applyInvoiceDiscountSummary(legacyModel() as never) as never);
    expect(html).not.toContain('Discounts');
  });

  describe('back-compat: templates that do not reference the new fields', () => {
    const customAst: TemplateAst = {
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      bindings: {
        values: {
          subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
          tax: { id: 'tax', kind: 'value', path: 'tax' },
          total: { id: 'total', kind: 'value', path: 'total' },
          discount: { id: 'discount', kind: 'value', path: 'discount' },
        },
        collections: { lineItems: { id: 'lineItems', kind: 'collection', path: 'items' } },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [
          { id: 'f-sub', type: 'field', binding: { bindingId: 'subtotal' }, format: 'currency' } as never,
          { id: 'f-disc', type: 'field', binding: { bindingId: 'discount' }, format: 'currency' } as never,
          { id: 'f-tax', type: 'field', binding: { bindingId: 'tax' }, format: 'currency' } as never,
          { id: 'f-total', type: 'field', binding: { bindingId: 'total' }, format: 'currency' } as never,
        ],
      },
    };

    const cases: Array<[string, TemplateAst]> = [
      ...Object.entries(STANDARD_INVOICE_TEMPLATE_ASTS),
      ['custom (with legacy dead discount path)', customAst],
    ];

    it.each(cases)('%s renders identical HTML with and without the new fields', async (_code, ast) => {
      const before = await render(ast, enrichWithGroupedItems(legacyModel() as never) as never);
      const stripped = { ...currentModel() };
      const after = await render(ast, stripped);
      expect(after.html).toBe(before.html);
      expect(after.css).toBe(before.css);
    });

    it('keeps subtotal, tax and total untouched by the derivation', () => {
      const legacy = legacyModel();
      const model = currentModel() as typeof legacy;
      expect([model.subtotal, model.tax, model.total]).toEqual([legacy.subtotal, legacy.tax, legacy.total]);
    });
  });
});
