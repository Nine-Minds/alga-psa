import { describe, expect, it } from 'vitest';
import type { TemplateAst, TemplateNode } from '@alga-psa/types';

import { resolveLabelText } from '../labelText';
import { exportWorkspaceToTemplateAst, importTemplateAstToWorkspace } from './workspaceAst';
import { cloneAst, createAstDocument, findNodeById, roundTripAst } from './workspaceAst.roundtrip.helpers';

const buildTranslatableAst = (): TemplateAst =>
  createAstDocument(
    [
      {
        id: 'terms-section',
        type: 'section',
        title: { i18nKey: 'labels.termsAndConditions', defaultValue: 'Terms & Conditions' },
        children: [
          {
            id: 'bill-to-label',
            type: 'text',
            content: { type: 'i18n', i18nKey: 'labels.billTo', defaultValue: 'Bill To' },
          },
          {
            id: 'invoice-number',
            type: 'field',
            label: { i18nKey: 'labels.invoiceNumber', defaultValue: 'Invoice #' },
            binding: { bindingId: 'invoiceNumber' },
          },
        ],
      },
      {
        id: 'line-items',
        type: 'dynamic-table',
        repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
        emptyStateText: { i18nKey: 'labels.emptyState.noLineItems', defaultValue: 'No line items' },
        columns: [
          {
            id: 'description',
            header: { i18nKey: 'labels.description', defaultValue: 'Description' },
            value: { type: 'path', path: 'description' },
          },
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          {
            id: 'subtotal',
            label: { i18nKey: 'labels.subtotal', defaultValue: 'Subtotal' },
            value: { type: 'path', path: 'subtotal' },
            format: 'currency',
          },
        ],
      },
    ],
    {
      bindings: {
        values: { invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' } },
        collections: { lineItems: { id: 'lineItems', kind: 'collection', path: 'items' } },
      },
    }
  );

const nodeOf = (ast: TemplateAst, id: string): TemplateNode => {
  const node = findNodeById(ast.layout, id);
  if (!node) throw new Error(`missing node ${id}`);
  return node;
};

describe('designer round-trip preserves translatable labels', () => {
  it('re-emits every key reference unchanged', () => {
    const source = buildTranslatableAst();
    const roundTripped = roundTripAst(source);

    expect(nodeOf(roundTripped, 'terms-section')).toMatchObject({
      title: { i18nKey: 'labels.termsAndConditions', defaultValue: 'Terms & Conditions' },
    });
    expect(nodeOf(roundTripped, 'bill-to-label')).toMatchObject({
      content: { type: 'i18n', i18nKey: 'labels.billTo', defaultValue: 'Bill To' },
    });
    expect(nodeOf(roundTripped, 'invoice-number')).toMatchObject({
      label: { i18nKey: 'labels.invoiceNumber', defaultValue: 'Invoice #' },
    });
    expect(nodeOf(roundTripped, 'line-items')).toMatchObject({
      emptyStateText: { i18nKey: 'labels.emptyState.noLineItems', defaultValue: 'No line items' },
      columns: [{ header: { i18nKey: 'labels.description', defaultValue: 'Description' } }],
    });
    expect(nodeOf(roundTripped, 'totals')).toMatchObject({
      rows: [{ label: { i18nKey: 'labels.subtotal', defaultValue: 'Subtotal' } }],
    });
  });

  it('shows the authored English to the designer', () => {
    const workspace = importTemplateAstToWorkspace(cloneAst(buildTranslatableAst()));
    const labelNode = Object.values(workspace.nodesById).find(
      (node: any) => node?.props?.metadata?.__astOriginalNodeId === 'invoice-number'
    );

    expect(resolveLabelText(labelNode as any).text).toBe('Invoice #');
  });

  it('freezes a label as a literal once an author retypes it', () => {
    const workspace = importTemplateAstToWorkspace(cloneAst(buildTranslatableAst()));
    const fieldNode: any = Object.values(workspace.nodesById).find(
      (node: any) => node?.props?.metadata?.__astOriginalNodeId === 'invoice-number'
    );
    // What the inspector does when the label input changes.
    fieldNode.props.metadata.label = 'Reference';

    const exported = exportWorkspaceToTemplateAst(workspace);

    expect(nodeOf(exported, 'invoice-number')).toMatchObject({ label: 'Reference' });
  });

  it('leaves a literal-only template exactly as authored', () => {
    // Same shape as the translatable template above, authored by hand — which is
    // what every customized tenant template looks like.
    const source = cloneAst(buildTranslatableAst());
    const section: any = findNodeById(source.layout, 'terms-section');
    section.title = 'Terms & Conditions';
    section.children[0].content = { type: 'literal', value: 'Bill To' };
    section.children[1].label = 'Invoice #';
    const table: any = findNodeById(source.layout, 'line-items');
    table.emptyStateText = 'No line items';
    table.columns[0].header = 'Description';
    const totals: any = findNodeById(source.layout, 'totals');
    totals.rows[0].label = 'Subtotal';

    const roundTripped = roundTripAst(source);

    expect(nodeOf(roundTripped, 'terms-section')).toMatchObject({ title: 'Terms & Conditions' });
    expect(nodeOf(roundTripped, 'bill-to-label')).toMatchObject({
      content: { type: 'literal', value: 'Bill To' },
    });
    expect(nodeOf(roundTripped, 'invoice-number')).toMatchObject({ label: 'Invoice #' });
    expect(nodeOf(roundTripped, 'line-items')).toMatchObject({
      emptyStateText: 'No line items',
      columns: [{ header: 'Description' }],
    });
    expect(nodeOf(roundTripped, 'totals')).toMatchObject({ rows: [{ label: 'Subtotal' }] });
  });
});
