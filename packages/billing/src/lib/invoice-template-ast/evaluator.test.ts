import { describe, expect, it } from 'vitest';
import type { InvoiceTemplateAst, InvoiceTemplateTransformOperation } from '@alga-psa/types';
import { INVOICE_TEMPLATE_AST_VERSION } from '@alga-psa/types';
import { evaluateInvoiceTemplateAst, InvoiceTemplateEvaluationError } from './evaluator';

const invoiceFixture = {
  invoiceNumber: 'INV-1001',
  subtotal: 315,
  tax: 31.5,
  total: 346.5,
  items: [
    { id: 'b', description: 'Support', quantity: 1, unitPrice: 100, total: 100, category: 'Services' },
    { id: 'a', description: 'Consulting', quantity: 2, unitPrice: 100, total: 200, category: 'Services' },
    { id: 'c', description: 'Discount', quantity: 1, unitPrice: -15, total: -15, category: 'Adjustments' },
    { id: 'd', description: 'Equipment', quantity: 1, unitPrice: 30, total: 30, category: 'Products' },
  ],
};

const buildAst = (operations: InvoiceTemplateTransformOperation[]): InvoiceTemplateAst => ({
  kind: 'invoice-template-ast',
  version: INVOICE_TEMPLATE_AST_VERSION,
  bindings: {
    collections: {
      lineItems: {
        id: 'lineItems',
        kind: 'collection',
        path: 'items',
      },
    },
  },
  transforms: {
    sourceBindingId: 'lineItems',
    outputBindingId: 'lineItems.shaped',
    operations,
  },
  layout: {
    id: 'root',
    type: 'document',
    children: [],
  },
});

describe('evaluateInvoiceTemplateAst', () => {
  it('applies filter transforms to invoice items', () => {
    const ast = buildAst([
      {
        id: 'filter-positive',
        type: 'filter',
        predicate: {
          type: 'comparison',
          path: 'total',
          op: 'gt',
          value: 0,
        },
      },
    ]);

    const result = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    expect(result.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a' }),
        expect.objectContaining({ id: 'b' }),
        expect.objectContaining({ id: 'd' }),
      ])
    );
    expect((result.output as Array<{ id: string }>).find((item) => item.id === 'c')).toBeUndefined();
  });

  it('applies multi-key sort transforms with stable ordering', () => {
    const ast = buildAst([
      {
        id: 'sort-items',
        type: 'sort',
        keys: [
          { path: 'category', direction: 'asc' },
          { path: 'total', direction: 'desc' },
        ],
      },
    ]);

    const result = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    const sortedIds = (result.output as Array<{ id: string }>).map((item) => item.id);
    expect(sortedIds).toEqual(['c', 'd', 'a', 'b']);
  });

  it('applies grouping and aggregate transforms', () => {
    const ast = buildAst([
      {
        id: 'group-category',
        type: 'group',
        key: 'category',
      },
      {
        id: 'aggregate-totals',
        type: 'aggregate',
        aggregations: [
          { id: 'sumTotal', op: 'sum', path: 'total' },
          { id: 'countItems', op: 'count' },
          { id: 'avgTotal', op: 'avg', path: 'total' },
        ],
      },
    ]);

    const result = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    expect(result.groups?.map((group) => group.key)).toEqual(['Services', 'Adjustments', 'Products']);
    expect(result.aggregates.sumTotal).toBe(315);
    expect(result.aggregates.countItems).toBe(4);
    expect(result.aggregates.avgTotal).toBe(78.75);
  });

  it('computes derived fields and totals composition values', () => {
    const ast = buildAst([
      {
        id: 'computed-fields',
        type: 'computed-field',
        fields: [
          {
            id: 'lineTotalRecomputed',
            expression: {
              type: 'binary',
              op: 'multiply',
              left: { type: 'path', path: 'quantity' },
              right: { type: 'path', path: 'unitPrice' },
            },
          },
        ],
      },
      {
        id: 'aggregate-sum',
        type: 'aggregate',
        aggregations: [{ id: 'sumTotal', op: 'sum', path: 'lineTotalRecomputed' }],
      },
      {
        id: 'totals-compose',
        type: 'totals-compose',
        totals: [
          {
            id: 'grandTotal',
            label: 'Grand total',
            value: { type: 'aggregate-ref', aggregateId: 'sumTotal' },
          },
        ],
      },
    ]);

    const result = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    const recomputed = (result.output as Array<Record<string, unknown>>)[0].lineTotalRecomputed;
    expect(recomputed).toBeDefined();
    expect(result.totals.grandTotal).toBe(315);
  });

  it('executes allowlisted strategy hooks', () => {
    const ast = buildAst([
      {
        id: 'group-by-strategy',
        type: 'group',
        key: 'category',
        strategyId: 'custom-group-key',
      },
    ]);

    const result = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    expect(result.groups?.map((group) => group.key)).toEqual(['services', 'adjustments', 'products']);
  });

  it('throws on unknown strategy hooks', () => {
    const ast = buildAst([
      {
        id: 'group-by-unknown-strategy',
        type: 'group',
        key: 'category',
        strategyId: 'not-allowlisted',
      },
    ]);

    try {
      evaluateInvoiceTemplateAst(ast, invoiceFixture);
      throw new Error('Expected evaluator to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InvoiceTemplateEvaluationError);
      expect((error as InvoiceTemplateEvaluationError).code).toBe('UNKNOWN_STRATEGY');
    }
  });

  it('returns byte-for-byte stable output for equivalent AST and input data', () => {
    const ast = buildAst([
      {
        id: 'filter-positive',
        type: 'filter',
        predicate: {
          type: 'comparison',
          path: 'total',
          op: 'gte',
          value: 0,
        },
      },
      {
        id: 'sort-items',
        type: 'sort',
        keys: [{ path: 'description', direction: 'asc' }],
      },
      {
        id: 'aggregate-total',
        type: 'aggregate',
        aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }],
      },
    ]);

    const first = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    const second = evaluateInvoiceTemplateAst(ast, invoiceFixture);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('returns structured schema validation issues for invalid AST payloads', () => {
    const invalidAst = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      transforms: {
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.shaped',
        operations: [],
      },
      layout: {
        id: 'root',
        type: 'unknown-node',
      },
    } as unknown as InvoiceTemplateAst;

    try {
      evaluateInvoiceTemplateAst(invalidAst, invoiceFixture);
      throw new Error('Expected evaluator to throw');
    } catch (error) {
      const evaluationError = error as InvoiceTemplateEvaluationError;
      expect(evaluationError.code).toBe('SCHEMA_VALIDATION_FAILED');
      expect(evaluationError.issues.length).toBeGreaterThan(0);
      expect(evaluationError.issues[0]).toEqual(
        expect.objectContaining({
          code: 'SCHEMA_VALIDATION_FAILED',
          message: expect.any(String),
        })
      );
    }
  });

  it('throws a missing-binding error when source binding cannot be resolved', () => {
    const ast: InvoiceTemplateAst = {
      kind: 'invoice-template-ast',
      version: INVOICE_TEMPLATE_AST_VERSION,
      transforms: {
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.shaped',
        operations: [
          {
            id: 'filter-positive',
            type: 'filter',
            predicate: {
              type: 'comparison',
              path: 'total',
              op: 'gt',
              value: 0,
            },
          },
        ],
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [],
      },
    };

    try {
      evaluateInvoiceTemplateAst(ast, invoiceFixture);
      throw new Error('Expected evaluator to throw');
    } catch (error) {
      expect((error as InvoiceTemplateEvaluationError).code).toBe('MISSING_BINDING');
    }
  });

  it('throws invalid-operand errors for unresolved aggregate references', () => {
    const ast = buildAst([
      {
        id: 'compose-totals',
        type: 'totals-compose',
        totals: [
          {
            id: 'invalid-total',
            label: 'Invalid',
            value: { type: 'aggregate-ref', aggregateId: 'unknownAggregate' },
          },
        ],
      },
    ]);

    try {
      evaluateInvoiceTemplateAst(ast, invoiceFixture);
      throw new Error('Expected evaluator to throw');
    } catch (error) {
      expect((error as InvoiceTemplateEvaluationError).code).toBe('INVALID_OPERAND');
    }
  });

  it('applies transform composition in declared order (filter -> sort -> group -> aggregate)', () => {
    const ast = buildAst([
      {
        id: 'filter-positive',
        type: 'filter',
        predicate: {
          type: 'comparison',
          path: 'total',
          op: 'gt',
          value: 0,
        },
      },
      {
        id: 'sort-total-desc',
        type: 'sort',
        keys: [{ path: 'total', direction: 'desc' }],
      },
      {
        id: 'group-category',
        type: 'group',
        key: 'category',
      },
      {
        id: 'aggregate-grouped',
        type: 'aggregate',
        aggregations: [
          { id: 'sumTotal', op: 'sum', path: 'total' },
          { id: 'countItems', op: 'count' },
        ],
      },
    ]);

    const result = evaluateInvoiceTemplateAst(ast, invoiceFixture);
    expect(result.groups?.map((group) => group.key)).toEqual(['Services', 'Products']);
    expect(result.aggregates.sumTotal).toBe(330);
    expect(result.aggregates.countItems).toBe(3);
    expect(result.groups?.find((group) => group.key === 'Services')?.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('handles empty invoice-item collections for grouping and totals composition', () => {
    const ast = buildAst([
      {
        id: 'group-category',
        type: 'group',
        key: 'category',
      },
      {
        id: 'aggregate-grouped',
        type: 'aggregate',
        aggregations: [
          { id: 'sumTotal', op: 'sum', path: 'total' },
          { id: 'countItems', op: 'count' },
          { id: 'avgTotal', op: 'avg', path: 'total' },
        ],
      },
      {
        id: 'totals-compose',
        type: 'totals-compose',
        totals: [
          { id: 'total', label: 'Total', value: { type: 'aggregate-ref', aggregateId: 'sumTotal' } },
          { id: 'count', label: 'Count', value: { type: 'aggregate-ref', aggregateId: 'countItems' } },
          { id: 'avg', label: 'Average', value: { type: 'aggregate-ref', aggregateId: 'avgTotal' } },
        ],
      },
    ]);

    const result = evaluateInvoiceTemplateAst(ast, { ...invoiceFixture, items: [] });
    expect(result.groups).toEqual([]);
    expect(result.aggregates).toEqual({
      sumTotal: 0,
      countItems: 0,
      avgTotal: 0,
    });
    expect(result.totals).toEqual({
      total: 0,
      count: 0,
      avg: 0,
    });
  });
});
