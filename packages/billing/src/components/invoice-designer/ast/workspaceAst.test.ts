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
  const pageNode = Object.values(base.nodesById).find((node) => node.type === 'page');
  if (!pageNode) {
    return base;
  }

  const fieldId = 'ast-field-1';
  const tableId = 'ast-table-1';
  return {
    ...base,
    nodesById: {
      ...base.nodesById,
      [pageNode.id]: {
        ...pageNode,
        children: [...pageNode.children, fieldId, tableId],
      },
      [fieldId]: {
        id: fieldId,
        type: 'field',
        props: {
          name: 'Invoice Number',
          metadata: { bindingKey: 'invoice.number', format: 'text' },
          size: { width: 220, height: 48 },
          position: { x: 24, y: 24 },
        },
        children: [],
      },
      [tableId]: {
        id: tableId,
        type: 'dynamic-table',
        props: {
          name: 'Line Items',
          metadata: {
            collectionBindingKey: 'items',
            columns: [
              { id: 'col-desc', header: 'Description', key: 'item.description' },
              { id: 'col-total', header: 'Amount', key: 'item.total' },
            ],
          },
          size: { width: 520, height: 220 },
          position: { x: 24, y: 96 },
        },
        children: [],
      },
    },
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

    expect(Object.values(hydrated.nodesById).some((node) => node.type === 'field')).toBe(true);
    expect(Object.values(hydrated.nodesById).some((node) => node.type === 'dynamic-table')).toBe(true);
    const page = Object.values(hydrated.nodesById).find((node) => node.type === 'page');
    expect(page?.children.length).toBeGreaterThan(0);
  });

  it('roundtrips CSS-like layout/style props through AST inline styles', () => {
    const base = useInvoiceDesignerStore.getState().exportWorkspace();
    const pageNode = Object.values(base.nodesById).find((node) => node.type === 'page');
    expect(pageNode).toBeTruthy();
    if (!pageNode) return;

    const containerId = 'ast-container-1';
    const imageId = 'ast-image-1';

    const workspace: DesignerWorkspaceSnapshot = {
      ...base,
      nodesById: {
        ...base.nodesById,
        [pageNode.id]: {
          ...pageNode,
          props: {
            ...pageNode.props,
            layout: {
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              padding: '24px',
              justifyContent: 'space-between',
              alignItems: 'stretch',
            },
          },
          children: [...pageNode.children, containerId],
        },
        [containerId]: {
          id: containerId,
          type: 'container',
          props: {
            name: 'Grid Container',
            metadata: {},
            layout: {
              display: 'grid',
              gridTemplateColumns: '1fr 2fr',
              gridTemplateRows: 'auto',
              gridAutoFlow: 'row dense',
              gap: '12px',
              padding: '10px',
            },
            size: { width: 600, height: 240 },
            position: { x: 24, y: 24 },
          },
          children: [imageId],
        },
        [imageId]: {
          id: imageId,
          type: 'image',
          props: {
            name: 'Image',
            metadata: { src: 'https://example.com/test.png' },
            style: {
              width: '320px',
              height: '180px',
              aspectRatio: '16 / 9',
              objectFit: 'contain',
            },
            size: { width: 320, height: 180 },
            position: { x: 0, y: 0 },
          },
          children: [],
        },
      },
    };

    const ast = exportWorkspaceToInvoiceTemplateAst(workspace);
    const hydrated = importInvoiceTemplateAstToWorkspace(ast);

    const hydratedContainer = hydrated.nodesById[containerId];
    expect(hydratedContainer?.type).toBe('container');
    expect((hydratedContainer?.props as any)?.layout).toMatchObject({
      display: 'grid',
      gridTemplateColumns: '1fr 2fr',
      gridTemplateRows: 'auto',
      gridAutoFlow: 'row dense',
      gap: '12px',
      padding: '10px',
    });

    const hydratedImage = hydrated.nodesById[imageId];
    expect(hydratedImage?.type).toBe('image');
    expect((hydratedImage?.props as any)?.style).toMatchObject({
      width: '320px',
      height: '180px',
      aspectRatio: '16 / 9',
      objectFit: 'contain',
    });
  });
});
