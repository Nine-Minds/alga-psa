import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INVOICE_PRINT_SETTINGS,
  INVOICE_PRINT_MARGIN_MM_RANGE,
  TEMPLATE_AST_VERSION,
} from '@alga-psa/types';
import { validateTemplateAst } from './schema';

describe('templateAstSchema', () => {
  const createMinimalAst = (metadata?: Record<string, unknown>) => ({
    kind: 'invoice-template-ast',
    version: TEMPLATE_AST_VERSION,
    ...(metadata ? { metadata } : {}),
    layout: {
      id: 'root',
      type: 'document',
      children: [],
    },
  });

  it('validates a minimal AST document', () => {
    const result = validateTemplateAst(createMinimalAst());

    expect(result.success).toBe(true);
  });

  it('returns structured validation errors for invalid AST payloads', () => {
    const result = validateTemplateAst({
      ...createMinimalAst(),
      layout: {
        id: 'root',
        type: 'unknown-node-type',
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toEqual(
      expect.objectContaining({
        code: expect.any(String),
        path: expect.any(String),
        message: expect.any(String),
      })
    );
  });

  it('requires repeat binding metadata for dynamic-table nodes', () => {
    const invalidResult = validateTemplateAst({
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'line-items',
            type: 'dynamic-table',
            repeat: {
              sourceBinding: { bindingId: 'invoice.items' },
            },
            columns: [
              {
                id: 'description',
                value: { type: 'path', path: 'description' },
              },
            ],
          },
        ],
      },
    });

    expect(invalidResult.success).toBe(false);
    if (invalidResult.success) {
      return;
    }
    expect(invalidResult.errors.some((error) => error.path.includes('repeat.itemBinding'))).toBe(true);

    const validResult = validateTemplateAst({
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'line-items',
            type: 'dynamic-table',
            repeat: {
              sourceBinding: { bindingId: 'invoice.items' },
              itemBinding: 'item',
            },
            columns: [
              {
                id: 'description',
                value: { type: 'path', path: 'description' },
              },
            ],
          },
        ],
      },
    });

    expect(validResult.success).toBe(true);
  });

  it('enforces transform payload shapes for filter/sort/group/aggregate/computed workflows', () => {
    const invalidTransformPayload = validateTemplateAst({
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      transforms: {
        sourceBindingId: 'invoice.items',
        outputBindingId: 'invoice.items.shaped',
        operations: [
          {
            id: 'sort-1',
            type: 'sort',
            keys: [],
          },
        ],
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [],
      },
    });

    expect(invalidTransformPayload.success).toBe(false);
    if (invalidTransformPayload.success) {
      return;
    }
    expect(invalidTransformPayload.errors.some((error) => error.path.includes('transforms.operations.0.keys'))).toBe(true);

    const validTransformPayload = validateTemplateAst({
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      transforms: {
        sourceBindingId: 'invoice.items',
        outputBindingId: 'invoice.items.shaped',
        operations: [
          {
            id: 'filter-1',
            type: 'filter',
            predicate: {
              type: 'comparison',
              path: 'quantity',
              op: 'gt',
              value: 0,
            },
          },
          {
            id: 'sort-1',
            type: 'sort',
            keys: [
              {
                path: 'description',
                direction: 'asc',
              },
            ],
          },
          {
            id: 'group-1',
            type: 'group',
            key: 'category',
          },
          {
            id: 'aggregate-1',
            type: 'aggregate',
            aggregations: [
              {
                id: 'sum-total',
                op: 'sum',
                path: 'total',
              },
            ],
          },
          {
            id: 'computed-1',
            type: 'computed-field',
            fields: [
              {
                id: 'lineTotal',
                expression: {
                  type: 'binary',
                  op: 'multiply',
                  left: { type: 'path', path: 'quantity' },
                  right: { type: 'path', path: 'unitPrice' },
                },
              },
            ],
          },
        ],
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [],
      },
    });

    expect(validTransformPayload.success).toBe(true);
  });

  it('accepts optional strategyId on transform operations', () => {
    const result = validateTemplateAst({
      ...createMinimalAst(),
      transforms: {
        sourceBindingId: 'invoice.items',
        outputBindingId: 'invoice.items.grouped',
        operations: [
          {
            id: 'group-1',
            type: 'group',
            key: 'category',
            strategyId: 'custom-group-key',
          },
          {
            id: 'aggregate-1',
            type: 'aggregate',
            strategyId: 'custom-aggregate',
            aggregations: [
              {
                id: 'sum-total',
                op: 'sum',
                path: 'total',
              },
            ],
          },
        ],
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [],
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts valid explicit print metadata with a supported paper preset and positive uniform margin', () => {
    const result = validateTemplateAst(
      createMinimalAst({
        printSettings: {
          paperPreset: DEFAULT_INVOICE_PRINT_SETTINGS.paperPreset,
          marginMm: DEFAULT_INVOICE_PRINT_SETTINGS.marginMm,
        },
      })
    );

    expect(result.success).toBe(true);
  });

  it('rejects unknown paper preset values', () => {
    const result = validateTemplateAst(
      createMinimalAst({
        printSettings: {
          paperPreset: 'Tabloid',
          marginMm: DEFAULT_INVOICE_PRINT_SETTINGS.marginMm,
        },
      })
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.errors.some((error) => error.path === 'metadata.printSettings.paperPreset')).toBe(true);
  });

  it('rejects uniform margin values outside the supported range', () => {
    const result = validateTemplateAst(
      createMinimalAst({
        printSettings: {
          paperPreset: 'Letter',
          marginMm: INVOICE_PRINT_MARGIN_MM_RANGE.max + 1,
        },
      })
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.errors.some((error) => error.path === 'metadata.printSettings.marginMm')).toBe(true);
  });

  it('rejects invalid CSS identifiers in styles.classes keys', () => {
    const result = validateTemplateAst({
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      styles: {
        classes: {
          // `.` is not allowed by the safe identifier rule.
          'bad.class': { color: 'red' },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [],
      },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((error) => error.message.includes('Invalid CSS identifier'))).toBe(true);
  });

  it('rejects invalid CSS identifiers in token ids and node.style.tokenIds', () => {
    const invalidTokenId = validateTemplateAst({
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      styles: {
        tokens: {
          ok: { id: 'bad.id', value: 'red' },
        },
      },
      layout: {
        id: 'root',
        type: 'document',
        children: [],
      },
    });
    expect(invalidTokenId.success).toBe(false);

    const invalidNodeTokenIds = validateTemplateAst({
      kind: 'invoice-template-ast',
      version: TEMPLATE_AST_VERSION,
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'section-1',
            type: 'section',
            style: {
              tokenIds: ['bad.id'],
            },
            children: [],
          },
        ],
      },
    });
    expect(invalidNodeTokenIds.success).toBe(false);

    if (!invalidTokenId.success) {
      expect(invalidTokenId.errors.some((error) => error.message.includes('Invalid CSS identifier'))).toBe(true);
    }
    if (!invalidNodeTokenIds.success) {
      expect(invalidNodeTokenIds.errors.some((error) => error.message.includes('Invalid CSS identifier'))).toBe(true);
    }
  });
});
