import { describe, expect, it } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import {
  cloneAst,
  createAstDocument,
  findNodeById,
  getDocumentNode,
  roundTripAst,
} from './workspaceAst.roundtrip.helpers';
import { importTemplateAstToWorkspace } from './workspaceAst';

const QUOTE_BINDINGS = {
  values: {
    quoteNumber: { id: 'quoteNumber', kind: 'value' as const, path: 'quote_number' },
    termsAndConditionsRich: {
      id: 'termsAndConditionsRich',
      kind: 'value' as const,
      path: 'terms_and_conditions_rich',
    },
  },
  collections: {},
};

const createRichTermsAst = (): TemplateAst =>
  createAstDocument(
    [
      {
        id: 'terms-section',
        type: 'section',
        children: [
          {
            id: 'terms-copy',
            type: 'richText',
            content: { type: 'binding', bindingId: 'termsAndConditionsRich' },
            style: { inline: { color: '#374151', lineHeight: 1.5, fontSize: '13px' } },
          },
        ],
      },
    ],
    { bindings: QUOTE_BINDINGS },
  );

describe('workspaceAst richText support', () => {
  it('preserves a richText node and its content binding through a designer round-trip', () => {
    const roundTripped = roundTripAst(createRichTermsAst());
    const node = findNodeById(getDocumentNode(roundTripped), 'terms-copy');

    expect(node?.type).toBe('richText');
    if (!node || node.type !== 'richText') return;
    expect(node.content).toEqual({ type: 'binding', bindingId: 'termsAndConditionsRich' });
    expect(node.style?.inline).toMatchObject({ color: '#374151', fontSize: '13px' });
  });

  it('raises on an unrecognized AST node type instead of silently dropping it', () => {
    const ast = cloneAst(createRichTermsAst()) as unknown as {
      layout: { children: Array<{ type: string }> };
    };
    ast.layout.children[0].type = 'mysteryNode';

    expect(() => importTemplateAstToWorkspace(ast as unknown as TemplateAst)).toThrow(
      /Unsupported template node type/i,
    );
  });
});
