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
          children: [...node.children, fieldId, tableId],
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
        props: {
          name: 'Invoice Number',
          metadata: { bindingKey: 'invoice.number', format: 'text' },
          layout: undefined,
          style: undefined,
        },
        position: { x: 24, y: 24 },
        size: { width: 220, height: 48 },
        baseSize: { width: 220, height: 48 },
        canRotate: false,
        allowResize: true,
        rotation: 0,
        metadata: { bindingKey: 'invoice.number', format: 'text' },
        parentId: pageNode.id,
        children: [],
        childIds: [],
        allowedChildren: [],
      },
      {
        id: tableId,
        type: 'dynamic-table',
        name: 'Line Items',
        props: {
          name: 'Line Items',
          metadata: {
            collectionBindingKey: 'items',
            columns: [
              { id: 'col-desc', header: 'Description', key: 'item.description' },
              { id: 'col-total', header: 'Amount', key: 'item.total' },
            ],
          },
          layout: undefined,
          style: undefined,
        },
        position: { x: 24, y: 96 },
        size: { width: 520, height: 220 },
        baseSize: { width: 520, height: 220 },
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
        children: [],
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

  it('roundtrips CSS-like layout/style props through AST inline styles', () => {
    const base = useInvoiceDesignerStore.getState().exportWorkspace();
    const pageNode = base.nodes.find((node) => node.type === 'page');
    expect(pageNode).toBeTruthy();
    if (!pageNode) return;

    const containerId = 'ast-container-1';
    const imageId = 'ast-image-1';

    const nextNodes: DesignerWorkspaceSnapshot['nodes'] = base.nodes.map((node) =>
      node.id === pageNode.id
        ? {
            ...node,
            props: {
              ...node.props,
              layout: {
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                padding: '24px',
                justifyContent: 'space-between',
                alignItems: 'stretch',
              },
            },
            layout: {
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              padding: '24px',
              justifyContent: 'space-between',
              alignItems: 'stretch',
            },
            childIds: [...node.childIds, containerId],
            children: [...node.children, containerId],
          }
        : node
    );

    nextNodes.push({
      id: containerId,
      type: 'container',
      name: 'Grid Container',
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
        style: undefined,
      },
      position: { x: 24, y: 24 },
      size: { width: 600, height: 240 },
      baseSize: { width: 600, height: 240 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: {},
      parentId: pageNode.id,
      children: [imageId],
      childIds: [imageId],
      allowedChildren: ['image'],
      layout: {
        display: 'grid',
        gridTemplateColumns: '1fr 2fr',
        gridTemplateRows: 'auto',
        gridAutoFlow: 'row dense',
        gap: '12px',
        padding: '10px',
      },
    });

    nextNodes.push({
      id: imageId,
      type: 'image',
      name: 'Image',
      props: {
        name: 'Image',
        metadata: { src: 'https://example.com/test.png' },
        layout: undefined,
        style: {
          width: '320px',
          height: '180px',
          aspectRatio: '16 / 9',
          objectFit: 'contain',
        },
      },
      position: { x: 0, y: 0 },
      size: { width: 320, height: 180 },
      baseSize: { width: 320, height: 180 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: { src: 'https://example.com/test.png' },
      parentId: containerId,
      children: [],
      childIds: [],
      allowedChildren: [],
      style: {
        width: '320px',
        height: '180px',
        aspectRatio: '16 / 9',
        objectFit: 'contain',
      },
    });

    const workspace: DesignerWorkspaceSnapshot = {
      ...base,
      nodes: nextNodes,
    };

    const ast = exportWorkspaceToInvoiceTemplateAst(workspace);
    const hydrated = importInvoiceTemplateAstToWorkspace(ast);

    const hydratedContainer = hydrated.nodes.find((node) => node.id === containerId);
    expect(hydratedContainer?.type).toBe('container');
    expect(hydratedContainer?.layout).toMatchObject({
      display: 'grid',
      gridTemplateColumns: '1fr 2fr',
      gridTemplateRows: 'auto',
      gridAutoFlow: 'row dense',
      gap: '12px',
      padding: '10px',
    });

    const hydratedImage = hydrated.nodes.find((node) => node.id === imageId);
    expect(hydratedImage?.type).toBe('image');
    expect(hydratedImage?.style).toMatchObject({
      width: '320px',
      height: '180px',
      aspectRatio: '16 / 9',
      objectFit: 'contain',
    });
  });
});
