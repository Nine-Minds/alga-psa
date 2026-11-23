import { describe, expect, it } from 'vitest';
import type { TemplateAst, TemplateNode } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';
import { evaluateTemplateAst } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';
import { resolveTemplateAstI18n, type TemplateLabelTranslator } from './i18nLabels';

const german: TemplateLabelTranslator = (key, { defaultValue }) =>
  ({ 'labels.yes': 'Ja', 'labels.no': 'Nein', 'labels.cadence.monthly': 'Monatlich', 'labels.included': 'Enthalten' } as Record<string, string>)[key] ?? defaultValue;

const buildAst = (columnExtras: Record<string, unknown>, fieldExtras: Record<string, unknown> = {}): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  bindings: {
    values: { flag: { id: 'flag', kind: 'value', path: 'flag' } },
    collections: { items: { id: 'items', kind: 'collection', path: 'items' } },
  },
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'flag-field',
        type: 'field',
        binding: { bindingId: 'flag' },
        ...fieldExtras,
      },
      {
        id: 'table',
        type: 'dynamic-table',
        repeat: { sourceBinding: { bindingId: 'items' }, itemBinding: 'item' },
        columns: [
          { id: 'recurring', header: 'Recurring', value: { type: 'path', path: 'is_recurring' }, ...columnExtras },
          { id: 'frequency', header: 'Frequency', value: { type: 'path', path: 'billing_frequency' }, ...columnExtras },
        ],
      },
    ] as TemplateNode[],
  },
});

const data = {
  flag: false,
  items: [
    { id: 'a', is_recurring: true, billing_frequency: 'monthly' },
    { id: 'b', is_recurring: false, billing_frequency: null },
  ],
};

const render = async (ast: TemplateAst, options: { locale?: string; t?: TemplateLabelTranslator } = {}) => {
  const localized = options.t ? resolveTemplateAstI18n(ast, options.t) : ast;
  const evaluation = evaluateTemplateAst(localized, data);
  return (await renderEvaluatedTemplateAst(localized, evaluation, options)).html;
};

describe('table value wording', () => {
  it('renders a boolean column as Yes/No, never true/false', async () => {
    const html = await render(buildAst({}));
    expect(html).toContain('>Yes<');
    expect(html).toContain('>No<');
    expect(html).not.toMatch(/>(true|false)</);
  });

  it('localizes the default Yes/No', async () => {
    const html = await render(buildAst({}), { locale: 'de', t: german });
    expect(html).toContain('>Ja<');
    expect(html).toContain('>Nein<');
  });

  it('renders valueLabels, including blank for false', async () => {
    const labels = { true: 'Included', false: '', monthly: 'Monthly' };
    const html = await render(buildAst({ valueLabels: labels }, { valueLabels: labels }));
    expect(html).toContain('>Included<');
    expect(html).toContain('>Monthly<');
    expect(html).not.toContain('>No<');
    expect(html).not.toMatch(/>(true|false)</);
  });

  it('resolves valueLabels key references in a non-English locale', async () => {
    const html = await render(
      buildAst({
        valueLabels: {
          true: { i18nKey: 'labels.included', defaultValue: 'Included' },
          monthly: { i18nKey: 'labels.cadence.monthly', defaultValue: 'Monthly' },
        },
      }),
      { locale: 'de', t: german }
    );
    expect(html).toContain('>Enthalten<');
    expect(html).toContain('>Monatlich<');
    expect(html).not.toContain('Included');
  });

  it('keeps an unresolved key reference readable as its authored default', async () => {
    const html = await render(buildAst({ valueLabels: { true: { i18nKey: 'labels.included', defaultValue: 'Included' } } }));
    expect(html).toContain('>Included<');
  });

  it('applies valueLabels on stacked column lines and totals rows', async () => {
    const ast = buildAst({});
    const table = (ast.layout as any).children[1];
    table.columns[0] = {
      id: 'recurring',
      header: 'Recurring',
      value: { type: 'path', path: 'is_recurring' },
      lines: [{ id: 'l1', value: { type: 'path', path: 'is_recurring' }, valueLabels: { true: 'Recurs' } }],
    };
    expect(await render(ast)).toContain('>Recurs<');
  });
});

describe('field value wording agrees with the table path', () => {
  it('renders the same wording for a field node and a table column', async () => {
    const labels = { false: 'Excluded', true: 'Included' };
    const html = await render(buildAst({ valueLabels: labels }, { valueLabels: labels }));
    expect(html).toContain('Excluded');
    expect(html).toContain('Included');
  });

  it('prints localized Yes/No on a field with no mapping, like the table path', async () => {
    const html = await render(buildAst({}), { locale: 'de', t: german });
    expect(html).toContain('Nein');
    expect(html).not.toContain('>No<');
  });
});
