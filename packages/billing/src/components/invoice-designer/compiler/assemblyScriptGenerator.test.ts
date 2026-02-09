import { describe, expect, it } from 'vitest';
import type { DesignerNode, DesignerWorkspaceSnapshot } from '../state/designerStore';
import { extractInvoiceDesignerIr } from './guiIr';
import { generateAssemblyScriptFromIr } from './assemblyScriptGenerator';

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

describe('generateAssemblyScriptFromIr', () => {
  it('produces deterministic source for equivalent workspace models', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', { childIds: ['section-main'] });
    const sectionNodeA = createNode('section-main', 'section', 'page', {
      childIds: ['field-number', 'label-number'],
      metadata: { zeta: 1, alpha: 2 },
    });
    const fieldNode = createNode('field-number', 'field', 'section-main', {
      metadata: { format: 'text', bindingKey: 'invoice.number' },
    });
    const labelNodeA = createNode('label-number', 'label', 'section-main', {
      metadata: { text: 'Invoice Number' },
    });

    const sectionNodeB = createNode('section-main', 'section', 'page', {
      childIds: ['field-number', 'label-number'],
      metadata: { alpha: 2, zeta: 1 },
    });
    const labelNodeB = createNode('label-number', 'label', 'section-main', {
      metadata: { text: 'Invoice Number' },
    });

    const workspaceA = createWorkspace([documentNode, pageNode, sectionNodeA, fieldNode, labelNodeA]);
    const workspaceB = createWorkspace([labelNodeB, fieldNode, sectionNodeB, pageNode, documentNode]);

    const sourceA = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspaceA));
    const sourceB = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspaceB));

    expect(sourceA.source).toBe(sourceB.source);
    expect(sourceA.sourceHash).toBe(sourceB.sourceHash);
    expect(sourceA.sourceMap.map((entry) => entry.nodeId)).toEqual(sourceB.sourceMap.map((entry) => entry.nodeId));
  });

  it('emits source map entries linked to generated node factory symbols', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', { childIds: ['text-1'] });
    const textNode = createNode('text-1', 'text', 'page', {
      metadata: { text: 'Hello Preview' },
    });
    const workspace = createWorkspace([documentNode, pageNode, textNode]);

    const generated = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspace));

    expect(generated.source).toContain('export function generateLayout');
    expect(generated.source).toContain('function createNode_doc');
    expect(generated.sourceMap).toHaveLength(3);
    generated.sourceMap.forEach((entry) => {
      expect(entry.startLine).toBeGreaterThan(0);
      expect(entry.endLine).toBeGreaterThanOrEqual(entry.startLine);
      expect(entry.symbol).toContain('createNode_');
    });
  });
});
