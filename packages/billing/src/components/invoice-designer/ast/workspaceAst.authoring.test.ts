import { describe, expect, it } from 'vitest';
import type { TemplateDynamicTableNode, TemplateImageNode, TemplateNode, TemplateTextNode } from '@alga-psa/types';
import { exportWorkspaceToTemplateAst, importTemplateAstToWorkspace } from './workspaceAst';
import { cloneAst, createAstDocument, findNodeById, listNodesByType, roundTripAst } from './workspaceAst.roundtrip.helpers';
import { useInvoiceDesignerStore } from '../state/designerStore';
import { createTextTranslationMetadata } from '../utils/translatableText';
import { templateAstSchema } from '../../../lib/invoice-template-ast/schema';
import { getStandardTemplateAstByCode } from '../../../lib/invoice-template-ast/standardTemplates';

describe('workspace AST authoring round-trips', () => {
  it('keeps a renamed layer name across save and reopen while the node id stays stable', () => {
    const ast = createAstDocument([
      { id: 'header-top', type: 'text', content: { type: 'literal', value: 'Hello' } },
    ]);
    const workspace = importTemplateAstToWorkspace(cloneAst(ast));
    const textNodeId = Object.keys(workspace.nodesById).find((id) => workspace.nodesById[id].type === 'text')!;
    (workspace.nodesById[textNodeId].props as Record<string, unknown>).name = 'Masthead greeting';

    const saved = exportWorkspaceToTemplateAst(workspace);
    const savedText = findNodeById<TemplateTextNode>(saved.layout, 'header-top');
    expect(savedText?.name).toBe('Masthead greeting');
    expect(templateAstSchema.safeParse(saved).success).toBe(true);

    const reopened = importTemplateAstToWorkspace(cloneAst(saved));
    const reopenedText = Object.values(reopened.nodesById).find((node) => node.type === 'text');
    expect((reopenedText?.props as Record<string, unknown>).name).toBe('Masthead greeting');
  });

  it('exports no name for layers still named after their id, so shipped templates round-trip unchanged', () => {
    const standard = getStandardTemplateAstByCode('standard-detailed');
    expect(standard).toBeTruthy();
    const roundTripped = roundTripAst(standard!);
    const namedNodeIds: string[] = [];
    const visit = (node: TemplateNode) => {
      if (node.name !== undefined) namedNodeIds.push(node.id);
      (node.children ?? []).forEach(visit);
    };
    visit(roundTripped.layout);
    expect(namedNodeIds).toEqual([]);
  });

  it('binds a Logo block to the document logo path and recognises it again on import', () => {
    const workspace = importTemplateAstToWorkspace(createAstDocument([]));
    const pageId = workspace.nodesById[workspace.rootId].children[0];
    workspace.nodesById['logo-1'] = {
      id: 'logo-1',
      type: 'logo',
      props: { name: 'Logo', metadata: { srcBinding: 'tenantLogo' }, style: { width: '180px', height: '72px' } },
      children: [],
    };
    workspace.nodesById[pageId].children.push('logo-1');

    const saved = exportWorkspaceToTemplateAst(workspace);
    const image = findNodeById<TemplateImageNode>(saved.layout, 'logo-1');
    expect(image?.src).toEqual({ type: 'path', path: 'tenantClient.logoUrl' });

    const reopened = importTemplateAstToWorkspace(cloneAst(saved));
    // A logo-bound image reopens as the Logo block it was built from.
    const reopenedLogo = Object.values(reopened.nodesById).find((node) => node.type === 'logo');
    expect((reopenedLogo?.props as { metadata: Record<string, unknown> }).metadata.srcBinding).toBe('tenantLogo');
  });

  it('keeps an imported logo binding expression verbatim', () => {
    const ast = createAstDocument(
      [{ id: 'issuer-logo', type: 'image', src: { type: 'binding', bindingId: 'tenantClientLogo' } }],
      { bindings: { values: { tenantClientLogo: { id: 'tenantClientLogo', kind: 'value', path: 'tenantClient.logoUrl' } }, collections: {} } }
    );
    const saved = roundTripAst(ast);
    expect(findNodeById<TemplateImageNode>(saved.layout, 'issuer-logo')?.src).toEqual({
      type: 'binding',
      bindingId: 'tenantClientLogo',
    });
  });

  it('exports table column widths and alignment from the column style', () => {
    const ast = createAstDocument(
      [
        {
          id: 'line-items',
          type: 'dynamic-table',
          repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
          columns: [
            { id: 'description', header: 'Description', value: { type: 'path', path: 'description' }, style: { inline: { width: '50%' } } },
            { id: 'amount', header: 'Amount', value: { type: 'path', path: 'total' }, format: 'currency', style: { inline: { width: '18%', textAlign: 'right' } } },
          ],
        },
      ],
      { bindings: { values: {}, collections: { lineItems: { id: 'lineItems', kind: 'collection', path: 'items' } } } }
    );
    const table = findNodeById<TemplateDynamicTableNode>(roundTripAst(ast).layout, 'line-items');
    expect(table?.columns.map((column) => column.style?.inline)).toEqual([
      { width: '50%' },
      { width: '18%', textAlign: 'right' },
    ]);
  });

  it('saves new tables and totals with standard, recipient-translated labels', () => {
    useInvoiceDesignerStore.getState().resetWorkspace();
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')!.id;
    store.addNodeFromPalette('dynamic-table', { x: 0, y: 0 }, { parentId: pageId });
    store.addNodeFromPalette('totals', { x: 0, y: 0 }, { parentId: pageId });

    const saved = exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace());
    const table = listNodesByType(saved.layout, 'dynamic-table')[0];
    expect(table.columns.map((column) => column.header)).toEqual([
      { i18nKey: 'labels.description', defaultValue: 'Description' },
      { i18nKey: 'labels.qty', defaultValue: 'Qty' },
      { i18nKey: 'labels.rate', defaultValue: 'Rate' },
      { i18nKey: 'labels.amount', defaultValue: 'Amount' },
    ]);
    const totals = listNodesByType(saved.layout, 'totals')[0];
    expect(totals.rows.map((row) => row.label)).toEqual([
      { i18nKey: 'labels.subtotal', defaultValue: 'Subtotal' },
      { i18nKey: 'labels.tax', defaultValue: 'Tax' },
      { i18nKey: 'labels.total', defaultValue: 'Total' },
    ]);
  });

  it('saves a text block given a standard label as translated content, and as fixed text once edited', () => {
    useInvoiceDesignerStore.getState().resetWorkspace();
    const store = useInvoiceDesignerStore.getState();
    const pageId = store.nodes.find((node) => node.type === 'page')!.id;
    store.addNodeFromPalette('text', { x: 0, y: 0 }, { parentId: pageId });
    const textId = useInvoiceDesignerStore.getState().selectedNodeId!;
    Object.entries(createTextTranslationMetadata({ i18nKey: 'labels.invoiceTitle', defaultValue: 'INVOICE' })).forEach(
      ([key, value]) => useInvoiceDesignerStore.getState().setNodeProp(textId, `metadata.${key}`, value, true)
    );

    const translated = listNodesByType(
      exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace()).layout,
      'text'
    )[0];
    expect(translated.content).toEqual({ type: 'i18n', i18nKey: 'labels.invoiceTitle', defaultValue: 'INVOICE' });

    useInvoiceDesignerStore.getState().setNodeProp(textId, 'metadata.text', 'TAX INVOICE', true);
    const fixed = listNodesByType(
      exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace()).layout,
      'text'
    )[0];
    expect(fixed.content).toEqual({ type: 'literal', value: 'TAX INVOICE' });
  });
});
