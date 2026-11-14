import { describe, expect, it } from 'vitest';
import { countryDateFormat } from '@alga-psa/core/i18n/countryDateFormat';
import { evaluateTemplateAst } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';
import { validateTemplateAst } from './schema';
import { decideBundleLoad, templateHasComponentRows, templateUsesComponentPricing } from './componentPricing';
import { STANDARD_INVOICE_TEMPLATE_ASTS, getStandardTemplateAstByCode } from './standardTemplates';
import { buildBundleChildRowsPreset, detectBundleChildRowsPreset } from './bundleChildRows';

const viewModel = {
  invoiceNumber: 'INV-1', issueDate: '2026-10-01', dueDate: '2026-10-31',
  customer: { name: 'Acme', address: '1 Main' },
  currencyCode: 'USD', subtotal: 650000, tax: 0, total: 650000,
  items: [
    {
      id: 'a', description: 'Managed endpoint bundle', subtitle: 'Workstations, servers and backup',
      quantity: 1, unitPrice: 624000, total: 624000,
      hasComponents: true,
      components: [
        { name: 'Workstations', quantity: 48, quantityChange: 2, pricingBasis: 'unit' },
        { name: 'Backup users', quantity: 45, quantityChange: -1, pricingBasis: 'bundle' },
      ],
    },
    { id: 'b', description: 'Camera license', quantity: 12, unitPrice: 1800, total: 21600 },
  ],
};

const render = async (code: string) => {
  const ast = getStandardTemplateAstByCode(code)!;
  const evaluation = evaluateTemplateAst(ast, viewModel as unknown as Record<string, unknown>);
  return (await renderEvaluatedTemplateAst(ast, evaluation, { locale: 'en-US' })).html;
};

describe('standard-bundle-quantities', () => {
  it('is a valid AST that shows component rows and binds no component price', () => {
    const ast = STANDARD_INVOICE_TEMPLATE_ASTS['standard-bundle-quantities'];
    expect(validateTemplateAst(ast).success).toBe(true);
    expect(templateHasComponentRows(ast)).toBe(true);
    expect(templateUsesComponentPricing(ast)).toBe(false);
  });

  it('renders the bundle layout', async () => {
    const html = await render('standard-bundle-quantities');
    expect(html).toContain('Managed endpoint bundle');
    expect(html).toContain('Workstations, servers and backup');
    expect(html).toContain('+2');
    expect(html).toContain('−1');
    expect(html).toContain('Camera license');
    expect(html).toContain('$6,240.00');
  });

  it('leaves every existing standard template free of component rows', async () => {
    for (const [code, ast] of Object.entries(STANDARD_INVOICE_TEMPLATE_ASTS)) {
      if (code === 'standard-bundle-quantities') continue;
      expect(templateHasComponentRows(ast)).toBe(false);
    }
    const html = await render('standard-default');
    expect(html).not.toContain('ast-child-row');
    expect(html).not.toContain('Workstations');
  });
});

describe('bundle child rows presets', () => {
  const withPreset = (options: { prices: boolean; showChange: boolean }) => {
    const ast = JSON.parse(JSON.stringify(STANDARD_INVOICE_TEMPLATE_ASTS['standard-bundle-quantities']));
    const table = ast.layout.children.find((c: any) => c.id === 'line-items');
    table.childRows = buildBundleChildRowsPreset(options);
    return ast;
  };

  it('quantities-only binds no component price; quantities-and-prices does', () => {
    expect(templateUsesComponentPricing(withPreset({ prices: false, showChange: true }))).toBe(false);
    const priced = withPreset({ prices: true, showChange: false });
    expect(validateTemplateAst(priced).success).toBe(true);
    expect(templateUsesComponentPricing(priced)).toBe(true);
  });

  it('detects its own presets and flags anything else as custom', () => {
    expect(detectBundleChildRowsPreset(undefined)).toBe('off');
    expect(detectBundleChildRowsPreset(buildBundleChildRowsPreset({ prices: false, showChange: true }))).toBe('quantities');
    expect(detectBundleChildRowsPreset(buildBundleChildRowsPreset({ prices: true, showChange: true }))).toBe('quantities-and-prices');
    expect(detectBundleChildRowsPreset({ sourcePath: 'x', itemBinding: 'y', cells: {} })).toBe('custom');
  });
});

describe('decideBundleLoad (client price-leak gate)', () => {
  const quantities = STANDARD_INVOICE_TEMPLATE_ASTS['standard-bundle-quantities'];
  const plain = STANDARD_INVOICE_TEMPLATE_ASTS['standard-default'];
  const priced = (() => {
    const ast = JSON.parse(JSON.stringify(quantities));
    ast.layout.children.find((c: any) => c.id === 'line-items').childRows = buildBundleChildRowsPreset({ prices: true, showChange: true });
    return ast;
  })();

  it('MSP always gets presentation and amounts', () => {
    expect(decideBundleLoad('msp', null)).toEqual({ includeBundlePresentation: true, includeBundleComponentAmounts: true });
  });

  it('a client on a quantities-only template gets rows but no amounts', () => {
    expect(decideBundleLoad('client', quantities)).toEqual({ includeBundlePresentation: true, includeBundleComponentAmounts: false });
  });

  it('a client gets amounts only when the template binds a component price', () => {
    expect(decideBundleLoad('client', priced)).toEqual({ includeBundlePresentation: true, includeBundleComponentAmounts: true });
  });

  it('a client on a template without component rows, or an unknown template, gets nothing', () => {
    expect(decideBundleLoad('client', plain)).toEqual({ includeBundlePresentation: false, includeBundleComponentAmounts: false });
    expect(decideBundleLoad('client', null)).toEqual({ includeBundlePresentation: false, includeBundleComponentAmounts: false });
  });
});

describe('French render (T019)', () => {
  const frModel = {
    ...viewModel,
    items: [
      {
        id: 'a', description: 'Forfait postes', subtitle: 'Postes et sauvegarde',
        quantity: 1, unitPrice: 1000, total: 1000, hasComponents: true,
        components: [
          { name: 'Postes', quantity: 1234.5, quantityChange: -1.5, pricingBasis: 'unit' },
          { name: 'Sauvegarde', quantity: 40, quantityChange: 2.5, pricingBasis: 'unit', periodLabelStart: '2026-01-01', periodLabelEnd: '2026-02-01' },
        ],
      },
    ],
  };

  it('formats quantities, signed changes and period labels in the recipient locale', async () => {
    const ast = getStandardTemplateAstByCode('standard-bundle-quantities')!;
    const evaluation = evaluateTemplateAst(ast, frModel as unknown as Record<string, unknown>);
    const html = (await renderEvaluatedTemplateAst(ast, evaluation, { locale: 'fr', dateFormat: countryDateFormat('FR') })).html;
    const text = html.replace(/<[^>]+>/g, ' ').replace(/[  ]/g, ' ');
    expect(text).toContain('1 234,5');
    expect(text).toContain('−1,5');
    expect(text).toContain('+2,5');
    // The country writes the digits (day first for France), the locale the language.
    expect(text).toContain('01/01/2026 – 01/02/2026');
    expect(text).not.toContain('1,234.5');
  });
});
