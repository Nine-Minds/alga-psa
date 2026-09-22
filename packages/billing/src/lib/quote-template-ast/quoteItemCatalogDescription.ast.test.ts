import { describe, expect, it } from 'vitest';
import type {
  QuoteViewModel,
  QuoteViewModelLineItem,
  TemplateAst,
  TemplateDynamicTableNode,
} from '@alga-psa/types';
import { roundTripAst, findNodeById } from '../../components/invoice-designer/ast/workspaceAst.roundtrip.helpers';
import { validateTemplateAst } from '../invoice-template-ast/schema';
import { evaluateTemplateAst } from '../invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '../invoice-template-ast/react-renderer';
import { getStandardQuoteTemplateAstByCode } from './standardTemplates';

const quoteItem = (overrides: Partial<QuoteViewModelLineItem>): QuoteViewModelLineItem => ({
  quote_item_id: 'qi-1',
  service_id: 'svc-1',
  service_item_kind: 'service',
  service_name: 'Managed Firewall Service',
  catalog_description: 'Central management, rule review, and firmware patching.',
  description: 'Managed Firewall Service',
  quantity: 1,
  unit_price: 25000,
  total_price: 25000,
  tax_amount: 0,
  net_amount: 25000,
  is_optional: false,
  is_selected: true,
  is_recurring: true,
  billing_frequency: 'monthly',
  ...overrides,
});

const viewModel = (items: QuoteViewModelLineItem[]): QuoteViewModel => ({
  quote_id: 'q-1',
  quote_number: 'QUO-0001',
  title: 'Quote',
  currency_code: 'USD',
  subtotal: 0,
  discount_total: 0,
  tax: 0,
  total_amount: 0,
  version: 1,
  line_items: items,
  phases: [],
  ...{
    recurring_items: items.filter((item) => item.is_recurring),
    onetime_items: items.filter((item) => !item.is_recurring),
  },
});

const requireAst = (ast: TemplateAst | null): TemplateAst => {
  if (!ast) {
    throw new Error('Expected a standard quote template AST');
  }
  return ast;
};

const findLineItemsTable = (ast: TemplateAst): TemplateDynamicTableNode => {
  const node = findNodeById<TemplateDynamicTableNode>(ast.layout, 'line-items');
  if (!node) {
    throw new Error('Expected a line-items dynamic-table node');
  }
  return node;
};

/** Paths of the stacked lines that resolve through `path` expressions. */
const linePaths = (column: { lines?: TemplateDynamicTableNode['columns'][number]['lines'] }): string[] =>
  (column.lines ?? [])
    .map((line) => (line.value.type === 'path' ? line.value.path : null))
    .filter((path): path is string => Boolean(path));

const renderHtml = async (ast: TemplateAst, data: QuoteViewModel): Promise<{ html: string; css: string }> => {
  const evaluation = evaluateTemplateAst(ast, data as unknown as Record<string, unknown>);
  return renderEvaluatedTemplateAst(ast, evaluation, { locale: 'en-US' });
};

const strip = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('quote catalog-description stacked table cells', () => {
  it('standard quote template stacks item name above catalog description while keeping the value fallback', () => {
    const ast = requireAst(getStandardQuoteTemplateAstByCode('standard-quote-default'));
    const table = findLineItemsTable(ast);
    const descriptionColumn = table.columns.find((column) => column.id === 'description');

    expect(descriptionColumn?.value).toEqual({ type: 'path', path: 'description' });
    expect(descriptionColumn?.lines?.map((line) => line.value)).toEqual([
      { type: 'path', path: 'service_name' },
      { type: 'path', path: 'catalog_description' },
    ]);
  });

  it('schema validation accepts stacked columns and legacy single-value columns', () => {
    const ast = requireAst(getStandardQuoteTemplateAstByCode('standard-quote-default'));
    expect(validateTemplateAst(ast).success).toBe(true);

    // A legacy single-value column (no lines) must still validate.
    const legacy = JSON.parse(JSON.stringify(ast)) as TemplateAst;
    const table = findLineItemsTable(legacy);
    for (const column of table.columns) {
      delete column.lines;
    }
    const result = validateTemplateAst(legacy);
    expect(result.success).toBe(true);
  });

  it('round-trips stacked lines through the designer workspace without touching legacy columns', () => {
    const ast = requireAst(getStandardQuoteTemplateAstByCode('standard-quote-grouped'));
    const roundTripped = roundTripAst(ast);

    const sourceTables = [findNodeById<TemplateDynamicTableNode>(ast.layout, 'monthly-items'),
      findNodeById<TemplateDynamicTableNode>(ast.layout, 'onetime-items')].filter((n): n is TemplateDynamicTableNode => Boolean(n));
    expect(sourceTables.length).toBeGreaterThan(0);

    const collectTables = (root: TemplateAst): TemplateDynamicTableNode[] => {
      const out: TemplateDynamicTableNode[] = [];
      const visit = (node: { type?: string; columns?: unknown[]; children?: unknown[] }) => {
        if ((node.type === 'dynamic-table' || node.type === 'table') && Array.isArray((node as { columns?: unknown[] }).columns)) {
          out.push(node as unknown as TemplateDynamicTableNode);
        }
        if ('children' in node && Array.isArray((node as { children?: unknown[] }).children)) {
          for (const child of (node as { children: unknown[] }).children) {
            visit(child as { type: string; children?: unknown[] });
          }
        }
      };
      visit(root.layout);
      return out;
    };

    const sourceDescriptionColumns = collectTables(ast)
      .flatMap((table) => table.columns)
      .filter((column) => column.id === 'description');
    const roundTrippedColumns = collectTables(roundTripped)
      .flatMap((table) => table.columns)
      .filter((column) => column.id === 'description');

    expect(sourceDescriptionColumns.length).toBe(roundTrippedColumns.length);
    expect(sourceDescriptionColumns.length).toBeGreaterThan(0);

    for (const column of roundTrippedColumns) {
      expect(column.value).toEqual({ type: 'path', path: 'description' });
      expect(linePaths(column)).toEqual(['service_name', 'catalog_description']);
    }
  });

  it('renders name above catalog description, collapses missing lines, and falls back for custom rows', async () => {
    const ast = requireAst(getStandardQuoteTemplateAstByCode('standard-quote-default'));
    const data = viewModel([
      quoteItem({}),
      quoteItem({ quote_item_id: 'qi-2', catalog_description: null }),
      quoteItem({
        quote_item_id: 'qi-3',
        service_name: null,
        catalog_description: null,
        description: 'Custom site-wide audit',
        service_id: null,
      }),
    ]);

    const { html } = await renderHtml(ast, data);
    const text = strip(html);

    const nameIndex = text.indexOf('Managed Firewall Service');
    const catalogIndex = text.indexOf('Central management, rule review, and firmware patching.');
    expect(nameIndex).toBeGreaterThanOrEqual(0);
    expect(catalogIndex).toBeGreaterThan(nameIndex);

    // Rows 1 + 2 both render the name; no duplicated name-as-description text.
    expect(text.match(/Managed Firewall Service/g)?.length).toBe(2);
    // Custom row falls back to its line description exactly once.
    expect(text.match(/Custom site-wide audit/g)?.length).toBe(1);
  });

  it('renders per-line independent styles in the exported HTML', async () => {
    const ast = requireAst(getStandardQuoteTemplateAstByCode('standard-quote-default'));
    const { html } = await renderHtml(ast, viewModel([quoteItem({})]));

    expect(html).toContain('font-weight:600;line-height:1.3');
    expect(html).toContain('color:#4b5563;font-size:12px;line-height:1.4');
  });

  it('preserves long/multiline catalog descriptions with visible line breaks and escaping', async () => {
    const ast = requireAst(getStandardQuoteTemplateAstByCode('standard-quote-default'));
    const data = viewModel([
      quoteItem({
        catalog_description: 'Line one of a long catalog description.\nSecond paragraph with <angle> & ampersand.',
      }),
    ]);

    const { html, css } = await renderHtml(ast, data);
    // React escapes markup from the data.
    expect(html).not.toContain('<angle>');
    expect(html).toContain('&lt;angle&gt; &amp; ampersand.');
    // white-space pre-line is applied so the source newline survives.
    expect(css).toContain('white-space: pre-line;');
  });
});
