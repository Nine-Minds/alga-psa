import { describe, expect, it } from 'vitest';
import { EXPRESSION_MODES, isExpressionMode } from '../modes';
import {
  buildInvoiceExpressionContextRoots,
  buildInvoiceExpressionPathOptions,
  buildWorkflowExpressionContextRoots,
  buildWorkflowExpressionPathOptions,
} from '../adapters';
import {
  deserializeExpressionContextRoots,
  serializeExpressionContextRoots,
  type SharedExpressionContextRoot,
  type SharedExpressionSchemaNode,
} from '../context';
import { buildPathOptionsFromContextRoots } from '../pathDiscovery';
import { createValidationResult } from '../validation';
import { validateSourcePaths } from '../pathValidation';

describe('expression authoring contracts', () => {
  it('accepts only path-only/template/expression modes', () => {
    expect(EXPRESSION_MODES).toEqual(['path-only', 'template', 'expression']);
    expect(isExpressionMode('path-only')).toBe(true);
    expect(isExpressionMode('template')).toBe(true);
    expect(isExpressionMode('expression')).toBe(true);
    expect(isExpressionMode('jsonata')).toBe(false);
    expect(isExpressionMode('')).toBe(false);
    expect(isExpressionMode(null)).toBe(false);
  });

  it('serializes and deserializes predictable context root metadata', () => {
    const roots: SharedExpressionContextRoot[] = [
      {
        key: 'vars',
        label: 'Vars',
        allowInModes: ['expression'],
        metadata: { stable: true },
      },
      {
        key: 'payload',
        label: 'Payload',
        allowInModes: ['expression'],
      },
    ];

    const serialized = serializeExpressionContextRoots(roots);
    const roundtrip = deserializeExpressionContextRoots(serialized);

    expect(roundtrip.map((root) => root.key)).toEqual(['payload', 'vars']);
    expect(roundtrip[1]?.metadata).toEqual({ stable: true });
    expect(serializeExpressionContextRoots(roundtrip)).toBe(serialized);
  });

  it('flattens nested schema paths in deterministic order', () => {
    const schema: SharedExpressionSchemaNode = {
      type: 'object',
      properties: {
        beta: {
          type: 'object',
          properties: {
            delta: { type: 'string' },
            alpha: { type: 'string' },
          },
        },
        alpha: { type: 'string' },
      },
    };

    const options = buildPathOptionsFromContextRoots(
      [
        { key: 'zeta', label: 'zeta', schema },
        { key: 'alpha', label: 'alpha', schema },
      ],
      { includeRootPaths: false }
    );

    expect(options.map((option) => option.path)).toEqual([
      'alpha.alpha',
      'alpha.beta',
      'alpha.beta.alpha',
      'alpha.beta.delta',
      'zeta.alpha',
      'zeta.beta',
      'zeta.beta.alpha',
      'zeta.beta.delta',
    ]);
  });

  it('includes array marker segments in discovered paths', () => {
    const options = buildPathOptionsFromContextRoots(
      [
        {
          key: 'payload',
          label: 'Payload',
          schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      ],
      { includeRootPaths: false }
    );

    const itemPath = options.find((option) => option.path === 'payload.items[]');
    const nestedPath = options.find((option) => option.path === 'payload.items[].id');

    expect(itemPath?.segments).toEqual(['payload', 'items', '[]']);
    expect(nestedPath?.segments).toEqual(['payload', 'items', '[]', 'id']);
  });

  it('normalizes validation severity and sorts diagnostics deterministically', () => {
    const result = createValidationResult([
      { severity: 'info', message: 'zeta', path: 'payload.zeta' },
      { severity: 'error', message: 'alpha', path: 'payload.alpha' },
      { severity: 'warning', message: 'beta', path: 'payload.beta' },
      { severity: 'custom' as never, message: 'fallback', path: 'payload.fallback' },
    ]);

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual([
      'error',
      'warning',
      'info',
      'info',
    ]);
    expect(result.diagnostics[3]?.severity).toBe('info');
    expect(result.diagnostics[0]?.path).toBe('payload.alpha');
  });

  it('emits invoice roots and canonical invoice path options', () => {
    const roots = buildInvoiceExpressionContextRoots();
    const options = buildInvoiceExpressionPathOptions({ includeRootPaths: false });
    const optionPaths = new Set(options.map((option) => option.path));

    expect(roots.map((root) => root.key)).toEqual(['invoice', 'customer', 'tenant', 'item']);
    expect(optionPaths.has('invoice.number')).toBe(true);
    expect(optionPaths.has('invoice.currencyCode')).toBe(true);
    expect(optionPaths.has('customer.name')).toBe(true);
    expect(optionPaths.has('tenant.address')).toBe(true);
    expect(optionPaths.has('item.total')).toBe(true);
  });

  it('keeps invoice root/path labels stable for known bindings', () => {
    const roots = buildInvoiceExpressionContextRoots();
    const options = buildInvoiceExpressionPathOptions({ includeRootPaths: false });

    expect(roots.map((root) => root.label)).toEqual(['Invoice', 'Customer', 'Tenant', 'Line Item']);
    expect(options.find((option) => option.path === 'invoice.currencyCode')?.label).toBe('invoice.currencyCode');
    expect(options.find((option) => option.path === 'tenant.address')?.label).toBe('tenant.address');
  });

  it('emits workflow payload/vars/meta/error and forEach roots when requested', () => {
    const roots = buildWorkflowExpressionContextRoots({
      includeErrorRoot: true,
      forEach: {
        itemVar: 'item',
        indexVar: '$index',
      },
      varsByName: {
        previous: { type: 'object', properties: {} },
      },
    });

    expect(roots.map((root) => root.key)).toEqual([
      'payload',
      'vars',
      'meta',
      'error',
      'item',
      '$index',
    ]);
  });

  it('resolves nested vars schema paths recursively', () => {
    const options = buildWorkflowExpressionPathOptions({
      varsByName: {
        previous: {
          type: 'object',
          properties: {
            account: {
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
            },
          },
        },
      },
    });

    const optionPaths = new Set(options.map((option) => option.path));
    expect(optionPaths.has('vars.previous')).toBe(true);
    expect(optionPaths.has('vars.previous.account')).toBe(true);
    expect(optionPaths.has('vars.previous.account.id')).toBe(true);
  });

  it('resolves local JSON Schema refs when discovering nested workflow vars paths', () => {
    const options = buildWorkflowExpressionPathOptions({
      varsByName: {
        duplicatedContact: {
          type: 'object',
          properties: {
            source_contact: {
              type: 'object',
              properties: {
                contact_name_id: { type: 'string' },
                email: { type: ['string', 'null'] },
              },
            },
            duplicate_contact: { $ref: '#/properties/source_contact' },
          },
        },
      },
    });

    const optionByPath = new Map(options.map((option) => [option.path, option]));

    expect(optionByPath.get('vars.duplicatedContact.duplicate_contact')?.isLeaf).toBe(false);
    expect(optionByPath.get('vars.duplicatedContact.duplicate_contact.contact_name_id')).toMatchObject({
      valueType: 'string',
      isLeaf: true,
    });
  });

  it('returns informational diagnostics for unresolved schema-aware paths', () => {
    const options = buildWorkflowExpressionPathOptions({
      payloadSchema: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
          },
        },
      },
    });

    const result = validateSourcePaths({
      source: 'payload.user.missing',
      mode: 'expression',
      options,
    });

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'info',
        code: 'unknown-path',
        path: 'payload.user.missing',
      })
    );
  });
});
