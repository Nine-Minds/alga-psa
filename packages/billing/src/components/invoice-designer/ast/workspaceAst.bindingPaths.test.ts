import type { QuoteViewModel, QuoteViewModelLineItem, TemplateAst, TemplateNode } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';
import { describe, expect, it } from 'vitest';

import { DOCUMENT_TYPE_REGISTRY } from '../../../lib/document-templates/registry';
import { evaluateTemplateAst } from '../../../lib/invoice-template-ast/evaluator';
import { buildInvoiceTemplateBindings } from '../../../lib/invoice-template-ast/standardTemplates';
import { buildQuoteTemplateBindings } from '../../../lib/quote-template-ast/bindings';
import { getStandardQuoteTemplateAstByCode } from '../../../lib/quote-template-ast/standardTemplates';
import {
  buildDocumentExpressionPathOptions,
  getDocumentItemFields,
} from '../fields/documentBindingCatalog';
import { INVOICE_PREVIEW_SAMPLE_SCENARIOS } from '../preview/sampleScenarios';
import { QUOTE_PREVIEW_SAMPLE_SCENARIOS } from '../preview/quoteSampleScenarios';
import type { DesignerDocumentKind } from '../utils/documentKind';
import { resolveDesignerDocumentKind } from '../utils/documentKind';
import { exportWorkspaceToTemplateAst, importTemplateAstToWorkspace } from './workspaceAst';
import { cloneAst } from './workspaceAst.roundtrip.helpers';

type UnknownRecord = Record<string, unknown>;

type DocumentTypeFixture = {
  label: string;
  documentKind: DesignerDocumentKind;
  bindings: NonNullable<TemplateAst['bindings']>;
  sample: UnknownRecord;
  lineItems: UnknownRecord[];
};

/**
 * The shipped quote preview sample only carries the recurring / one-time groupings, so the
 * service and product totals have nothing to resolve against. The guard fills them in — every
 * field the picker offers must resolve, and QuoteViewModel documents all four groupings.
 */
const buildQuoteSample = (): UnknownRecord => {
  const base = { ...QUOTE_PREVIEW_SAMPLE_SCENARIOS[0]!.data } as QuoteViewModel;
  const lineItems = base.line_items as QuoteViewModelLineItem[];
  const sumOf = (field: 'total_price' | 'tax_amount') =>
    lineItems.reduce((total, item) => total + (item[field] ?? 0), 0);

  base.service_items = lineItems;
  base.product_items = [];
  base.service_subtotal = sumOf('total_price');
  base.service_tax = sumOf('tax_amount');
  base.service_total = base.service_subtotal + base.service_tax;
  base.product_subtotal = 0;
  base.product_tax = 0;
  base.product_total = 0;

  return base as unknown as UnknownRecord;
};

const buildFixtures = (): DocumentTypeFixture[] => {
  const invoiceSample = INVOICE_PREVIEW_SAMPLE_SCENARIOS[0]!.data as unknown as UnknownRecord;
  const quoteSample = buildQuoteSample();

  const salesOrderFamily = (['sales-order', 'packing-slip', 'pick-list'] as const).map((documentType) => {
    const entry = DOCUMENT_TYPE_REGISTRY[documentType];
    const sample = entry.buildSampleViewModel();
    return {
      label: documentType,
      documentKind: 'sales-order' as DesignerDocumentKind,
      bindings: entry.buildBindings(),
      sample,
      lineItems: (sample.line_items as UnknownRecord[]) ?? [],
    };
  });

  return [
    {
      label: 'invoice',
      documentKind: 'invoice',
      bindings: buildInvoiceTemplateBindings(),
      sample: invoiceSample,
      lineItems: (invoiceSample.items as UnknownRecord[]) ?? [],
    },
    {
      label: 'quote',
      documentKind: 'quote',
      bindings: buildQuoteTemplateBindings(),
      sample: quoteSample,
      lineItems: (quoteSample.line_items as UnknownRecord[]) ?? [],
    },
    ...salesOrderFamily,
  ];
};

const firstValueBindingId = (bindings: NonNullable<TemplateAst['bindings']>): string =>
  Object.keys(bindings.values ?? {})[0]!;

const createProbeAst = (bindings: NonNullable<TemplateAst['bindings']>): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: { templateName: 'Binding probe' },
  bindings: cloneAst(bindings),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'probe-field',
        type: 'field',
        label: 'Probe',
        binding: { bindingId: firstValueBindingId(bindings) },
      },
      { id: 'probe-text', type: 'text', content: { type: 'literal', value: 'Probe text' } },
    ],
  },
});

const setProbeMetadata = (
  ast: TemplateAst,
  nodeType: 'field' | 'text',
  patch: UnknownRecord
): TemplateAst => {
  const workspace = importTemplateAstToWorkspace(cloneAst(ast));
  const node = Object.values(workspace.nodesById).find((candidate) => candidate.type === nodeType);
  if (!node) {
    throw new Error(`Probe workspace is missing a ${nodeType} node`);
  }
  const props = node.props as UnknownRecord;
  props.metadata = { ...(props.metadata as UnknownRecord), ...patch };
  return exportWorkspaceToTemplateAst(workspace);
};

const findNodeOfType = (node: TemplateNode, type: string): TemplateNode | null => {
  if (node.type === type) {
    return node;
  }
  const children = Array.isArray((node as { children?: TemplateNode[] }).children)
    ? ((node as { children?: TemplateNode[] }).children as TemplateNode[])
    : [];
  for (const child of children) {
    const found = findNodeOfType(child, type);
    if (found) return found;
  }
  return null;
};

const exportedFieldBinding = (ast: TemplateAst): { bindingId: string; path: string } => {
  const fieldNode = findNodeOfType(ast.layout, 'field');
  if (!fieldNode || fieldNode.type !== 'field') {
    throw new Error('Exported AST is missing its field node');
  }
  const bindingId = fieldNode.binding.bindingId;
  const path = ast.bindings?.values?.[bindingId]?.path;
  if (typeof path !== 'string') {
    throw new Error(`Exported binding "${bindingId}" has no path`);
  }
  return { bindingId, path };
};

const getPathValue = (model: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((cursor, segment) => {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
      return undefined;
    }
    return (cursor as UnknownRecord)[segment];
  }, model);

const fixtures = buildFixtures();

describe('field picker binding paths resolve for every document type', () => {
  it.each(fixtures.map((fixture) => [fixture.label, fixture] as const))(
    'binds, exports and resolves every %s picker option',
    (_label, fixture) => {
      const probe = createProbeAst(fixture.bindings);
      const options = buildDocumentExpressionPathOptions({
        mode: 'template',
        includeRootPaths: false,
        documentKind: fixture.documentKind,
      }).filter((option) => option.isLeaf && !option.path.startsWith('item.'));

      expect(options.length).toBeGreaterThan(0);

      const failures: string[] = [];
      for (const option of options) {
        const exported = setProbeMetadata(probe, 'field', { bindingKey: option.path });
        const { bindingId, path } = exportedFieldBinding(exported);
        const evaluation = evaluateTemplateAst(exported, fixture.sample);
        if (evaluation.bindings[bindingId] === undefined) {
          failures.push(`${fixture.label}: option "${option.path}" -> path "${path}" resolved to nothing`);
        }
      }

      expect(failures).toEqual([]);
    }
  );

  it.each(fixtures.map((fixture) => [fixture.label, fixture] as const))(
    'resolves every %s line-item option against the sample line items',
    (_label, fixture) => {
      const itemFields = getDocumentItemFields(fixture.documentKind);
      expect(itemFields.length).toBeGreaterThan(0);
      expect(fixture.lineItems.length).toBeGreaterThan(0);

      const failures = itemFields
        .filter((itemField) =>
          fixture.lineItems.every((lineItem) => getPathValue(lineItem, itemField.name) === undefined)
        )
        .map((itemField) => `${fixture.label}: option "item.${itemField.name}" resolved to nothing`);

      expect(failures).toEqual([]);
    }
  );

  it('classifies the sales-order family from its shared binding catalog', () => {
    for (const documentType of ['sales-order', 'packing-slip', 'pick-list'] as const) {
      const entry = DOCUMENT_TYPE_REGISTRY[documentType];
      const workspace = importTemplateAstToWorkspace(
        entry.getStandardTemplateAstByCode(entry.defaultStandardCode)!
      );
      const nodes = Object.values(workspace.nodesById).map((node) => ({
        ...node,
        parentId: null,
      })) as never;
      expect(resolveDesignerDocumentKind(nodes)).toBe('sales-order');
    }
  });
});

describe('picked bindings reuse the document catalog', () => {
  const quoteProbe = () => createProbeAst(buildQuoteTemplateBindings());

  it('reuses the built-in quote binding instead of minting a duplicate', () => {
    const exported = setProbeMetadata(quoteProbe(), 'field', { bindingKey: 'quote.quoteNumber' });

    expect(exportedFieldBinding(exported)).toEqual({ bindingId: 'quoteNumber', path: 'quote_number' });
    expect(Object.keys(exported.bindings?.values ?? {}).filter((id) => id.startsWith('value.'))).toEqual([]);
  });

  it('resolves quote fields whose render path differs from the picker path', () => {
    const sample = buildQuoteSample();

    for (const [bindingKey, expectedPath] of [
      ['quote.quoteDate', 'quote_date'],
      ['quote.validUntil', 'valid_until'],
      ['quote.total', 'total_amount'],
      ['quote.scope', 'scope_of_work'],
      ['tenant.name', 'tenant.name'],
      ['tenant.address', 'tenant.address'],
      ['client.name', 'client.name'],
      ['contact.name', 'contact.name'],
      ['quote.status', 'status'],
      ['quote.title', 'title'],
      ['quote.subtotal', 'subtotal'],
      ['quote.version', 'version'],
    ] as const) {
      const exported = setProbeMetadata(quoteProbe(), 'field', { bindingKey });
      const { bindingId, path } = exportedFieldBinding(exported);
      expect(`${bindingKey} -> ${path}`).toBe(`${bindingKey} -> ${expectedPath}`);
      expect(evaluateTemplateAst(exported, sample).bindings[bindingId]).toBe(
        getPathValue(sample, expectedPath)
      );
    }
  });

  it('binds a raw render path typed into the custom path input to the built-in binding', () => {
    const exported = setProbeMetadata(quoteProbe(), 'field', { bindingKey: 'quote_number' });

    expect(exportedFieldBinding(exported)).toEqual({ bindingId: 'quoteNumber', path: 'quote_number' });
  });

  it('relinks a field that pointed at an orphaned picker-minted binding', () => {
    // The shape two production quote templates carry: a dangling `value.quoteDate` binding
    // alongside the correct built-in one.
    const withOrphan = cloneAst(quoteProbe());
    withOrphan.bindings!.values!['value.quoteDate'] = {
      id: 'value.quoteDate',
      kind: 'value',
      path: 'quoteDate',
    };
    const fieldNode = findNodeOfType(withOrphan.layout, 'field');
    if (!fieldNode || fieldNode.type !== 'field') throw new Error('probe field missing');
    fieldNode.binding = { bindingId: 'value.quoteDate' };

    const reexported = setProbeMetadata(withOrphan, 'field', { bindingKey: 'quote.quoteDate' });

    expect(exportedFieldBinding(reexported)).toEqual({ bindingId: 'quoteDate', path: 'quote_date' });
  });

  it('keeps a picker-bound field stable across repeated import/export cycles', () => {
    const once = setProbeMetadata(quoteProbe(), 'field', { bindingKey: 'quote.total' });
    const twice = exportWorkspaceToTemplateAst(importTemplateAstToWorkspace(cloneAst(once)));

    expect(twice).toEqual(once);
    expect(exportedFieldBinding(twice)).toEqual({ bindingId: 'total', path: 'total_amount' });
  });

  it('re-binds an imported standard quote template field without changing its path', () => {
    const source = getStandardQuoteTemplateAstByCode('standard-quote-default')!;
    const workspace = importTemplateAstToWorkspace(cloneAst(source));
    const fieldNodes = Object.values(workspace.nodesById).filter((node) => node.type === 'field');
    const quoteNumberField = fieldNodes.find(
      (node) => ((node.props as UnknownRecord).metadata as UnknownRecord)?.bindingKey === 'quote.quoteNumber'
    );

    expect(quoteNumberField).toBeTruthy();
    expect(exportWorkspaceToTemplateAst(workspace).bindings?.values?.quoteNumber?.path).toBe('quote_number');
  });
});

describe('text block tokens resolve per document type', () => {
  it('compiles {{quote.quoteNumber}} into the quote render path', () => {
    const exported = setProbeMetadata(createProbeAst(buildQuoteTemplateBindings()), 'text', {
      text: '{{quote.quoteNumber}}',
    });
    const textNode = findNodeOfType(exported.layout, 'text');

    expect(textNode?.type === 'text' ? textNode.content : null).toEqual({
      type: 'path',
      path: 'quote_number',
    });
  });

  it('compiles mixed literal text and a quote token into a template expression', () => {
    const exported = setProbeMetadata(createProbeAst(buildQuoteTemplateBindings()), 'text', {
      text: 'Valid until {{quote.validUntil}}',
    });
    const textNode = findNodeOfType(exported.layout, 'text');
    const content = textNode?.type === 'text' ? textNode.content : null;

    expect(content?.type).toBe('template');
    const args = content?.type === 'template' ? content.args ?? {} : {};
    expect(Object.values(args).map((arg) => (arg.type === 'path' ? arg.path : null))).toEqual([
      'valid_until',
    ]);
  });

  it('compiles {{salesOrder.orderNumber}} into the sales-order render path', () => {
    const entry = DOCUMENT_TYPE_REGISTRY['sales-order'];
    const exported = setProbeMetadata(createProbeAst(entry.buildBindings()), 'text', {
      text: '{{salesOrder.orderNumber}}',
    });
    const textNode = findNodeOfType(exported.layout, 'text');

    expect(textNode?.type === 'text' ? textNode.content : null).toEqual({
      type: 'path',
      path: 'so_number',
    });
  });

  it('keeps invoice tokens working and leaves unknown tokens as literal text', () => {
    const invoiceProbe = createProbeAst(buildInvoiceTemplateBindings());

    const invoiceToken = setProbeMetadata(invoiceProbe, 'text', { text: '{{invoice.number}}' });
    const invoiceTextNode = findNodeOfType(invoiceToken.layout, 'text');
    expect(invoiceTextNode?.type === 'text' ? invoiceTextNode.content : null).toEqual({
      type: 'path',
      path: 'invoiceNumber',
    });

    const unknownToken = setProbeMetadata(invoiceProbe, 'text', { text: '{{notAFieldAnywhere}}' });
    const unknownTextNode = findNodeOfType(unknownToken.layout, 'text');
    expect(unknownTextNode?.type === 'text' ? unknownTextNode.content : null).toEqual({
      type: 'literal',
      value: '{{notAFieldAnywhere}}',
    });
  });
});
