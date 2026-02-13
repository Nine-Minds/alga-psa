import { describe, expect, it } from 'vitest';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type { DesignerWorkspaceSnapshot } from '../state/designerStore';
import {
  exportWorkspaceToInvoiceTemplateAst,
  exportWorkspaceToInvoiceTemplateAstJson,
  importInvoiceTemplateAstToWorkspace,
} from './workspaceAst';

const createWorkspaceWithFieldAndDynamicTable = (): DesignerWorkspaceSnapshot => {
  const base = useInvoiceDesignerStore.getState().exportWorkspace();
  const pageNode = base.nodes.find((node) => node.type === 'page');
  if (!pageNode) {
    return base;
  }

  const fieldId = 'ast-field-1';
  const tableId = 'ast-table-1';
  const withChildren = base.nodes.map((node) =>
    node.id === pageNode.id
      ? {
          ...node,
          childIds: [...node.childIds, fieldId, tableId],
        }
      : node
  );

  return {
    ...base,
    nodes: withChildren.concat([
      {
        id: fieldId,
        type: 'field',
        name: 'Invoice Number',
        position: { x: 24, y: 24 },
        size: { width: 220, height: 48 },
        canRotate: false,
        allowResize: true,
        rotation: 0,
        metadata: { bindingKey: 'invoice.number', format: 'text' },
        parentId: pageNode.id,
        childIds: [],
        allowedChildren: [],
      },
      {
        id: tableId,
        type: 'dynamic-table',
        name: 'Line Items',
        position: { x: 24, y: 96 },
        size: { width: 520, height: 220 },
        canRotate: false,
        allowResize: true,
        rotation: 0,
        metadata: {
          collectionBindingKey: 'items',
          columns: [
            { id: 'col-desc', header: 'Description', key: 'item.description' },
            { id: 'col-total', header: 'Amount', key: 'item.total' },
          ],
        },
        parentId: pageNode.id,
        childIds: [],
        allowedChildren: [],
      },
    ]),
  };
};

describe('exportWorkspaceToInvoiceTemplateAst', () => {
  it('exports designer workspace to a versioned AST document', () => {
    const workspace = createWorkspaceWithFieldAndDynamicTable();
    const ast = exportWorkspaceToInvoiceTemplateAst(workspace);

    expect(ast.kind).toBe('invoice-template-ast');
    expect(ast.version).toBe(1);
    expect(ast.layout.type).toBe('document');
    expect(ast.bindings?.values).toBeTruthy();
    expect(ast.bindings?.collections).toBeTruthy();
  });

  it('represents dynamic tables as repeatable regions with required repeat metadata', () => {
    const workspace = createWorkspaceWithFieldAndDynamicTable();
    const ast = exportWorkspaceToInvoiceTemplateAst(workspace);
    const json = exportWorkspaceToInvoiceTemplateAstJson(workspace);

    const pageSection = ast.layout.children?.find((child) => child.type === 'section');
    expect(pageSection).toBeTruthy();
    if (!pageSection || pageSection.type !== 'section') {
      return;
    }

    const dynamicTable = pageSection.children.find((child) => child.type === 'dynamic-table');
    expect(dynamicTable).toBeTruthy();
    if (!dynamicTable || dynamicTable.type !== 'dynamic-table') {
      return;
    }

    expect(dynamicTable.repeat.sourceBinding.bindingId).toContain('collection');
    expect(dynamicTable.repeat.itemBinding).toBe('item');
    expect(dynamicTable.columns.length).toBeGreaterThan(0);
    expect(json).toContain('"dynamic-table"');
  });

  it('hydrates a designer workspace from persisted AST', () => {
    const workspace = createWorkspaceWithFieldAndDynamicTable();
    const ast = exportWorkspaceToInvoiceTemplateAst(workspace);
    const hydrated = importInvoiceTemplateAstToWorkspace(ast);

    expect(hydrated.nodes.some((node) => node.type === 'field')).toBe(true);
    expect(hydrated.nodes.some((node) => node.type === 'dynamic-table')).toBe(true);
    const page = hydrated.nodes.find((node) => node.type === 'page');
    expect(page?.childIds.length).toBeGreaterThan(0);
  });
});
