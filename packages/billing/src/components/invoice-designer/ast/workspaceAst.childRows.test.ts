import { describe, expect, it } from 'vitest';
import { STANDARD_INVOICE_TEMPLATE_ASTS } from '../../../lib/invoice-template-ast/standardTemplates';
import { roundTripAst } from './workspaceAst.roundtrip.helpers';

const findTable = (node: any): any => {
  if (!node) return null;
  if (node.type === 'dynamic-table') return node;
  for (const child of node.children ?? []) {
    const found = findTable(child);
    if (found) return found;
  }
  return null;
};

describe('designer workspace round trip: dynamic-table.childRows', () => {
  it('keeps childRows when a template is imported and exported', () => {
    const ast = STANDARD_INVOICE_TEMPLATE_ASTS['standard-bundle-quantities'];
    const original = findTable(ast.layout);
    expect(original.childRows).toBeTruthy();
    const table = findTable(roundTripAst(ast).layout);
    expect(table.childRows).toEqual(original.childRows);
  });

  it('adds no childRows to templates that never had them', () => {
    const ast = STANDARD_INVOICE_TEMPLATE_ASTS['standard-default'];
    expect(findTable(roundTripAst(ast).layout).childRows).toBeUndefined();
  });
});
