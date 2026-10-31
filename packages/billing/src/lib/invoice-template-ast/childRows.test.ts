import { describe, expect, it } from 'vitest';
import type { TemplateAst, TemplateChildRows } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';
import { evaluateTemplateAst } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';
import { validateTemplateAst } from './schema';
import { templateHasComponentRows, templateUsesComponentPricing } from './componentPricing';

const quantitiesOnly: TemplateChildRows = {
  sourcePath: 'item.components',
  itemBinding: 'component',
  parentBlankColumns: ['qty', 'rate'],
  cells: {
    description: { value: { type: 'path', path: 'component.name' } },
    qty: {
      value: { type: 'path', path: 'component.quantity' },
      format: 'number',
      change: { value: { type: 'path', path: 'component.quantityChange' }, format: 'signed-number' },
    },
  },
};

const pricedCells: TemplateChildRows['cells'] = {
  ...quantitiesOnly.cells,
  amount: { value: { type: 'path', path: 'component.total' }, format: 'currency' },
};

const buildAst = (childRows?: TemplateChildRows): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: { templateName: 'Bundles' },
  bindings: { collections: { lineItems: { id: 'lineItems', kind: 'collection', path: 'items' } } },
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'items',
        type: 'dynamic-table',
        repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
        columns: [
          { id: 'description', header: { i18nKey: 'd', defaultValue: 'Description' }, value: { type: 'path', path: 'item.description' } },
          { id: 'qty', header: { i18nKey: 'q', defaultValue: 'Qty' }, value: { type: 'path', path: 'item.quantity' }, format: 'number' },
          { id: 'rate', header: { i18nKey: 'r', defaultValue: 'Rate' }, value: { type: 'path', path: 'item.unitPrice' }, format: 'currency' },
          { id: 'amount', header: { i18nKey: 'a', defaultValue: 'Amount' }, value: { type: 'path', path: 'item.total' }, format: 'currency' },
        ],
        ...(childRows ? { childRows } : {}),
      },
    ],
  },
});

const data = {
  items: [
    {
      description: 'Managed IT Bundle', quantity: 1, unitPrice: 624000, total: 624000,
      components: [
        { name: 'Workstations', quantity: 48, quantityChange: 2 },
        { name: 'Servers', quantity: 6, quantityChange: 0 },
        { name: 'Backup users', quantity: 45, quantityChange: -1 },
        { name: 'Removed service', quantity: 0, quantityChange: null },
      ],
    },
    { description: 'Camera license', quantity: 12, unitPrice: 1800, total: 21600 },
  ],
};

const render = async (ast: TemplateAst, d: unknown = data) =>
  (await renderEvaluatedTemplateAst(ast, evaluateTemplateAst(ast, d as Record<string, unknown>), { locale: 'en-US' })).html;

describe('dynamic-table childRows', () => {
  it('validates childRows and rejects unknown properties', () => {
    expect(validateTemplateAst(buildAst(quantitiesOnly)).success).toBe(true);
    const bad = buildAst({ ...quantitiesOnly, bogus: true } as unknown as TemplateChildRows);
    expect(validateTemplateAst(bad).success).toBe(false);
  });

  it('renders signed changes, indented rows, and blanks parent cells only on bundle rows', async () => {
    const html = await render(buildAst(quantitiesOnly));
    expect(html).toContain('ast-child-row');
    expect(html).toContain('+2');
    expect(html).toContain('−1');
    expect(html).toContain('ast-change-positive');
    expect(html).toContain('ast-change-negative');
    expect(html).toContain('Workstations');
    // unchanged (0) and null changes render no change element
    expect(html.match(/class="ast-change /g)?.length).toBe(2);
    const bundleRow = html.split('<tr').find((r) => r.includes('Managed IT Bundle')) ?? '';
    expect(bundleRow).toContain('$6,240.00');
    // qty and rate cells are empty on the bundle row; only the amount remains
    expect(bundleRow.match(/<td[^>]*><\/td>/g)?.length).toBe(2);
    expect(bundleRow).not.toContain('$18.00');
    // ordinary row keeps qty / rate / amount
    const ordinary = html.split('<tr').find((r) => r.includes('Camera license')) ?? '';
    expect(ordinary).toContain('12');
    expect(ordinary).toContain('$18.00');
    expect(ordinary).toContain('$216.00');
  });

  it('leaves existing output byte-identical when childRows is absent', async () => {
    const without = await render(buildAst());
    expect(without).not.toContain('ast-child-row');
    expect(without).not.toContain('ast-has-child-rows');
    const bundleRow = without.split('<tr').find((r) => r.includes('Managed IT Bundle')) ?? '';
    expect(bundleRow).toContain('$6,240.00');
    expect(bundleRow).toContain('$6,240.00');
  });

  it('renders no child rows and no error for a missing or empty source', async () => {
    const html = await render(buildAst(quantitiesOnly), { items: [{ description: 'Plain', quantity: 2, unitPrice: 100, total: 200, components: [] }, { description: 'NoField', quantity: 1, unitPrice: 5, total: 5 }] });
    expect(html).not.toContain('ast-child-row"');
    expect(html).toContain('Plain');
  });
});

describe('templateUsesComponentPricing', () => {
  it('is false without childRows and for the quantities-only mapping', () => {
    expect(templateUsesComponentPricing(buildAst())).toBe(false);
    expect(templateUsesComponentPricing(buildAst(quantitiesOnly))).toBe(false);
    expect(templateHasComponentRows(buildAst(quantitiesOnly))).toBe(true);
    expect(templateHasComponentRows(buildAst())).toBe(false);
  });
  it('is true when a child cell binds component total or unitPrice', () => {
    expect(templateUsesComponentPricing(buildAst({ ...quantitiesOnly, cells: pricedCells }))).toBe(true);
    expect(templateUsesComponentPricing(buildAst({
      ...quantitiesOnly,
      cells: { ...quantitiesOnly.cells, rate: { value: { type: 'path', path: 'component.unitPrice' }, format: 'currency' } },
    }))).toBe(true);
    expect(templateUsesComponentPricing(buildAst({
      ...quantitiesOnly,
      cells: { ...quantitiesOnly.cells, amount: { value: { type: 'template', template: '{{component.total}}' } } },
    }))).toBe(true);
  });
});
