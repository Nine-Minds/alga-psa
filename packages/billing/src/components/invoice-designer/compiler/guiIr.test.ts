import { describe, expect, it } from 'vitest';
import type { DesignerNode, DesignerWorkspaceSnapshot } from '../state/designerStore';
import { extractInvoiceDesignerIr } from './guiIr';

const createNode = (
  id: string,
  type: DesignerNode['type'],
  parentId: string | null,
  overrides: Partial<DesignerNode> = {}
): DesignerNode => ({
  id,
  type,
  name: overrides.name ?? `${type}-${id}`,
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 120, height: 40 },
  canRotate: false,
  rotation: 0,
  allowResize: true,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  parentId,
  childIds: overrides.childIds ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
  layout: overrides.layout,
});

const createWorkspace = (nodes: DesignerNode[]): DesignerWorkspaceSnapshot => ({
  nodes,
  constraints: [],
  snapToGrid: true,
  gridSize: 8,
  showGuides: true,
  showRulers: true,
  canvasScale: 1,
});

describe('extractInvoiceDesignerIr', () => {
  it('converts workspace nodes into compiler IR with all supported node types', () => {
    const supportedTypes: DesignerNode['type'][] = [
      'document',
      'page',
      'section',
      'column',
      'text',
      'totals',
      'table',
      'field',
      'label',
      'subtotal',
      'tax',
      'discount',
      'custom-total',
      'image',
      'logo',
      'qr',
      'dynamic-table',
      'signature',
      'action-button',
      'attachment-list',
      'divider',
      'spacer',
      'container',
    ];

    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageChildren = supportedTypes
      .filter((type) => type !== 'document' && type !== 'page')
      .map((type) => `${type}-node`);
    const pageNode = createNode('page', 'page', 'doc', { childIds: pageChildren });
    const typeNodes = supportedTypes
      .filter((type) => type !== 'document' && type !== 'page')
      .map((type, index) =>
        createNode(`${type}-node`, type, 'page', {
          position: { x: 10 + index, y: 20 + index },
        })
      );

    const workspace = createWorkspace([documentNode, pageNode, ...typeNodes]);
    const ir = extractInvoiceDesignerIr(workspace);

    expect(ir.version).toBe(1);
    expect(ir.rootNodeId).toBe('doc');
    expect(new Set(ir.flatNodes.map((node) => node.type))).toEqual(new Set(supportedTypes));
    expect(ir.flatNodes).toHaveLength(supportedTypes.length);
  });

  it('preserves hierarchy and layout metadata for compiler consumers', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', { childIds: ['section-a'] });
    const sectionNode = createNode('section-a', 'section', 'page', {
      childIds: ['field-a', 'label-a'],
      position: { x: 24, y: 30 },
      size: { width: 640, height: 280 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 20,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
      metadata: {
        heading: 'Billing Summary',
      },
    });
    const fieldNode = createNode('field-a', 'field', 'section-a', {
      position: { x: 8, y: 12 },
      size: { width: 320, height: 48 },
      metadata: {
        bindingKey: 'invoice.number',
        format: 'text',
      },
    });
    const labelNode = createNode('label-a', 'label', 'section-a', {
      position: { x: 8, y: 72 },
      size: { width: 280, height: 24 },
      metadata: {
        text: 'Invoice Number',
      },
    });

    const workspace = createWorkspace([documentNode, pageNode, sectionNode, fieldNode, labelNode]);
    const ir = extractInvoiceDesignerIr(workspace);

    expect(ir.tree.id).toBe('doc');
    expect(ir.tree.children[0]?.id).toBe('page');
    expect(ir.tree.children[0]?.children[0]?.id).toBe('section-a');
    expect(ir.tree.children[0]?.children[0]?.children.map((node) => node.id)).toEqual(['field-a', 'label-a']);

    const sectionIrNode = ir.flatNodes.find((node) => node.id === 'section-a');
    expect(sectionIrNode).toMatchObject({
      parentId: 'page',
      position: { x: 24, y: 30 },
      size: { width: 640, height: 280 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 20,
        justify: 'start',
        align: 'stretch',
        sizing: 'hug',
      },
      metadata: {
        heading: 'Billing Summary',
      },
    });
  });
});
