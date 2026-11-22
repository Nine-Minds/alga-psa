import { describe, expect, it } from 'vitest';
import type { TemplateFieldNode, TemplateTotalsNode } from '@alga-psa/types';
import { exportWorkspaceToTemplateAst, importTemplateAstToWorkspace } from './workspaceAst';
import { cloneAst, createAstDocument, findNodeById, listNodesByType } from './workspaceAst.roundtrip.helpers';
import { getComponentSchema } from '../schema/componentSchema';

// alga0002295: the Discount Row binds the opt-in `discountTotal`; legacy rows stay unbound.
const exportWithRowMetadata = (rowType: 'discount' | 'subtotal', metadata: Record<string, unknown>) => {
  const workspace = importTemplateAstToWorkspace(
    cloneAst(createAstDocument([{ id: 'row-1', type: 'text', content: { type: 'literal', value: 'x' } }]))
  );
  const nodeId = Object.keys(workspace.nodesById).find((id) => workspace.nodesById[id].type === 'text')!;
  const node = workspace.nodesById[nodeId] as { type: string; props: Record<string, unknown> };
  node.type = rowType;
  node.props = { ...node.props, metadata };
  return exportWorkspaceToTemplateAst(workspace);
};

const fieldPath = (ast: ReturnType<typeof exportWorkspaceToTemplateAst>, field: TemplateFieldNode): string => {
  const bindingId = field.binding.bindingId;
  return (ast.bindings?.values?.[bindingId] as { path: string }).path;
};

describe('Discount Row binding (alga0002295)', () => {
  it('a newly placed Discount Row binds invoice.discountTotal as currency', () => {
    const defaults = getComponentSchema('discount').defaults.metadata as Record<string, unknown>;
    expect(defaults).toMatchObject({ bindingKey: 'invoice.discountTotal', format: 'currency', label: 'Discounts' });

    const ast = exportWithRowMetadata('discount', defaults);
    const field = listNodesByType(ast.layout, 'field')[0] as TemplateFieldNode;
    expect(fieldPath(ast, field)).toBe('discountTotal');
    expect(field.format).toBe('currency');
  });

  it('falls back to discountTotal when a Discount Row carries no bindingKey', () => {
    const ast = exportWithRowMetadata('discount', { label: 'Discounts' });
    const field = listNodesByType(ast.layout, 'field')[0] as TemplateFieldNode;
    expect(fieldPath(ast, field)).toBe('discountTotal');
  });

  it('keeps a legacy invoice.discount node unbound: no alias to discountTotal', () => {
    const ast = exportWithRowMetadata('discount', { label: 'Discount', bindingKey: 'invoice.discount' });
    const field = listNodesByType(ast.layout, 'field')[0] as TemplateFieldNode;
    const path = fieldPath(ast, field);
    expect(path).not.toBe('discountTotal');
    expect(path).not.toBe('grossSubtotal');
    expect(path).toBe('invoice.discount');
  });

  it('round-trips a saved field bound to the legacy `discount` path unchanged', () => {
    const saved = createAstDocument(
      [
        {
          id: 'legacy-discount',
          type: 'field',
          binding: { bindingId: 'discount' },
          label: { type: 'literal', value: 'Discount' } as never,
        } as never,
      ],
      { bindings: { values: { discount: { id: 'discount', kind: 'value', path: 'discount' } }, collections: {} } }
    );
    const out = exportWorkspaceToTemplateAst(importTemplateAstToWorkspace(cloneAst(saved)));
    const field = findNodeById<TemplateFieldNode>(out.layout, 'legacy-discount')!;
    expect(fieldPath(out, field)).toBe('discount');
    expect(JSON.stringify(out)).not.toContain('discountTotal');
  });

  it('round-trips hideWhenZero on totals rows', () => {
    const saved = createAstDocument(
      [
        {
          id: 'totals-1',
          type: 'totals',
          sourceBinding: { bindingId: 'lineItems' },
          rows: [
            { id: 'gross', label: 'Gross', value: { type: 'path', path: 'grossSubtotal' }, format: 'currency' },
            { id: 'discounts', label: 'Discounts', value: { type: 'path', path: 'discountTotal' }, format: 'currency', hideWhenZero: true },
            { id: 'total', label: 'Total', value: { type: 'path', path: 'total' }, format: 'currency' },
          ],
        },
      ],
      { bindings: { values: {}, collections: { lineItems: { id: 'lineItems', kind: 'collection', path: 'items' } } } }
    );
    const out = exportWorkspaceToTemplateAst(importTemplateAstToWorkspace(cloneAst(saved)));
    const totals = findNodeById<TemplateTotalsNode>(out.layout, 'totals-1')!;
    expect(totals.rows.map((row) => [row.id, row.hideWhenZero === true])).toEqual([
      ['gross', false],
      ['discounts', true],
      ['total', false],
    ]);
  });
});
