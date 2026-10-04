import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20260912121000_rewrite_quote_terms_copy_to_rich_text.cjs'));

const { rewriteTermsCopy, containsRichTermsCopy, syncRichTermsBinding } = migration.__test as {
  rewriteTermsCopy: (value: unknown, direction: 'up' | 'down') => boolean;
  containsRichTermsCopy: (value: unknown) => boolean;
  syncRichTermsBinding: (ast: any, direction: 'up' | 'down') => boolean;
};

const createStockAst = (): any => ({
  kind: 'invoice-template-ast',
  version: 1,
  bindings: { values: {}, collections: {} },
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'terms-section',
        type: 'section',
        title: 'Terms & Conditions',
        children: [
          {
            id: 'terms-copy',
            type: 'text',
            content: { type: 'binding', bindingId: 'termsAndConditions' },
            style: { inline: { color: '#374151', lineHeight: 1.5, fontSize: '13px' } },
          },
        ],
      },
    ],
  },
});

const termsCopy = (ast: any) => ast.layout.children[0].children[0];

describe('quote terms-copy rich text migration', () => {
  it('rewrites the stock terms-copy node and preserves its style and siblings', () => {
    const ast = createStockAst();
    expect(rewriteTermsCopy(ast, 'up')).toBe(true);

    expect(termsCopy(ast).type).toBe('richText');
    expect(termsCopy(ast).content).toEqual({ type: 'binding', bindingId: 'termsAndConditionsRich' });
    expect(termsCopy(ast).style).toEqual({ inline: { color: '#374151', lineHeight: 1.5, fontSize: '13px' } });
    expect(ast.layout.children[0].title).toBe('Terms & Conditions');
  });

  it('is idempotent on a second run', () => {
    const ast = createStockAst();
    expect(rewriteTermsCopy(ast, 'up')).toBe(true);
    expect(rewriteTermsCopy(ast, 'up')).toBe(false);
  });

  it('leaves a tenant-customized terms-copy node untouched', () => {
    const ast = createStockAst();
    termsCopy(ast).content = { type: 'literal', value: 'Our custom terms' };

    expect(rewriteTermsCopy(ast, 'up')).toBe(false);
    expect(termsCopy(ast).type).toBe('text');
    expect(termsCopy(ast).content).toEqual({ type: 'literal', value: 'Our custom terms' });
  });

  it('reverses cleanly', () => {
    const ast = createStockAst();
    rewriteTermsCopy(ast, 'up');
    expect(rewriteTermsCopy(ast, 'down')).toBe(true);

    expect(termsCopy(ast).type).toBe('text');
    expect(termsCopy(ast).content).toEqual({ type: 'binding', bindingId: 'termsAndConditions' });
  });

  it('declares the rich terms binding so the evaluator can resolve it', () => {
    const ast = createStockAst();
    rewriteTermsCopy(ast, 'up');

    expect(containsRichTermsCopy(ast)).toBe(true);
    expect(syncRichTermsBinding(ast, 'up')).toBe(true);
    expect(ast.bindings.values.termsAndConditionsRich).toEqual({
      id: 'termsAndConditionsRich',
      kind: 'value',
      path: 'terms_and_conditions_rich',
      fallback: '',
    });
    // Idempotent: a second sync is a no-op.
    expect(syncRichTermsBinding(ast, 'up')).toBe(false);

    expect(syncRichTermsBinding(ast, 'down')).toBe(true);
    expect(ast.bindings.values.termsAndConditionsRich).toBeUndefined();
  });
});
