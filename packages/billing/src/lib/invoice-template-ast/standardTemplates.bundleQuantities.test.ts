import { describe, expect, it } from 'vitest';
import { evaluateTemplateAst } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';
import { validateTemplateAst } from './schema';
import { templateHasComponentRows, templateUsesComponentPricing } from './componentPricing';
import { STANDARD_INVOICE_TEMPLATE_ASTS, getStandardTemplateAstByCode } from './standardTemplates';

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
