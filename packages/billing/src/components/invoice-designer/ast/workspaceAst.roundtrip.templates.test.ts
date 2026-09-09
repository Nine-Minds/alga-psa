import type { TemplateAst, TemplateNode, TemplateTableColumn } from '@alga-psa/types';
import { describe, expect, it } from 'vitest';
import { STANDARD_INVOICE_TEMPLATE_ASTS, getStandardTemplateAstByCode } from '../../../lib/invoice-template-ast/standardTemplates';
import { createAstDocument, exportImportExportAst, roundTripAst } from './workspaceAst.roundtrip.helpers';

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

const assertColumnSemantics = (source: TemplateTableColumn, roundTripped: TemplateTableColumn) => {
  expect(roundTripped.id).toBe(source.id);
  expect(roundTripped.header).toEqual(source.header);
  expect(roundTripped.value).toEqual(source.value);
  if (hasOwn(source, 'format')) {
    expect(roundTripped.format).toBe(source.format);
  }
  if (source.style?.tokenIds) {
    expect(roundTripped.style?.tokenIds).toEqual(source.style.tokenIds);
  }
  if (source.style?.inline) {
    expect(roundTripped.style?.inline).toMatchObject(source.style.inline);
  }
  if (hasOwn(source, 'lines')) {
    expect(Array.isArray(roundTripped.lines)).toBe(true);
    expect(roundTripped.lines).toEqual(source.lines);
  } else {
    expect(roundTripped.lines).toBeUndefined();
  }
};

const assertNodeSemantics = (source: TemplateNode, roundTripped: TemplateNode) => {
  expect(roundTripped.id).toBe(source.id);
  expect(roundTripped.type).toBe(source.type);

  if (source.style?.tokenIds) {
    expect(roundTripped.style?.tokenIds).toEqual(source.style.tokenIds);
  }
  if (source.style?.inline) {
    expect(roundTripped.style?.inline).toMatchObject(source.style.inline);
  }

  switch (source.type) {
    case 'document':
      expect(roundTripped.type).toBe('document');
      if (roundTripped.type !== 'document') return;
      expect(roundTripped.children.length).toBe(source.children.length);
      source.children.forEach((sourceChild, index) => assertNodeSemantics(sourceChild, roundTripped.children[index]!));
      return;
    case 'section':
      expect(roundTripped.type).toBe('section');
      if (roundTripped.type !== 'section') return;
      expect(roundTripped.title).toEqual(source.title);
      expect(roundTripped.children.length).toBe(source.children.length);
      source.children.forEach((sourceChild, index) => assertNodeSemantics(sourceChild, roundTripped.children[index]!));
      return;
    case 'stack':
      expect(roundTripped.type).toBe('stack');
      if (roundTripped.type !== 'stack') return;
      expect(roundTripped.direction).toBe(source.direction);
      expect(roundTripped.children.length).toBe(source.children.length);
      source.children.forEach((sourceChild, index) => assertNodeSemantics(sourceChild, roundTripped.children[index]!));
      return;
    case 'text':
      expect(roundTripped.type).toBe('text');
      if (roundTripped.type !== 'text') return;
      expect(roundTripped.content).toEqual(source.content);
      return;
    case 'field':
      expect(roundTripped.type).toBe('field');
      if (roundTripped.type !== 'field') return;
      expect(roundTripped.binding).toEqual(source.binding);
      expect(roundTripped.label).toEqual(source.label);
      if (hasOwn(source, 'format')) {
        expect(roundTripped.format).toBe(source.format);
      }
      if (hasOwn(source, 'emptyValue')) {
        expect(roundTripped.emptyValue).toBe(source.emptyValue);
      }
      return;
    case 'image':
      expect(roundTripped.type).toBe('image');
      if (roundTripped.type !== 'image') return;
      expect(roundTripped.src).toEqual(source.src);
      if (hasOwn(source, 'alt')) {
        expect(roundTripped.alt).toEqual(source.alt);
      }
      return;
    case 'divider':
      expect(roundTripped.type).toBe('divider');
      return;
    case 'table':
      // Designer importer currently normalizes table nodes to dynamic-table.
      expect(roundTripped.type).toBe('dynamic-table');
      if (roundTripped.type !== 'dynamic-table') return;
      expect(roundTripped.repeat.sourceBinding).toEqual(source.sourceBinding);
      source.columns.forEach((sourceColumn, index) => assertColumnSemantics(sourceColumn, roundTripped.columns[index]!));
      return;
    case 'dynamic-table':
      expect(roundTripped.type).toBe('dynamic-table');
      if (roundTripped.type !== 'dynamic-table') return;
      expect(roundTripped.repeat.sourceBinding).toEqual(source.repeat.sourceBinding);
      expect(roundTripped.repeat.itemBinding).toBe('item');
      expect(roundTripped.columns.length).toBe(source.columns.length);
      source.columns.forEach((sourceColumn, index) => assertColumnSemantics(sourceColumn, roundTripped.columns[index]!));
      if (hasOwn(source, 'emptyStateText')) {
        expect(roundTripped.emptyStateText).toEqual(source.emptyStateText);
      }
      return;
    case 'totals':
      expect(roundTripped.type).toBe('totals');
      if (roundTripped.type !== 'totals') return;
      expect(roundTripped.sourceBinding).toEqual(source.sourceBinding);
      expect(roundTripped.rows).toEqual(source.rows);
      return;
    default:
      return;
  }
};

describe('workspaceAst standard template roundtrip coverage', () => {
  const templateCodes = Object.keys(STANDARD_INVOICE_TEMPLATE_ASTS).sort();

  it('covers every standard template code', () => {
    expect(templateCodes.length).toBeGreaterThan(0);
  });

  it.each(templateCodes)('round-trips semantic node fidelity for %s', (templateCode) => {
    const source = getStandardTemplateAstByCode(templateCode);
    expect(source).toBeTruthy();
    if (!source) return;

    const roundTripped = roundTripAst(source);
    expect(roundTripped.kind).toBe(source.kind);
    expect(roundTripped.version).toBe(source.version);
    expect(roundTripped.metadata).toEqual(source.metadata);
    expect(roundTripped.styles).toEqual(source.styles);

    const sourceValueBindings = source.bindings?.values ?? {};
    const sourceCollectionBindings = source.bindings?.collections ?? {};
    const roundValueBindings = roundTripped.bindings?.values ?? {};
    const roundCollectionBindings = roundTripped.bindings?.collections ?? {};

    expect(Object.keys(roundValueBindings).sort()).toEqual(Object.keys(sourceValueBindings).sort());
    expect(Object.keys(roundCollectionBindings).sort()).toEqual(Object.keys(sourceCollectionBindings).sort());

    for (const [bindingId, sourceBinding] of Object.entries(sourceValueBindings)) {
      expect(roundValueBindings[bindingId]).toEqual(sourceBinding);
    }
    for (const [bindingId, sourceBinding] of Object.entries(sourceCollectionBindings)) {
      expect(roundCollectionBindings[bindingId]).toEqual(sourceBinding);
    }

    assertNodeSemantics(source.layout, roundTripped.layout);
  });

  it.each(templateCodes)('is deterministic after repeated export/import cycles for %s', (templateCode) => {
    const source = getStandardTemplateAstByCode(templateCode);
    expect(source).toBeTruthy();
    if (!source) return;

    const astOnce = roundTripAst(source);
    const astTwice = exportImportExportAst(source);
    expect(astTwice).toEqual(astOnce);
  });
});

describe('workspaceAst roundtrip preserves stacked table-cell lines', () => {
  const linesFixture = [
    {
      id: 'item-name',
      value: { type: 'path', path: 'service_name' },
      style: { tokenIds: ['line-strong'], inline: { fontWeight: 600, lineHeight: 1.3 } },
    },
    {
      id: 'catalog-description',
      value: { type: 'path', path: 'catalog_description' },
      format: 'text',
      style: { inline: { color: '#4b5563', fontSize: '12px' } },
    },
  ];

  const buildAst = (nodeType: 'dynamic-table' | 'table') => {
    const tableNode: TemplateNode =
      nodeType === 'table'
        ? {
            id: 'items-table',
            type: 'table',
            sourceBinding: { bindingId: 'lineItems' },
            rowBinding: 'row',
            columns: [
              {
                id: 'description',
                header: 'Description',
                value: { type: 'path', path: 'description' },
                lines: JSON.parse(JSON.stringify(linesFixture)),
              },
              { id: 'amount', header: 'Amount', value: { type: 'path', path: 'total_price' }, format: 'currency' },
            ],
          }
        : {
            id: 'items-table',
            type: 'dynamic-table',
            repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
            columns: [
              {
                id: 'description',
                header: 'Description',
                value: { type: 'path', path: 'description' },
                lines: JSON.parse(JSON.stringify(linesFixture)),
              },
              { id: 'amount', header: 'Amount', value: { type: 'path', path: 'total_price' }, format: 'currency' },
            ],
          };
    return {
      ast: createAstDocument([tableNode], {
        bindings: {
          values: {},
          collections: { lineItems: { id: 'lineItems', kind: 'collection', path: 'items' } },
        },
      }),
      tableNode,
    };
  };

  const renderHtml = async (ast: TemplateAst) => {
    const { renderEvaluatedTemplateAst } = await import('../../../lib/invoice-template-ast/react-renderer');
    const { evaluateTemplateAst } = await import('../../../lib/invoice-template-ast/evaluator');
    const evaluation = evaluateTemplateAst(ast, {
      items: [
        { service_name: 'Managed Support', catalog_description: 'Full-service support', description: 'fallback', total_price: 2500 },
        { service_name: null, catalog_description: null, description: 'Discount', total_price: -500 },
      ],
    });
    const rendered = await renderEvaluatedTemplateAst(ast, evaluation);
    return rendered.html;
  };

  it.each(['dynamic-table', 'table'] as const)(
    'preserves lines ids, expressions, formats and styles after a %s roundtrip',
    (nodeType) => {
      const { ast } = buildAst(nodeType);
      const roundTripped = roundTripAst(ast);

      const sourceTable = ast.layout.children?.[0];
      const roundTable = roundTripped.layout.children?.[0];
      if (!sourceTable || !roundTable || !('columns' in sourceTable) || !('columns' in roundTable)) {
        throw new Error('Expected a table node');
      }
      expect(roundTable.columns[0]?.lines).toEqual(sourceTable.columns[0]?.lines);
      // Deterministic after further cycles.
      expect(exportImportExportAst(ast)).toEqual(roundTripped);
    }
  );

  it.each(['dynamic-table', 'table'] as const)(
    'renders the stacked lines after a %s roundtrip',
    async (nodeType) => {
      const { ast } = buildAst(nodeType);
      const roundTripped = roundTripAst(ast);
      const html = await renderHtml(roundTripped);

      expect(html).toContain('Managed Support');
      expect(html).toContain('Full-service support');
      expect(html).toContain('class="ast-line-strong"');
      expect(html).toContain('>Discount</td>');
      expect(html).toContain('$25.00');
      expect(html).toContain('-$5.00');
    }
  );
});
