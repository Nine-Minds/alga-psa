import { describe, expect, it } from 'vitest';
import type { InvoiceBundleRowsLayout, TemplateAst } from '@alga-psa/types';
import { buildBundleChildRowsPreset, DEFAULT_BUNDLE_COLUMN_IDS, extractBundleRowsLayout } from '../invoice-template-ast/bundleChildRows';
import { STANDARD_INVOICE_TEMPLATE_ASTS } from '../invoice-template-ast/standardTemplates';
import { isBundleParentRoleBlank, resolveBundleRowCells, type BundleCellFormatters } from './layoutCells';

const fmt: BundleCellFormatters = {
  currency: (amount) => `$${(amount / 100).toFixed(2)}`,
  number: (value) => String(value),
  date: (value) => value,
  dateRange: (start, end) => `${start} - ${end ?? ''}`,
};

const component = { name: 'Workstations', quantity: 48, quantityChange: 2, pricingBasis: 'unit' as const, unitPrice: 1250, total: 60000 };
const layoutFor = (childRows: InvoiceBundleRowsLayout['childRows']): InvoiceBundleRowsLayout => ({ columnIds: DEFAULT_BUNDLE_COLUMN_IDS, childRows });

describe('resolveBundleRowCells', () => {
  it('follows the quantities preset: name + change + quantity, no price cells, quantity/unit price blank on the bundle row', () => {
    const layout = layoutFor(buildBundleChildRowsPreset({ prices: false, showChange: true }));
    const cells = resolveBundleRowCells(layout, component, {}, fmt);
    expect(cells.description?.lines.map((line) => line.text)).toEqual(['Workstations']);
    expect(cells.quantity).toEqual({ lines: [{ text: '48', supplemental: false }], change: 2 });
    expect(cells.unitPrice).toBeNull();
    expect(cells.total).toBeNull();
    expect(isBundleParentRoleBlank(layout, 'quantity')).toBe(true);
    expect(isBundleParentRoleBlank(layout, 'unitPrice')).toBe(true);
    expect(isBundleParentRoleBlank(layout, 'total')).toBe(false);
  });

  it('a total-only binding shows the amount and leaves unit price empty', () => {
    const preset = buildBundleChildRowsPreset({ prices: true, showChange: false });
    const { [DEFAULT_BUNDLE_COLUMN_IDS.unitPrice]: _dropped, ...cells } = preset.cells;
    const resolved = resolveBundleRowCells(layoutFor({ ...preset, cells }), component, {}, fmt);
    expect(resolved.unitPrice).toBeNull();
    expect(resolved.total?.lines[0].text).toBe('$600.00');
    expect(resolved.quantity?.change).toBeNull();
  });

  it('renders a period line via the daterange filter and blanks unbound money instead of $0.00', () => {
    const layout = layoutFor(buildBundleChildRowsPreset({ prices: true, showChange: false }));
    const cells = resolveBundleRowCells(
      layout,
      { name: 'Servers', quantity: 3, quantityChange: null, pricingBasis: 'bundle', periodLabelStart: '2026-01-01', periodLabelEnd: '2026-01-31' },
      {},
      fmt,
    );
    expect(cells.description?.lines).toEqual([
      { text: 'Servers', supplemental: false },
      { text: '2026-01-01 - 2026-01-31', supplemental: true },
    ]);
    expect(cells.unitPrice?.lines).toEqual([]);
    expect(cells.total?.lines).toEqual([]);
  });
});

describe('extractBundleRowsLayout', () => {
  it('returns the childRows table of standard-bundle-quantities and null for templates without component rows', () => {
    const layout = extractBundleRowsLayout(STANDARD_INVOICE_TEMPLATE_ASTS['standard-bundle-quantities'] as TemplateAst);
    expect(layout?.childRows.itemBinding).toBe('component');
    expect(layout?.columnIds).toEqual(DEFAULT_BUNDLE_COLUMN_IDS);
    expect(extractBundleRowsLayout(STANDARD_INVOICE_TEMPLATE_ASTS['standard-default'] as TemplateAst)).toBeNull();
    expect(extractBundleRowsLayout(null)).toBeNull();
  });
});
